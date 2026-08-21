// routes/adminCategoryRoutes.js
//
// GET    /admin/api/categories
// POST   /admin/api/categories
// PUT    /admin/api/categories/:id
// PATCH  /admin/api/categories/:id/move
// DELETE /admin/api/categories/:id
//
// display_order is ONE combined sequence across BOTH genders (MEN +
// WOMEN together). It decides which category shows first overall,
// regardless of gender. New categories are appended to the end of
// that combined sequence; existing ones are only reordered via the
// /move endpoint (swap with the previous/next category in the whole
// combined list), which is what the admin UI's up/down arrows call.

const express = require('express');
const router = express.Router();

const { conn } = require('../../Database/db_connection');
const { verifyToken } = require('../../middle/authMiddleware');
const { requireAdmin } = require('../../middle/adminAuth');

function sendResponse(res, statusCode, success, message, data = null) {
    return res.status(statusCode).json({ success, message, data });
}

router.use(verifyToken, requireAdmin);

// GET /categories — every category with a live product count,
// sorted by the combined display_order (category_id as tiebreaker).
router.get('/categories', (req, res) => {
    const sql = `
        SELECT c.category_id, c.gender, c.category_name, c.display_order,
               COUNT(p.product_id) AS product_count
        FROM categories c
        LEFT JOIN products p ON p.category_id = c.category_id
        GROUP BY c.category_id, c.gender, c.category_name, c.display_order
        ORDER BY c.display_order ASC, c.category_id ASC
    `;
    conn.query(sql, (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);
        return sendResponse(res, 200, true, 'Categories fetched', rows);
    });
});

// POST /categories   { gender, category_name }
// New category is appended to the END of the combined sequence.
router.post('/categories', (req, res) => {
    const gender = req.body.gender;
    const category_name = req.body.category_name?.trim();

    if (!['MEN', 'WOMEN', 'OTHERS'].includes(gender) || !category_name) {
        return sendResponse(res, 400, false, 'gender (MEN/WOMEN/OTHERS) and category_name are required');
    }

    conn.query('SELECT COALESCE(MAX(display_order), 0) AS maxOrder FROM categories', [], (orderErr, orderRows) => {
        if (orderErr) return sendResponse(res, 500, false, 'Database error', orderErr.message);

        const nextOrder = orderRows[0].maxOrder + 1;

        conn.query(
            'INSERT INTO categories (gender, category_name, display_order) VALUES (?, ?, ?)',
            [gender, category_name, nextOrder],
            (err, result) => {
                if (err) return sendResponse(res, 500, false, 'Database error', err.message);
                return sendResponse(res, 201, true, 'Category created', { category_id: result.insertId, display_order: nextOrder });
            }
        );
    });
});

// PUT /categories/:id   { gender, category_name }
// Only edits name/gender — display_order is changed exclusively via
// the /move endpoint, so a normal edit never accidentally reshuffles
// the sequence.
router.put('/categories/:id', (req, res) => {
    const { id } = req.params;
    const gender = req.body.gender;
    const category_name = req.body.category_name?.trim();

    if (!['MEN', 'WOMEN', 'OTHERS'].includes(gender) || !category_name) {
        return sendResponse(res, 400, false, 'gender (MEN/WOMEN/OTHERS) and category_name are required');
    }

    conn.query(
        'UPDATE categories SET gender = ?, category_name = ? WHERE category_id = ?',
        [gender, category_name, id],
        (err, result) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            if (result.affectedRows === 0) return sendResponse(res, 404, false, 'Category not found');
            return sendResponse(res, 200, true, 'Category updated');
        }
    );
});

// PATCH /categories/:id/move   { direction: 'up' | 'down' }
//
// Swaps this category's position with its immediate neighbor in the
// COMBINED sequence (across both genders) — 'up' means "shows
// earlier", 'down' means "shows later". Uses (display_order,
// category_id) as a compound comparison so it's robust even if two
// rows ever share the same display_order value.
router.patch('/categories/:id/move', (req, res) => {
    const { id } = req.params;
    const direction = req.body.direction;

    if (!['up', 'down'].includes(direction)) {
        return sendResponse(res, 400, false, "direction must be 'up' or 'down'");
    }

    conn.query('SELECT category_id, display_order FROM categories WHERE category_id = ?', [id], (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);
        if (!rows.length) return sendResponse(res, 404, false, 'Category not found');

        const current = rows[0];
        const movingUp = direction === 'up';

        const comparator = movingUp
            ? '(display_order < ? OR (display_order = ? AND category_id < ?))'
            : '(display_order > ? OR (display_order = ? AND category_id > ?))';
        const orderDir = movingUp ? 'DESC' : 'ASC';

        const neighborSql = `
            SELECT category_id, display_order FROM categories
            WHERE ${comparator}
            ORDER BY display_order ${orderDir}, category_id ${orderDir}
            LIMIT 1
        `;

        conn.query(neighborSql, [current.display_order, current.display_order, current.category_id], (err2, neighborRows) => {
            if (err2) return sendResponse(res, 500, false, 'Database error', err2.message);

            if (!neighborRows.length) {
                return sendResponse(res, 200, true, `Already at the ${movingUp ? 'top' : 'bottom'}`, { moved: false });
            }

            const neighbor = neighborRows[0];

            conn.query('UPDATE categories SET display_order = ? WHERE category_id = ?', [neighbor.display_order, current.category_id], (err3) => {
                if (err3) return sendResponse(res, 500, false, 'Database error', err3.message);

                conn.query('UPDATE categories SET display_order = ? WHERE category_id = ?', [current.display_order, neighbor.category_id], (err4) => {
                    if (err4) return sendResponse(res, 500, false, 'Database error', err4.message);
                    return sendResponse(res, 200, true, 'Order updated', { moved: true });
                });
            });
        });
    });
});

// DELETE /categories/:id
// Refuses to delete if products still reference this category — we never
// cascade-delete products here on purpose.
router.delete('/categories/:id', (req, res) => {
    const { id } = req.params;

    conn.query('SELECT COUNT(*) AS cnt FROM products WHERE category_id = ?', [id], (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);

        const productCount = rows[0].cnt;
        if (productCount > 0) {
            return sendResponse(
                res, 409, false,
                `Cannot delete: ${productCount} product(s) still belong to this category. Reassign or delete them first.`,
                { product_count: productCount }
            );
        }

        conn.query('DELETE FROM categories WHERE category_id = ?', [id], (err2, result) => {
            if (err2) return sendResponse(res, 500, false, 'Database error', err2.message);
            if (result.affectedRows === 0) return sendResponse(res, 404, false, 'Category not found');
            return sendResponse(res, 200, true, 'Category deleted');
        });
    });
});

module.exports = router;