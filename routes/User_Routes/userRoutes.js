// routes/User_Routes/userRoutes.js
//
// GET /api/user/profile

const express = require('express');
const router = express.Router();
const { conn } = require('../../Database/db_connection');
const { verifyToken } = require('../../middle/authMiddleware');

function sendResponse(res, statusCode, success, message, data = null) {
    return res.status(statusCode).json({ success, message, data });
}

router.get('/user/profile', verifyToken, (req, res) => {
    // req.user.id is set by verifyToken from the JWT (see authRoutes.js login/verify-email)
    conn.query(
        'SELECT user_id, full_name, email, phone, created_at FROM users WHERE user_id = ?',
        [req.user.id],
        (err, rows) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            if (!rows.length) return sendResponse(res, 404, false, 'User not found');
            return sendResponse(res, 200, true, 'Profile fetched', rows[0]);
        }
    );
});

module.exports = router;