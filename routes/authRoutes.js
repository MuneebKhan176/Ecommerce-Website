// routes/authRoutes.js
//
// ADMIN-ONLY auth. Everything customer-facing has been removed:
//   - no /register (customers never create accounts)
//   - no customer branch of /login (there's nothing to log into)
//   - no /dashboard (there is no customer dashboard — the homepage IS
//     the whole customer experience now)
//
// Only the admin login survives, because staff still need to get into
// the admin panel.

const express = require('express');
const router = express.Router();
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { conn, jwtSecret } = require('../Database/db_connection');
const { verifyToken } = require('../middle/authMiddleware');

function sendResponse(res, statusCode, success, message, data = null) {
    return res.status(statusCode).json({ success, message, data });
}

function setAuthCookie(res, token) {
    res.cookie('token', token, {
        httpOnly: true,
        secure: false,     // set to true once you're on HTTPS in production
        sameSite: 'Lax',
        maxAge: 24 * 60 * 60 * 1000 // 1 day
    });
}

// ================= ADMIN LOGIN PAGE =================
router.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/login.html'));
});

// ================= LOGIN (Admin only) =================
// body: { identifier, password }  — identifier = admin username
router.post('/login', (req, res) => {

    const identifier = req.body.identifier?.trim();
    const password    = req.body.password?.trim();

    if (!identifier || !password)
        return sendResponse(res, 400, false, 'Both fields are required');

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
});

router.get('/admin/dashboard', verifyToken, (req, res) => {
    if (req.user.role !== 'admin') return res.redirect('/login');
    res.sendFile(path.join(__dirname, '../Frontend/admin-dashboard.html'));
});

// ================= LOGOUT =================
router.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

module.exports = router;
