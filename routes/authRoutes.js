const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { conn, jwtSecret } = require('../Database/db_connection');
const { verifyToken } = require('../middle/authMiddleware');


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

// ================= REGISTER USER (direct creation — no email verification) =================
// Only regular customers can self-register. Admins are seeded directly
// into the `admins` table (see seedAdmins.js) — there is no admin
// sign-up route on purpose.
//
// TEMPORARY: Email verification is disabled because the email service
// isn't configured yet. This inserts straight into `users`, logs the
// user in, and sends them to /dashboard. When you're ready to turn
// verification back on, swap this back to the pending_users +
// /verify-email flow (kept below, commented out, for reference).
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

            const insertSql = `
                INSERT INTO users (full_name, email, phone, password_hash)
                VALUES (?, ?, ?, ?)
            `;

            conn.query(insertSql, [fullName, email, phone, passwordHash], (err, result) => {

                if (err) return sendResponse(res, 500, false, 'Registration failed');

                const token = jwt.sign(
                    { id: result.insertId, email, fullName, role: 'user' },
                    jwtSecret,
                    { expiresIn: '1d' }
                );

                setAuthCookie(res, token);

                return sendResponse(res, 201, true, 'Account created successfully!', {
                    redirectTo: '/dashboard'
                });
            });
        });
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