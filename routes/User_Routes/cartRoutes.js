// routes/User_Routes/cartRoutes.js
//
// GET    /api/cart                — current user's cart, hydrated with product info, newest first
// GET    /api/cart/count          — number of distinct products in the cart, for the sidebar badge
// GET    /api/cart/product-ids    — just the product_ids in the cart, for "already added" button state
// POST   /api/cart                { product_id }  — add once; 409 if it's already in the cart
// DELETE /api/cart/:cartItemId                     — remove one line (the only way to re-add it)
// DELETE /api/cart                                 — clear the whole cart
//
// NOTE: cart_items no longer has a `quantity` column. A product is either
// in the cart or it isn't — the UNIQUE (user_id, product_id) constraint on
// the table enforces "can't add the same product twice" at the DB level;
// this file just turns a duplicate-key error into a clean 409.
//
// CHANGE (images): GET /cart previously pulled a single cloud_key via a
// `LIMIT 1` subquery, so the cart card only ever had one image to show.
// It now LEFT JOINs product_media directly and groups the rows in JS,
// so every item comes back with a full `images: [...]` array — same
// idea as the admin product view, just built without GROUP_CONCAT so it
// stays easy to read/debug.

const express = require('express');
const router = express.Router();

const { conn } = require('../../db_connection');
const { verifyToken } = require('../../middle/authMiddleware');
const { keyToUrl } = require('../../utils/r2Upload');

function sendResponse(res, statusCode, success, message, data = null) {
    return res.status(statusCode).json({ success, message, data });
}

function withDiscount(p) {
    const price = Number(p.price);
    const discountPercentage = Number(p.discount_percentage) || 0;
    const hasDiscount = discountPercentage > 0;
    const discountedPrice = hasDiscount
        ? Math.round((price - (price * discountPercentage) / 100) * 100) / 100
        : price;
    return { price, discount_percentage: discountPercentage, has_discount: hasDiscount, discounted_price: discountedPrice };
}

router.use(verifyToken);

// ================= GET /cart =================
// Newest-added product first. LEFT JOIN on categories on purpose — a
// product whose category_id doesn't match a row in `categories` should
// still show up in the cart instead of silently vanishing. Same idea for
// product_media: LEFT JOIN so a product with zero images still shows up
// (with images: []), instead of getting dropped by an inner join.
router.get('/cart', (req, res) => {
    const sql = `
        SELECT ci.cart_item_id, ci.created_at,
               p.product_id, p.product_name, p.price, p.discount_percentage,
               p.stock, p.is_active, p.low_stock_threshold,
               p.category_id, c.category_name, c.gender,
               pm.cloud_key, pm.display_order, pm.media_id
        FROM cart_items ci
        JOIN products p ON p.product_id = ci.product_id
        LEFT JOIN categories c ON c.category_id = p.category_id
        LEFT JOIN product_media pm
               ON pm.product_id = p.product_id AND pm.media_type = 'IMAGE'
        WHERE ci.user_id = ?
        ORDER BY ci.created_at DESC, pm.display_order ASC, pm.media_id ASC
    `;

    conn.query(sql, [req.user.id], (err, rows) => {
        if (err) {
            console.error('GET /cart — SQL error for user', req.user.id, ':', err);
            return sendResponse(res, 500, false, 'Database error', err.message);
        }

        let items;
        try {
            // Collapse the (cart_item x images) row fan-out into one object
            // per cart item, with an `images` array built in display order.
            const byCartItem = new Map();

            for (const r of rows) {
                if (!byCartItem.has(r.cart_item_id)) {
                    const d = withDiscount(r);
                    byCartItem.set(r.cart_item_id, {
                        cart_item_id: r.cart_item_id,
                        product_id: r.product_id,
                        product_name: r.product_name,
                        is_active: !!r.is_active,
                        stock: r.stock,
                        low_stock_threshold: r.low_stock_threshold,
                        category_id: r.category_id,
                        category_name: r.category_name,
                        gender: r.gender,
                        images: [],
                        // kept for any older frontend code still reading `image` (first image)
                        image: null,
                        added_at: r.created_at,
                        ...d,
                    });
                }
                if (r.cloud_key) {
                    const entry = byCartItem.get(r.cart_item_id);
                    const url = keyToUrl(r.cloud_key);
                    entry.images.push(url);
                    if (!entry.image) entry.image = url;
                }
            }

            items = Array.from(byCartItem.values());
        } catch (mapErr) {
            console.error('GET /cart — failed while building response for user', req.user.id, mapErr);
            return sendResponse(res, 500, false, 'Could not build cart response', mapErr.message);
        }

        const summary = {
            item_count: items.length,
            subtotal: Math.round(items.reduce((s, i) => s + i.discounted_price, 0) * 100) / 100,
        };

        return sendResponse(res, 200, true, 'Cart fetched', { items, summary });
    });
});

