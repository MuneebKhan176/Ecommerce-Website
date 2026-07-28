// routes/User_Routes/userCatalogRoutes.js
//
// Public/customer-facing catalog — same data shape as adminStockRoutes.js's
// product endpoints, but read-only, scoped to active products, and without
// requireAdmin.
//
// GET /api/products?search=&gender=&category_id=&page=&limit=&ids=
// GET /api/products/:id
// GET /api/categories

const express = require('express');
const router = express.Router();

const { conn } = require('../../db_connection');
const { verifyToken } = require('../../middle/authMiddleware');
const { keyToUrl } = require('../../utils/r2Upload');

function sendResponse(res, statusCode, success, message, data = null) {
    return res.status(statusCode).json({ success, message, data });
}

// Kept identical to the copy in adminStockRoutes.js on purpose — the
// discounted price must never be persisted, only derived on read.
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

router.use(verifyToken);

// GET /products?search=&gender=&category_id=&page=&limit=
// GET /products?ids=3,7,12   (used by the cart/order pages to hydrate a
// known set of product ids in one round trip — bypasses pagination)
router.get('/products', (req, res) => {
    const search = req.query.search?.trim();
    const gender = req.query.gender;
    const categoryId = req.query.category_id;
    const idsParam = req.query.ids?.trim();

    const where = ['p.is_active = 1'];
    const params = [];

    if (idsParam) {
        const ids = idsParam.split(',').map(n => Number(n)).filter(n => Number.isInteger(n) && n > 0);
        if (!ids.length) return sendResponse(res, 200, true, 'Products fetched', { products: [], pagination: { page: 1, limit: 0, total: 0 } });
        where.push('p.product_id IN (?)');
        params.push(ids);
    } else {
        if (search) {
            where.push('(p.product_name LIKE ? OR p.sku LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }
        if (gender && ['MEN', 'WOMEN'].includes(gender)) {
            where.push('c.gender = ?');
            params.push(gender);
        }
        if (categoryId) {
            where.push('p.category_id = ?');
            params.push(categoryId);
        }
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 60, 100);
    const offset = (page - 1) * limit;
    const limitSql = idsParam ? '' : 'LIMIT ? OFFSET ?';
    const limitParams = idsParam ? [] : [limit, offset];

    const sql = `
        SELECT p.product_id, p.product_name, p.description, p.price, p.discount_percentage,
               p.stock, p.sku, p.low_stock_threshold, p.is_active,
               p.category_id, c.category_name, c.gender AS category_gender
        FROM products p
        JOIN categories c ON c.category_id = p.category_id
        ${whereSql}
        ORDER BY p.created_at DESC
        ${limitSql}
    `;

    conn.query(sql, [...params, ...limitParams], (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);

        if (!rows.length) {
            return sendResponse(res, 200, true, 'Products fetched', { products: [], pagination: { page, limit, total: 0 } });
        }

        const productIds = rows.map(p => p.product_id);

        conn.query(
            `SELECT product_id, cloud_key, display_order FROM product_media
             WHERE product_id IN (?) ORDER BY product_id, display_order ASC`,
            [productIds],
            (mediaErr, mediaRows) => {
                if (mediaErr) return sendResponse(res, 500, false, 'Database error', mediaErr.message);

                const imagesByProduct = {};
                for (const m of mediaRows) {
                    if (!imagesByProduct[m.product_id]) imagesByProduct[m.product_id] = [];
                    imagesByProduct[m.product_id].push(keyToUrl(m.cloud_key));
                }

                const products = rows.map(p => withDiscount({ ...p, images: imagesByProduct[p.product_id] || [] }));

                if (idsParam) {
                    return sendResponse(res, 200, true, 'Products fetched', {
                        products, pagination: { page: 1, limit: products.length, total: products.length },
                    });
                }

                conn.query(
                    `SELECT COUNT(*) AS total FROM products p JOIN categories c ON c.category_id = p.category_id ${whereSql}`,
                    params,
                    (err2, countRows) => {
                        if (err2) return sendResponse(res, 500, false, 'Database error', err2.message);
                        return sendResponse(res, 200, true, 'Products fetched', {
                            products,
                            pagination: { page, limit, total: countRows[0].total },
                        });
                    }
                );
            }
        );
    });
});

// GET /products/:id
router.get('/products/:id', (req, res) => {
    const { id } = req.params;

    conn.query(
        `SELECT p.*, c.category_name FROM products p
         JOIN categories c ON c.category_id = p.category_id
         WHERE p.product_id = ? AND p.is_active = 1`,
        [id],
        (err, rows) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            if (!rows.length) return sendResponse(res, 404, false, 'Product not found');

            conn.query(
                'SELECT media_id, media_type, cloud_key, display_order FROM product_media WHERE product_id = ? ORDER BY display_order ASC',
                [id],
                (err2, media) => {
                    if (err2) return sendResponse(res, 500, false, 'Database error', err2.message);
                    const images = media.map(m => keyToUrl(m.cloud_key));
                    return sendResponse(res, 200, true, 'Product fetched', withDiscount({ ...rows[0], images }));
                }
            );
        }
    );
});

// GET /categories
router.get('/categories', (req, res) => {
    conn.query(
        `SELECT c.category_id, c.gender, c.category_name, COUNT(p.product_id) AS product_count
         FROM categories c
         LEFT JOIN products p ON p.category_id = c.category_id AND p.is_active = 1
         GROUP BY c.category_id, c.gender, c.category_name
         ORDER BY c.gender, c.category_name`,
        (err, rows) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            return sendResponse(res, 200, true, 'Categories fetched', rows);
        }
    );
});

module.exports = router;