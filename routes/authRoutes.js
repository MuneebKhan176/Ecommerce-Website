const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { conn, jwtSecret } = require('../Database/db_connection');
const { verifyToken } = require('../middle/authMiddleware');
const sendVerificationEmail = require('../mailer');

const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

function isValidEmail(email) {
    const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return regex.test(email);
}

function sendResponse(res, statusCode, success, message, data = null) {
    return res.status(statusCode).json({ success, message, data });
}

function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function setAuthCookie(res, token) {
    res.cookie('token', token, {
        httpOnly: true,
        secure: false,     // set to true once you're on HTTPS in production
        sameSite: 'Lax',
        maxAge: 24 * 60 * 60 * 1000 // 1 day
    });
}

// ================= LOGIN PAGE =================
router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/Auth_UI/login.html'));
});

// ================= REGISTER PAGE (users only) =================
router.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/Auth_UI/register.html'));
});

// ================= REGISTER USER (step 1: send verification code) =================
// Only regular customers can self-register. Admins are seeded directly
// into the `admins` table (see seedAdmins.js) — there is no admin
// sign-up route on purpose.
//
// This does NOT create a row in `users` yet. It stores the signup in
// `pending_users` along with a 6-digit code, emails that code, and the
// account is only created for real once /verify-email confirms it.
router.post('/register', (req, res) => {

    const fullName        = req.body.fullName?.trim();
    const email            = req.body.email?.trim();
    const phone            = req.body.phone?.trim() || null;
    const password          = req.body.password?.trim();
    const confirmPassword  = req.body.confirmPassword?.trim();

    if (!fullName || !email || !password || !confirmPassword)
        return sendResponse(res, 400, false, 'All fields are required');

    if (!isValidEmail(email))
        return sendResponse(res, 400, false, 'Invalid email format');

    if (password.length < 8)
        return sendResponse(res, 400, false, 'Password must be at least 8 characters');

    if (password !== confirmPassword)
        return sendResponse(res, 400, false, 'Passwords do not match');

    conn.query('SELECT user_id FROM users WHERE email = ?', [email], (err, result) => {

        if (err) return sendResponse(res, 500, false, 'Database error');
        if (result.length > 0) return sendResponse(res, 409, false, 'Email already registered');

        bcrypt.hash(password, 10, (err, passwordHash) => {

            if (err) return sendResponse(res, 500, false, 'Password hashing failed');

            const code = generateCode();
            const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

            // Clear out any older pending signup for this email first,
            // then insert the fresh one (email is UNIQUE in pending_users).
            conn.query('DELETE FROM pending_users WHERE email = ?', [email], () => {

                const insertSql = `
                    INSERT INTO pending_users (full_name, email, phone, password_hash, verification_code, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                `;

                conn.query(insertSql, [fullName, email, phone, passwordHash, code, expiresAt], (err) => {

                    if (err) return sendResponse(res, 500, false, 'Registration failed');

                    sendVerificationEmail(email, code)
                        .then(() => sendResponse(res, 201, true, 'OTP sent! Check your inbox/spam folder.', {
                            email,
                            redirectTo: `/verify-email?email=${encodeURIComponent(email)}`
                        }))
                        .catch((mailErr) => {
                            console.error('⚠️ Failed to send verification email:', mailErr.message);
                            return sendResponse(res, 500, false, 'Could not send verification email. Please try again.');
                        });
                });
            });
        });
    });
});

// ================= VERIFY EMAIL PAGE =================
router.get('/verify-email', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/Auth_UI/verify-email.html'));
});

// ================= VERIFY EMAIL (step 2: confirm code, create the real user) =================
router.post('/verify-email', (req, res) => {

    const email = req.body.email?.trim();
    const code    = req.body.code?.trim();

    if (!email || !code)
        return sendResponse(res, 400, false, 'Email and code are required');

    conn.query('SELECT * FROM pending_users WHERE email = ?', [email], (err, result) => {

        if (err)             return sendResponse(res, 500, false, 'Database error');
        if (!result.length)  return sendResponse(res, 404, false, 'No pending signup found for this email');

        const pending = result[0];

        if (new Date(pending.expires_at).getTime() < Date.now()) {
            conn.query('DELETE FROM pending_users WHERE email = ?', [email]);
            return sendResponse(res, 400, false, 'Code expired. Please register again.');
        }

        if (String(pending.verification_code) !== code)
            return sendResponse(res, 400, false, 'Invalid code');

        const insertSql = `
            INSERT INTO users (full_name, email, password_hash, phone)
            VALUES (?, ?, ?, ?)
        `;

        conn.query(insertSql, [pending.full_name, pending.email, pending.password_hash, pending.phone], (err, result) => {

            if (err) return sendResponse(res, 500, false, 'Account creation failed');

            conn.query('DELETE FROM pending_users WHERE email = ?', [email]);

            const token = jwt.sign(
                { id: result.insertId, email: pending.email, fullName: pending.full_name, role: 'user' },
                jwtSecret,
                { expiresIn: '1d' }
            );

            setAuthCookie(res, token);

            return sendResponse(res, 200, true, 'Email verified and account created successfully!', {
                redirectTo: '/dashboard'
            });
        });
    });
});

