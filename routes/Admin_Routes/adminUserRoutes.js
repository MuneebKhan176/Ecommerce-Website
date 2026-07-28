// routes/Admin_Routes/adminUserRoutes.js
//
// GET /admin/api/users?search=&page=&limit=
//
// Read-only list of registered customer accounts for the admin dashboard's
// "Users" tab. Mirrors the pagination shape already used by
// adminStockRoutes.js's /admin/api/products (page, limit, pagination.total)
// so the dashboard card's counting logic (see loadUsers() in the dashboard
// JS) works the same way as Orders/Products.
//
// NOTE ON MIDDLEWARE: this is a JSON API route (not a page), so it uses
// adminAuth.js's `requireAdmin` — the one that always responds with JSON
// on auth failure — NOT authMiddleware.js's `verifyAdmin`, which redirects
// to /login and is only meant for HTML page routes like adminViewRoutes.js.
// Mixing these up is what causes raw JSON to render instead of a page, or
// (here) an API route to redirect instead of returning a 401/403 JSON body.

const express = require('express');
const router = express.Router();

const { conn } = require('../../db_connection');
const { requireAdmin } = require('../../middle/adminAuth');

function sendResponse(res, statusCode, success, message, data = null) {
    return res.status(statusCode).json({ success, message, data });
}

router.use(requireAdmin);

// GET /admin/api/users?search=&page=&limit=
router.get('/users', (req, res) => {
    const search = req.query.search?.trim();

    const where = [];
    const params = [];

    if (search) {
        where.push('(full_name LIKE ? OR email LIKE ? OR phone LIKE ?)');
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;

    const sql = `
        SELECT user_id, full_name, email, phone, created_at
        FROM users
        ${whereSql}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `;

    conn.query(sql, [...params, limit, offset], (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);

        conn.query(
            `SELECT COUNT(*) AS total FROM users ${whereSql}`,
            params,
            (err2, countRows) => {
                if (err2) return sendResponse(res, 500, false, 'Database error', err2.message);
                return sendResponse(res, 200, true, 'Users fetched', {
                    users: rows,
                    pagination: { page, limit, total: countRows[0].total },
                });
            }
        );
    });
});

module.exports = router;