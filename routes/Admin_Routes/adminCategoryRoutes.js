// routes/adminCategoryRoutes.js
//
// GET    /admin/api/categories
// POST   /admin/api/categories
// PUT    /admin/api/categories/:id
// DELETE /admin/api/categories/:id

const express = require('express');
const router = express.Router();

const { conn } = require('../../db_connection');
const { verifyToken } = require('../../middle/authMiddleware');
const { requireAdmin } = require('../../middle/adminAuth');

function sendResponse(res, statusCode, success, message, data = null) {
    return res.status(statusCode).json({ success, message, data });
}

router.use(verifyToken, requireAdmin);

// GET /categories — every category with a live product count
router.get('/categories', (req, res) => {
    const sql = `
        SELECT c.category_id, c.gender, c.category_name,
               COUNT(p.product_id) AS product_count
        FROM categories c
        LEFT JOIN products p ON p.category_id = c.category_id
        GROUP BY c.category_id, c.gender, c.category_name
        ORDER BY c.gender, c.category_name
    `;
    conn.query(sql, (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);
        return sendResponse(res, 200, true, 'Categories fetched', rows);
    });
});

// POST /categories   { gender, category_name }
router.post('/categories', (req, res) => {
    const gender = req.body.gender;
    const category_name = req.body.category_name?.trim();

    if (!['MEN', 'WOMEN'].includes(gender) || !category_name) {
        return sendResponse(res, 400, false, 'gender (MEN/WOMEN) and category_name are required');
    }

    conn.query(
        'INSERT INTO categories (gender, category_name) VALUES (?, ?)',
        [gender, category_name],
        (err, result) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            return sendResponse(res, 201, true, 'Category created', { category_id: result.insertId });
        }
    );
});

// PUT /categories/:id   { gender, category_name }
router.put('/categories/:id', (req, res) => {
    const { id } = req.params;
    const gender = req.body.gender;
    const category_name = req.body.category_name?.trim();

    if (!['MEN', 'WOMEN'].includes(gender) || !category_name) {
        return sendResponse(res, 400, false, 'gender (MEN/WOMEN) and category_name are required');
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