// ================= RESEND CODE =================
router.post('/resend-code', (req, res) => {

    const email = req.body.email?.trim();
    if (!email) return sendResponse(res, 400, false, 'Email is required');

    conn.query('SELECT * FROM pending_users WHERE email = ?', [email], (err, result) => {

        if (err)             return sendResponse(res, 500, false, 'Database error');
        if (!result.length)  return sendResponse(res, 404, false, 'No pending signup found for this email');

        const code = generateCode();
        const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

        conn.query(
            'UPDATE pending_users SET verification_code = ?, expires_at = ? WHERE email = ?',
            [code, expiresAt, email],
            (err) => {
                if (err) return sendResponse(res, 500, false, 'Could not resend code');

                sendVerificationEmail(email, code)
                    .then(() => sendResponse(res, 200, true, 'A new code has been sent to your email.'))
                    .catch(() => sendResponse(res, 500, false, 'Could not send verification email.'));
            }
        );
    });
});

// ================= LOGIN (User or Admin) =================
// body: { loginType: 'user' | 'admin', identifier, password }
// identifier = email for users, username for admins
router.post('/login', (req, res) => {

    const loginType  = req.body.loginType === 'admin' ? 'admin' : 'user';
    const identifier = req.body.identifier?.trim();
    const password    = req.body.password?.trim();

    if (!identifier || !password)
        return sendResponse(res, 400, false, 'Both fields are required');

    if (loginType === 'admin') {

        conn.query('SELECT * FROM admins WHERE username = ?', [identifier], (err, result) => {

            if (err)            return sendResponse(res, 500, false, 'Database error');
            if (!result.length) return sendResponse(res, 401, false, 'Invalid admin credentials');

            const admin = result[0];

            bcrypt.compare(password, admin.password_hash, (err, isMatch) => {

                if (err || !isMatch)
                    return sendResponse(res, 401, false, 'Invalid admin credentials');

                const token = jwt.sign(
                    {
                        id: admin.admin_id,
                        username: admin.username,
                        role: 'admin',
                        adminRole: admin.role // SUPER_ADMIN | STAFF
                    },
                    jwtSecret,
                    { expiresIn: '1d' }
                );

                setAuthCookie(res, token);

                return sendResponse(res, 200, true, 'Admin login successful', {
                    redirectTo: '/admin/dashboard'
                });
            });
        });

        return;
    }

    // loginType === 'user'
    conn.query('SELECT * FROM users WHERE email = ?', [identifier], (err, result) => {

        if (err)            return sendResponse(res, 500, false, 'Database error');
        if (!result.length) return sendResponse(res, 401, false, 'Invalid credentials');

        const user = result[0];

        bcrypt.compare(password, user.password_hash, (err, isMatch) => {

            if (err || !isMatch)
                return sendResponse(res, 401, false, 'Invalid credentials');

            const token = jwt.sign(
                { id: user.user_id, email: user.email, fullName: user.full_name, role: 'user' },
                jwtSecret,
                { expiresIn: '1d' }
            );

            setAuthCookie(res, token);

            return sendResponse(res, 200, true, 'Login successful', {
                redirectTo: '/dashboard'
            });
        });
    });
});

// ================= DASHBOARD (placeholder landing page after login) =================
router.get('/dashboard', verifyToken, (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/Dashboard_UI/user-dashboard.html'));
});

router.get('/admin/dashboard', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.redirect('/login');
    res.sendFile(path.join(__dirname, '../Frontend/Dashboard_UI/admin-dashboard.html'));
});

// ================= LOGOUT =================
router.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

module.exports = router;