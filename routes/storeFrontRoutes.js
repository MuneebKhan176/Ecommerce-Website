// routes/storefrontRoutes.js
//
// Public, read-only endpoints for the customer-facing homepage. No auth —
// these only ever expose active/in-stock catalog data. Mount at '/api'.
//
// GET /api/categories
// GET /api/products?gender=&category_id=&featured=true&limit=
// GET /api/slider

const express = require('express');
const router = express.Router();

const { conn } = require('../db_connection');
const { keyToUrl } = require('../utils/r2Upload');

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

    return {
        ...p,
        price,
        discount_percentage: discountPercentage,
        has_discount: hasDiscount,
        discounted_price: discountedPrice,
    };
}

// GET /categories — used to populate the homepage's Categories dropdown
router.get('/categories', (req, res) => {
    conn.query(
        'SELECT category_id, gender, category_name FROM categories ORDER BY gender, category_name',
        (err, rows) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            return sendResponse(res, 200, true, 'Categories fetched', rows);
        }
    );
});

// GET /products?gender=MEN|WOMEN&category_id=&featured=true&limit=
// Only ever returns active, in-stock-or-not products (storefront shows
// out-of-stock as "sold out" client-side rather than hiding them).
// `featured=true` is approximated as "newest arrivals" since the schema
// has no separate is_featured flag — swap this query if one is added later.
router.get('/products', (req, res) => {
    const gender = req.query.gender;
    const categoryId = req.query.category_id;
    const featured = req.query.featured === 'true';
    const limit = Math.min(parseInt(req.query.limit) || (featured ? 8 : 60), 100);

    const where = ['p.is_active = 1'];
    const params = [];

    if (gender && ['MEN', 'WOMEN'].includes(gender)) {
        where.push('c.gender = ?');
        params.push(gender);
    }
    if (categoryId) {
        where.push('p.category_id = ?');
        params.push(categoryId);
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;

    const sql = `
        SELECT p.product_id, p.product_name, p.description, p.price, p.discount_percentage,
               p.stock, p.sku, p.category_id, c.category_name, c.gender AS category_gender
        FROM products p
        JOIN categories c ON c.category_id = p.category_id
        ${whereSql}
        ORDER BY p.created_at DESC
        LIMIT ?
    `;

    conn.query(sql, [...params, limit], (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);

        if (!rows.length) return sendResponse(res, 200, true, 'Products fetched', []);

        const productIds = rows.map(p => p.product_id);

        // Fetch EVERY image for every product on this page (not just the
        // first one) so the storefront card carousel has the same full
        // gallery the admin Products page already shows.
        conn.query(
            `SELECT product_id, cloud_key FROM product_media
             WHERE product_id IN (?) ORDER BY product_id, display_order ASC`,
            [productIds],
            (mediaErr, mediaRows) => {
                if (mediaErr) return sendResponse(res, 500, false, 'Database error', mediaErr.message);

                const imagesByProduct = {};
                for (const m of mediaRows) {
                    if (!imagesByProduct[m.product_id]) imagesByProduct[m.product_id] = [];
                    imagesByProduct[m.product_id].push(keyToUrl(m.cloud_key));
                }

                const products = rows.map(p => withDiscount({
                    ...p,
                    images: imagesByProduct[p.product_id] || [],
                }));

                return sendResponse(res, 200, true, 'Products fetched', products);
            }
        );
    });
});

// GET /slider — active slides only, in display order, for the About Us carousel
router.get('/slider', (req, res) => {
    conn.query(
        'SELECT slider_id, cloud_key, caption FROM homepage_sliders WHERE is_active = 1 ORDER BY display_order ASC, slider_id ASC',
        (err, rows) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            const slides = rows.map(s => ({ ...s, url: keyToUrl(s.cloud_key) }));
            return sendResponse(res, 200, true, 'Slides fetched', slides);
        }
    );
});

module.exports = router;