// ================= GET /cart/count =================
// Distinct product count — there's no quantity to sum anymore.
router.get('/cart/count', (req, res) => {
    conn.query('SELECT COUNT(*) AS item_count FROM cart_items WHERE user_id = ?', [req.user.id], (err, rows) => {
        if (err) {
            console.error('GET /cart/count — SQL error for user', req.user.id, ':', err);
            return sendResponse(res, 500, false, 'Database error', err.message);
        }
        return sendResponse(res, 200, true, 'Count fetched', rows[0]);
    });
});

// ================= GET /cart/product-ids =================
router.get('/cart/product-ids', (req, res) => {
    conn.query('SELECT product_id FROM cart_items WHERE user_id = ?', [req.user.id], (err, rows) => {
        if (err) {
            console.error('GET /cart/product-ids — SQL error for user', req.user.id, ':', err);
            return sendResponse(res, 500, false, 'Database error', err.message);
        }
        return sendResponse(res, 200, true, 'Cart product ids fetched', rows.map(r => r.product_id));
    });
});

// ================= POST /cart =================
// body: { product_id }  — add once. If it's already in the cart, the
// UNIQUE (user_id, product_id) constraint rejects the INSERT and we
// surface that as a clean 409 rather than a raw DB error.
router.post('/cart', (req, res) => {
    const productId = Number(req.body.product_id);
    if (!productId) return sendResponse(res, 400, false, 'product_id is required');

    conn.query('SELECT stock, is_active FROM products WHERE product_id = ?', [productId], (err, rows) => {
        if (err) {
            console.error('POST /cart — product lookup error for user', req.user.id, ':', err);
            return sendResponse(res, 500, false, 'Database error', err.message);
        }
        if (!rows.length) return sendResponse(res, 404, false, 'Product not found');

        const product = rows[0];
        if (!product.is_active) return sendResponse(res, 400, false, 'This product is not available');
        if (product.stock <= 0) return sendResponse(res, 400, false, 'This product is out of stock');

        conn.query(
            'INSERT INTO cart_items (user_id, product_id) VALUES (?, ?)',
            [req.user.id, productId],
            (err2, result) => {
                if (err2) {
                    if (err2.code === 'ER_DUP_ENTRY') {
                        return sendResponse(res, 409, false, 'This item is already in your cart');
                    }
                    console.error('POST /cart — insert error for user', req.user.id, ':', err2);
                    return sendResponse(res, 500, false, 'Database error', err2.message);
                }
                return sendResponse(res, 201, true, 'Added to cart', { cart_item_id: result.insertId });
            }
        );
    });
});

// ================= DELETE /cart/:cartItemId =================
router.delete('/cart/:cartItemId', (req, res) => {
    const { cartItemId } = req.params;
    conn.query('DELETE FROM cart_items WHERE cart_item_id = ? AND user_id = ?', [cartItemId, req.user.id], (err, result) => {
        if (err) {
            console.error('DELETE /cart/:id — error for user', req.user.id, ':', err);
            return sendResponse(res, 500, false, 'Database error', err.message);
        }
        if (result.affectedRows === 0) return sendResponse(res, 404, false, 'Cart item not found');
        return sendResponse(res, 200, true, 'Removed from cart');
    });
});

// ================= DELETE /cart =================
// Clears the whole cart — used after an order is successfully placed.
router.delete('/cart', (req, res) => {
    conn.query('DELETE FROM cart_items WHERE user_id = ?', [req.user.id], (err) => {
        if (err) {
            console.error('DELETE /cart — error for user', req.user.id, ':', err);
            return sendResponse(res, 500, false, 'Database error', err.message);
        }
        return sendResponse(res, 200, true, 'Cart cleared');
    });
});

module.exports = router;