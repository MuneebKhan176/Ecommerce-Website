// routes/reviewRoutes.js
//
// Public review endpoints for the guest-checkout storefront. No auth —
// anyone can leave a review, same trust model as guest checkout (there
// are no customer accounts to attach a review to). Mount at '/api'.
//
// GET  /api/products/:id/reviews?page=&limit=   -> { summary, reviews, pagination }
// POST /api/products/:id/reviews                 -> body { reviewer_name, rating, review_text }

const express = require('express');
const router = express.Router();

const { conn } = require('../Database/db_connection');

function sendResponse(res, statusCode, success, message, data = null) {
    return res.status(statusCode).json({ success, message, data });
}

function isValidProductId(id) {
    return Number.isInteger(id) && id > 0;
}

// Shared aggregate used by both GET (summary) and POST (fresh summary
// after inserting) so the two never drift out of sync with each other.
function getRatingSummary(productId, cb) {
    conn.query(
        `SELECT
            COUNT(*) AS review_count,
            COALESCE(AVG(rating), 0) AS average_rating,
            SUM(rating = 5) AS r5,
            SUM(rating = 4) AS r4,
            SUM(rating = 3) AS r3,
            SUM(rating = 2) AS r2,
            SUM(rating = 1) AS r1
         FROM product_reviews
         WHERE product_id = ? AND is_approved = 1`,
        [productId],
        (err, rows) => {
            if (err) return cb(err);
            const row = rows[0];
            cb(null, {
                review_count: Number(row.review_count) || 0,
                average_rating: Math.round(Number(row.average_rating) * 10) / 10,
                breakdown: {
                    5: Number(row.r5) || 0,
                    4: Number(row.r4) || 0,
                    3: Number(row.r3) || 0,
                    2: Number(row.r2) || 0,
                    1: Number(row.r1) || 0,
                },
            });
        }
    );
}

// GET /products/:id/reviews?page=&limit=
router.get('/products/:id/reviews', (req, res) => {
    const productId = Number(req.params.id);
    if (!isValidProductId(productId)) return sendResponse(res, 400, false, 'Invalid product id');

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 50);
    const offset = (page - 1) * limit;

    getRatingSummary(productId, (err, summary) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);

        conn.query(
            `SELECT review_id, reviewer_name, rating, review_text, created_at
             FROM product_reviews
             WHERE product_id = ? AND is_approved = 1
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [productId, limit, offset],
            (err2, rows) => {
                if (err2) return sendResponse(res, 500, false, 'Database error', err2.message);

                return sendResponse(res, 200, true, 'Reviews fetched', {
                    summary,
                    reviews: rows,
                    pagination: { page, limit, total: summary.review_count },
                });
            }
        );
    });
});

// POST /products/:id/reviews
// body: { reviewer_name, rating, review_text }
router.post('/products/:id/reviews', (req, res) => {
    const productId = Number(req.params.id);
    if (!isValidProductId(productId)) return sendResponse(res, 400, false, 'Invalid product id');

    const reviewerName = String(req.body.reviewer_name || '').trim();
    const rating = Number(req.body.rating);
    const reviewText = String(req.body.review_text || '').trim();

    if (!reviewerName) return sendResponse(res, 400, false, 'Please enter your name');
    if (reviewerName.length > 100) return sendResponse(res, 400, false, 'Name must be under 100 characters');
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return sendResponse(res, 400, false, 'Please select a star rating from 1 to 5');
    }
    if (reviewText.length > 2000) return sendResponse(res, 400, false, 'Review text must be under 2000 characters');

    // Only let reviews attach to a product that actually exists and is
    // still active/listed — mirrors the same check orderRoutes.js does
    // before accepting an order line for a product.
    conn.query(
        'SELECT product_id FROM products WHERE product_id = ? AND is_active = 1',
        [productId],
        (err, rows) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            if (!rows.length) return sendResponse(res, 404, false, 'Product not found');

            conn.query(
                'INSERT INTO product_reviews (product_id, reviewer_name, rating, review_text) VALUES (?, ?, ?, ?)',
                [productId, reviewerName, rating, reviewText || null],
                (err2, result) => {
                    if (err2) return sendResponse(res, 500, false, 'Database error', err2.message);

                    getRatingSummary(productId, (err3, summary) => {
                        if (err3) return sendResponse(res, 500, false, 'Database error', err3.message);

                        return sendResponse(res, 201, true, 'Thanks for your review!', {
                            review: {
                                review_id: result.insertId,
                                reviewer_name: reviewerName,
                                rating,
                                review_text: reviewText || null,
                                created_at: new Date().toISOString(),
                            },
                            summary,
                        });
                    });
                }
            );
        }
    );
});

module.exports = router;