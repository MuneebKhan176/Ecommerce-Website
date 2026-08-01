// routes/adminStockRoutes.js
//
// Everything "stock"-related lives here: product catalog CRUD (with R2
// image upload + discount pricing) AND the dedicated inventory/stock-level
// endpoints. Mount this at '/admin/api' in web.js.
//
// GET    /admin/api/products
// GET    /admin/api/products/:id
// POST   /admin/api/products
// PUT    /admin/api/products/:id
// DELETE /admin/api/products/:id
// DELETE /admin/api/products/:id/images/:mediaId
// GET    /admin/api/inventory
// PATCH  /admin/api/inventory/:productId
// PATCH  /admin/api/inventory/:productId/adjust

const express = require('express');
const router = express.Router();

const { conn } = require('../../Database/db_connection');
const { verifyToken } = require('../../middle/authMiddleware');
const { requireAdmin } = require('../../middle/adminAuth');
const upload = require('../../utils/uploadMiddleware');
const { uploadImages, deleteImage, keyToUrl } = require('../../utils/r2Upload');

function sendResponse(res, statusCode, success, message, data = null) {
    return res.status(statusCode).json({ success, message, data });
}

// The discounted price is NEVER stored — it's derived here from `price`
// (the original price) and `discount_percentage` every time a product is
// read, so it can never drift out of sync with either value. Every route
// that returns a product should pipe it through this.
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

router.use(verifyToken, requireAdmin);

// ============================================================
// PRODUCTS
// ============================================================

// GET /products?search=&gender=&category_id=&page=&limit=
router.get('/products', (req, res) => {
    const search = req.query.search?.trim();
    const gender = req.query.gender; // 'MEN' | 'WOMEN' | undefined
    const categoryId = req.query.category_id;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 60, 100);
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];

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

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `
        SELECT p.product_id, p.product_name, p.description, p.price, p.discount_percentage,
               p.stock, p.sku, p.is_active,
               p.category_id, c.category_name, c.gender AS category_gender
        FROM products p
        JOIN categories c ON c.category_id = p.category_id
        ${whereSql}
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
    `;

    conn.query(sql, [...params, limit, offset], (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);

        if (!rows.length) {
            return sendResponse(res, 200, true, 'Products fetched', {
                products: [],
                pagination: { page, limit, total: 0 },
            });
        }

        const productIds = rows.map(p => p.product_id);

        // One extra query for ALL images across this page of products (not just
        // a thumbnail) so the card carousel has something to browse through.
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

                const products = rows.map(p => withDiscount({
                    ...p,
                    images: imagesByProduct[p.product_id] || [],
                }));

                conn.query(`SELECT COUNT(*) AS total FROM products p JOIN categories c ON c.category_id = p.category_id ${whereSql}`, params, (err2, countRows) => {
                    if (err2) return sendResponse(res, 500, false, 'Database error', err2.message);
                    return sendResponse(res, 200, true, 'Products fetched', {
                        products,
                        pagination: { page, limit, total: countRows[0].total },
                    });
                });
            }
        );
    });
});


// GET /products/:id  (full detail + all images)
router.get('/products/:id', (req, res) => {
    const { id } = req.params;

    conn.query(
        `SELECT p.*, c.category_name FROM products p
         JOIN categories c ON c.category_id = p.category_id
         WHERE p.product_id = ?`,
        [id],
        (err, rows) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            if (!rows.length) return sendResponse(res, 404, false, 'Product not found');

            conn.query(
                'SELECT media_id, media_type, cloud_key, display_order FROM product_media WHERE product_id = ? ORDER BY display_order ASC',
                [id],
                (err2, media) => {
                    if (err2) return sendResponse(res, 500, false, 'Database error', err2.message);
                    const mediaWithUrls = media.map(m => ({ ...m, url: keyToUrl(m.cloud_key) }));
                    return sendResponse(res, 200, true, 'Product fetched', withDiscount({ ...rows[0], media: mediaWithUrls }));
                }
            );
        }
    );
});

