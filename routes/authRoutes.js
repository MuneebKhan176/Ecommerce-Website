const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { conn, jwtSecret } = require('../Database/db_connection');
const { verifyToken } = require('../middle/authMiddleware');
const sendVerificationEmail = require('../mailer');

const CODE_EXPIRY_MS       = 15 * 60 * 1000; // 15 minutes
const RESEND_COOLDOWN_MS   = 60 * 1000;      // 60 seconds between emails
const MAX_SENDS_PER_HOUR   = 5;              // per email address
const MAX_IP_SENDS_PER_HOUR = 15;            // per IP, across all emails
const HOUR_WINDOW_MS       = 60 * 60 * 1000;
const DUPLICATE_SUBMIT_GUARD_MS = 3 * 1000;  // block rapid double-submits of /register

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

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.socket?.remoteAddress || 'unknown';
}

// ================= LOGIN PAGE =================
router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/Auth_UI/login.html'));
});

// ================= REGISTER PAGE (users only) =================
router.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/Auth_UI/register.html'));
});

// ================= REGISTER USER (step 1: create pending signup only) =================
// Only regular customers can self-register. Admins are seeded directly
// into the `admins` table (see seedAdmins.js) — there is no admin
// sign-up route on purpose.
//
// IMPORTANT: This route no longer sends the verification email. It only
// creates (or refreshes) the `pending_users` row and immediately redirects
// the client to /verify-email. The actual email is sent from
// /send-verification-email, which the verify-email page calls automatically
// once it loads. This keeps "create account" instant and puts all email
// sending + rate limiting behind a single, reusable endpoint.
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

        // Guard against the same "Create Account" request firing twice
        // (double-tap, slow network retry, etc.) in quick succession.
        conn.query('SELECT created_at FROM pending_users WHERE email = ?', [email], (err, existing) => {

            if (err) return sendResponse(res, 500, false, 'Database error');

            if (existing.length) {
                const ageMs = Date.now() - new Date(existing[0].created_at).getTime();
                if (ageMs < DUPLICATE_SUBMIT_GUARD_MS) {
                    return sendResponse(res, 429, false, 'Please wait a moment before trying again.');
                }
            }

            bcrypt.hash(password, 10, (err, passwordHash) => {

                if (err) return sendResponse(res, 500, false, 'Password hashing failed');

                // Placeholder code/expiry — the real one is generated and
                // emailed once the user reaches /verify-email.
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

                        return sendResponse(res, 201, true, 'Account created. Redirecting to verification…', {
                            email,
                            redirectTo: `/verify-email?email=${encodeURIComponent(email)}`
                        });
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

// ================= SEND / RESEND VERIFICATION EMAIL =================
// Called automatically by the verify-email page on load, and again whenever
// the user taps "Resend code". Centralizes every rate-limit rule so both
// paths are protected identically:
//   - 60s cooldown between sends for a given email
//   - max 5 sends/hour for a given email
//   - max 15 sends/hour for a given IP (across any email it's driving)
//   - an is_sending flag so overlapping requests can't both fire an email
function handleSendVerificationEmail(req, res) {

    const email = req.body.email?.trim();
    if (!email) return sendResponse(res, 400, false, 'Email is required');
    if (!isValidEmail(email)) return sendResponse(res, 400, false, 'Invalid email format');

    const ip = getClientIp(req);
    const now = Date.now();

    const proceedWithEmailCheck = () => {
        conn.query('SELECT * FROM pending_users WHERE email = ?', [email], (err, result) => {

            if (err) return sendResponse(res, 500, false, 'Database error');

            if (!result.length) {
                // No pending signup — either it was already verified, or it
                // never existed / expired and was cleaned up.
                conn.query('SELECT user_id FROM users WHERE email = ?', [email], (err, userResult) => {
                    if (err) return sendResponse(res, 500, false, 'Database error');

                    if (userResult.length) {
                        return sendResponse(res, 400, false, 'This email is already verified. Please log in.');
                    }
                    return sendResponse(res, 404, false, 'No pending signup found for this email. Please register again.');
                });
                return;
            }

            const pending = result[0];

            if (pending.is_sending) {
                return sendResponse(res, 429, false, 'A verification email is already being sent. Please wait.');
            }

            // Per-email cooldown
            if (pending.last_sent_at) {
                const elapsed = now - new Date(pending.last_sent_at).getTime();
                if (elapsed < RESEND_COOLDOWN_MS) {
                    const remaining = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
                    return sendResponse(res, 429, false, `Please wait ${remaining}s before requesting another email.`, {
                        cooldownRemaining: remaining
                    });
                }
            }

            // Per-email hourly cap
            let sendCount = pending.send_count || 0;
            let windowStart = pending.window_start_at ? new Date(pending.window_start_at).getTime() : null;

            if (!windowStart || (now - windowStart) > HOUR_WINDOW_MS) {
                sendCount = 0;
                windowStart = now;
            }

            if (sendCount >= MAX_SENDS_PER_HOUR) {
                return sendResponse(res, 429, false, 'You have reached the maximum number of verification emails for this hour. Please try again later.');
            }

            // Claim the "sending" lock before doing any async work.
            conn.query('UPDATE pending_users SET is_sending = 1 WHERE email = ?', [email], (err) => {
                if (err) return sendResponse(res, 500, false, 'Database error');

                const code = generateCode();
                const expiresAt = new Date(now + CODE_EXPIRY_MS);
                const newSendCount = sendCount + 1;

                // New code invalidates any previous one for this email.
                conn.query(
                    `UPDATE pending_users
                     SET verification_code = ?, expires_at = ?, last_sent_at = ?,
                         send_count = ?, window_start_at = ?, ip_address = ?, is_sending = 0
                     WHERE email = ?`,
                    [code, expiresAt, new Date(now), newSendCount, new Date(windowStart), ip, email],
                    (err) => {
                        if (err) return sendResponse(res, 500, false, 'Database error');

                        sendVerificationEmail(email, code)
                            .then(() => {
                                sendResponse(res, 200, true, 'Verification email sent! Check your inbox/spam folder.', {
                                    cooldownSeconds: RESEND_COOLDOWN_MS / 1000
                                });
                            })
                            .catch((mailErr) => {
                                console.error('⚠️ Failed to send verification email:', mailErr.message);
                                // Release the lock so the user can retry instead of getting stuck.
                                conn.query('UPDATE pending_users SET is_sending = 0 WHERE email = ?', [email]);
                                sendResponse(res, 500, false, 'Could not send verification email. Please try again.');
                            });
                    }
                );
            });
        });
    };

    // Per-IP hourly cap, checked/updated before we even look at the email.
    conn.query('SELECT * FROM ip_rate_limits WHERE ip_address = ?', [ip], (err, ipRows) => {
        if (err) return sendResponse(res, 500, false, 'Database error');

        const ipRow = ipRows[0];

        if (!ipRow) {
            conn.query(
                'INSERT INTO ip_rate_limits (ip_address, request_count, window_start_at) VALUES (?, 1, ?)',
                [ip, new Date(now)],
                (err) => {
                    if (err) console.error('IP rate limit insert error:', err.message);
                    proceedWithEmailCheck();
                }
            );
            return;
        }

        const ipWindowStart = new Date(ipRow.window_start_at).getTime();

        if (now - ipWindowStart > HOUR_WINDOW_MS) {
            conn.query(
                'UPDATE ip_rate_limits SET request_count = 1, window_start_at = ? WHERE ip_address = ?',
                [new Date(now), ip],
                (err) => {
                    if (err) console.error('IP rate limit reset error:', err.message);
                    proceedWithEmailCheck();
                }
            );
            return;
        }

        if (ipRow.request_count >= MAX_IP_SENDS_PER_HOUR) {
            return sendResponse(res, 429, false, 'Too many verification requests from this network. Please try again later.');
        }

        conn.query(
            'UPDATE ip_rate_limits SET request_count = request_count + 1 WHERE ip_address = ?',
            [ip],
            (err) => {
                if (err) console.error('IP rate limit increment error:', err.message);
                proceedWithEmailCheck();
            }
        );
    });
}

router.post('/send-verification-email', handleSendVerificationEmail);

// Kept as an alias so any existing client calling the old endpoint still works.
router.post('/resend-code', handleSendVerificationEmail);

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
            return sendResponse(res, 400, false, 'Code expired. Please request a new one.');
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