// POST /products   (multipart/form-data, field "images" = up to 8 files)
router.post('/products', upload.array('images', 8), (req, res) => {
    const {
        product_name, description, price, discount_percentage, stock, sku,
        category_id, is_active, low_stock_threshold,
    } = req.body;

    if (!product_name || !price || !category_id) {
        return sendResponse(res, 400, false, 'product_name, price, and category_id are required');
    }

    const discountPct = discount_percentage === undefined || discount_percentage === ''
        ? 0 : Number(discount_percentage);

    if (Number.isNaN(discountPct) || discountPct < 0 || discountPct > 100) {
        return sendResponse(res, 400, false, 'discount_percentage must be between 0 and 100');
    }

    const sql = `
        INSERT INTO products
            (category_id, product_name, description, price, discount_percentage, stock, sku, is_active, low_stock_threshold)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
        category_id, product_name, description || null, price, discountPct,
        stock || 0, sku || null,
        is_active === undefined ? true : !!Number(is_active),
        low_stock_threshold || 10,
    ];

    conn.query(sql, params, async (err, result) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);

        const productId = result.insertId;

        if (!req.files || !req.files.length) {
            return sendResponse(res, 201, true, 'Product created', { product_id: productId });
        }

        try {
            const uploaded = await uploadImages(req.files, 'products');
            const values = uploaded.map((img, i) => [productId, 'IMAGE', img.key, i + 1]);

            conn.query(
                'INSERT INTO product_media (product_id, media_type, cloud_key, display_order) VALUES ?',
                [values],
                (mediaErr) => {
                    if (mediaErr) {
                        return sendResponse(res, 201, true,
                            'Product created, but saving image records failed', { product_id: productId, error: mediaErr.message });
                    }
                    return sendResponse(res, 201, true, 'Product created with images', {
                        product_id: productId,
                        images: uploaded,
                    });
                }
            );
        } catch (uploadErr) {
            return sendResponse(res, 201, true,
                'Product created, but image upload to R2 failed', { product_id: productId, error: uploadErr.message });
        }
    });
});

// PUT /products/:id  (multipart/form-data, optional new "images")
router.put('/products/:id', upload.array('images', 8), (req, res) => {
    const { id } = req.params;
    const {
        product_name, description, price, discount_percentage, stock, sku,
        category_id, is_active, low_stock_threshold,
    } = req.body;

    const discountPct = discount_percentage === undefined || discount_percentage === ''
        ? 0 : Number(discount_percentage);

    if (Number.isNaN(discountPct) || discountPct < 0 || discountPct > 100) {
        return sendResponse(res, 400, false, 'discount_percentage must be between 0 and 100');
    }

    const sql = `
        UPDATE products SET
            product_name = ?, description = ?, price = ?, discount_percentage = ?, stock = ?, sku = ?,
            category_id = ?, is_active = ?, low_stock_threshold = ?
        WHERE product_id = ?
    `;
    const params = [
        product_name, description || null, price, discountPct, stock, sku || null,
        category_id, !!Number(is_active), low_stock_threshold || 10, id,
    ];

    conn.query(sql, params, async (err, result) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);
        if (result.affectedRows === 0) return sendResponse(res, 404, false, 'Product not found');

        if (!req.files || !req.files.length) {
            return sendResponse(res, 200, true, 'Product updated');
        }

        try {
            const [{ maxOrder }] = await new Promise((resolve, reject) => {
                conn.query(
                    'SELECT COALESCE(MAX(display_order), 0) AS maxOrder FROM product_media WHERE product_id = ?',
                    [id],
                    (e, rows) => (e ? reject(e) : resolve(rows))
                );
            });

            const uploaded = await uploadImages(req.files, 'products');
            const values = uploaded.map((img, i) => [id, 'IMAGE', img.key, maxOrder + i + 1]);

            conn.query(
                'INSERT INTO product_media (product_id, media_type, cloud_key, display_order) VALUES ?',
                [values],
                (mediaErr) => {
                    if (mediaErr) return sendResponse(res, 200, true, 'Product updated, but adding new images failed', mediaErr.message);
                    return sendResponse(res, 200, true, 'Product updated with new images', { images: uploaded });
                }
            );
        } catch (uploadErr) {
            return sendResponse(res, 200, true, 'Product updated, but image upload failed', uploadErr.message);
        }
    });
});

// DELETE /products/:id  (also removes its images from R2)
router.delete('/products/:id', (req, res) => {
    const { id } = req.params;

    conn.query('SELECT cloud_key FROM product_media WHERE product_id = ?', [id], (err, mediaRows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);

        conn.query('DELETE FROM products WHERE product_id = ?', [id], async (delErr, result) => {
            if (delErr) return sendResponse(res, 500, false, 'Database error', delErr.message);
            if (result.affectedRows === 0) return sendResponse(res, 404, false, 'Product not found');

            try {
                await Promise.all(mediaRows.map(m => deleteImage(m.cloud_key)));
            } catch (r2Err) {
                console.error('⚠️ Failed to clean up R2 images for deleted product:', r2Err.message);
            }

            return sendResponse(res, 200, true, 'Product deleted');
        });
    });
});

// DELETE /products/:id/images/:mediaId  (remove a single image)
router.delete('/products/:id/images/:mediaId', (req, res) => {
    const { id, mediaId } = req.params;

    conn.query(
        'SELECT cloud_key FROM product_media WHERE media_id = ? AND product_id = ?',
        [mediaId, id],
        (err, rows) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            if (!rows.length) return sendResponse(res, 404, false, 'Image not found');

            conn.query('DELETE FROM product_media WHERE media_id = ?', [mediaId], async (delErr) => {
                if (delErr) return sendResponse(res, 500, false, 'Database error', delErr.message);

                try {
                    await deleteImage(rows[0].cloud_key);
                } catch (r2Err) {
                    console.error('⚠️ Failed to delete R2 image:', r2Err.message);
                }

                return sendResponse(res, 200, true, 'Image deleted');
            });
        }
    );
});

// ============================================================
// INVENTORY / STOCK
// ============================================================

// GET /inventory?search=&low_stock_only=&category_id=
router.get('/inventory', (req, res) => {
    const search = req.query.search?.trim();
    const lowStockOnly = req.query.low_stock_only === 'true';
    const categoryId = req.query.category_id;

    const where = [];
    const params = [];

    if (search) {
        where.push('(p.product_name LIKE ? OR p.sku LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
    }
    if (categoryId) {
        where.push('p.category_id = ?');
        params.push(categoryId);
    }
    if (lowStockOnly) {
        where.push('p.stock <= p.low_stock_threshold');
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `
        SELECT p.product_id, p.product_name, p.sku, p.stock, p.low_stock_threshold,
               c.category_name,
               (p.stock <= p.low_stock_threshold) AS is_low_stock
        FROM products p
        JOIN categories c ON c.category_id = p.category_id
        ${whereSql}
        ORDER BY is_low_stock DESC, p.stock ASC
    `;

    conn.query(sql, params, (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);
        return sendResponse(res, 200, true, 'Inventory fetched', rows);
    });
});

// PATCH /inventory/:productId   { stock } — absolute set
router.patch('/inventory/:productId', (req, res) => {
    const { productId } = req.params;
    const stock = Number(req.body.stock);

    if (Number.isNaN(stock) || stock < 0) {
        return sendResponse(res, 400, false, 'stock must be a non-negative number');
    }

    conn.query('UPDATE products SET stock = ? WHERE product_id = ?', [stock, productId], (err, result) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);
        if (result.affectedRows === 0) return sendResponse(res, 404, false, 'Product not found');
        return sendResponse(res, 200, true, 'Stock updated', { product_id: productId, stock });
    });
});

// PATCH /inventory/:productId/adjust   { delta }  — relative +/- (restock, correction)
router.patch('/inventory/:productId/adjust', (req, res) => {
    const { productId } = req.params;
    const delta = Number(req.body.delta);

    if (Number.isNaN(delta)) {
        return sendResponse(res, 400, false, 'delta must be a number (e.g. 5 or -3)');
    }

    conn.query(
        'UPDATE products SET stock = GREATEST(0, stock + ?) WHERE product_id = ?',
        [delta, productId],
        (err, result) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            if (result.affectedRows === 0) return sendResponse(res, 404, false, 'Product not found');

            conn.query('SELECT stock FROM products WHERE product_id = ?', [productId], (err2, rows) => {
                if (err2) return sendResponse(res, 500, false, 'Database error', err2.message);
                return sendResponse(res, 200, true, 'Stock adjusted', { product_id: productId, stock: rows[0].stock });
            });
        }
    );
});

module.exports = router;