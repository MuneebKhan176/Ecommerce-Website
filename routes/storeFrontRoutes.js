// routes/storeFrontRoutes.js
//
// Public, read-only endpoints for the customer-facing homepage/storefront.
// No auth anywhere in this file — there are no customer accounts, so this
// is the ONLY catalog surface the frontend needs (it replaces the old
// User_Routes/userCatalogRoutes.js, which required a login). Mount at '/api'.
//
// GET /api/categories
// GET /api/products?gender=&category_id=&featured=true&search=&page=&limit=&ids=
// GET /api/products/:id            (now also returns rating_summary + related_products)
// GET /api/slider

const express = require('express');
const router = express.Router();

const { conn } = require('../Database/db_connection');
const { keyToUrl } = require('../utils/r2Upload');

const RELATED_PRODUCTS_LIMIT = 12;

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

// GET /categories — populates the homepage's category dropdown/filters.
// Sorted by the SAME combined display_order the admin panel manages
// (adminCategoryRoutes.js) — one sequence shared across MEN + WOMEN +
// OTHERS together — so category blocks on the homepage appear in the
// order an admin arranged them, not alphabetically.

router.get('/categories', (req, res) => {
    conn.query(
        `SELECT c.category_id, c.gender, c.category_name, c.display_order, COUNT(p.product_id) AS product_count
         FROM categories c
         LEFT JOIN products p ON p.category_id = c.category_id AND p.is_active = 1
         GROUP BY c.category_id, c.gender, c.category_name, c.display_order
         ORDER BY c.display_order ASC, c.category_id ASC`,
        (err, rows) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            return sendResponse(res, 200, true, 'Categories fetched', rows);
        }
    );
});
// GET /products?gender=MEN|WOMEN|OTHERS&category_id=&featured=true&search=&page=&limit=&ids=
// Always scoped to active products. `ids=3,7,12` hydrates a known set of
// product ids in one round trip (used by the cart drawer / checkout page
// to resolve whatever product_ids are sitting in sessionStorage) and
// bypasses pagination. `featured=true` is approximated as "newest
// arrivals" since the schema has no separate is_featured flag.
//
// NOTE: the `ids` branch used to push the whole `ids` array as a single
// bound param relying on mysql's "array auto-expands inside IN (?)"
// convenience. That convenience is driver/method-specific (it does NOT
// reliably work everywhere prepared statements are used) and was the
// root cause of checkout/cart-drawer product lookups silently coming
// back empty. Built explicit `IN (?,?,?)` placeholders instead — this
// works regardless of driver.
//
// UPDATED FOR v4 SCHEMA: the gender filter now accepts 'OTHERS' (the
// unisex/accessories bucket — Blankets, Shawls, Bedsheets, etc.) in
// addition to MEN/WOMEN, matching the widened categories.gender ENUM
// and the new "Others" tab on the storefront.
//
// IMPORTANT: this SELECT must include `p.is_active`. checkout.html (and
// the frontend generally) filters hydrated products on
// `byId[id].is_active` before allowing them into an order — if this
// column isn't selected here, that field comes back `undefined` on every
// row, the filter is always falsy, and the checkout page renders "no
// items selected" / "no longer available" even for perfectly valid,
// in-stock, active products. This was previously the case and broke both
// the cart checkout flow and the "Buy Now" flow from the product page
// (which routes through this same endpoint via /checkout?mode=buy_now).

router.get('/products', (req, res) => {
    const search = req.query.search?.trim();
    const gender = req.query.gender;
    const categoryId = req.query.category_id;
    const featured = req.query.featured === 'true';
    const idsParam = req.query.ids?.trim();

    const where = ['p.is_active = 1'];
    const params = [];
    let ids = null;

    if (idsParam) {
        ids = idsParam.split(',').map(n => Number(n)).filter(n => Number.isInteger(n) && n > 0);
        if (!ids.length) {
            return sendResponse(res, 200, true, 'Products fetched', { products: [], pagination: { page: 1, limit: 0, total: 0 } });
        }
        const placeholders = ids.map(() => '?').join(',');
        where.push(`p.product_id IN (${placeholders})`);
        params.push(...ids);
    } else {
        if (search) {
            where.push('(p.product_name LIKE ? OR p.sku LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }
        if (gender && ['MEN', 'WOMEN', 'OTHERS'].includes(gender)) {
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
    const limit = Math.min(parseInt(req.query.limit) || (featured ? 8 : 60), 100);
    const offset = (page - 1) * limit;
    const limitSql = idsParam ? '' : 'LIMIT ? OFFSET ?';
    const limitParams = idsParam ? [] : [limit, offset];

    // Sequencing fix: display_order on products is a PER-CATEGORY sequence
    // (see adminStockRoutes.js) — it's only meaningful when every row on
    // screen belongs to one category. That's exactly the shape of every
    // homepage category block request (?category_id=X with no gender-only
    // or search filter). Anything broader (browse-all, search, featured,
    // or the ids= cart-hydration lookup) falls back to newest-first, same
    // convention the admin listing uses for its own "All categories" view.
    const orderSql = (categoryId && !idsParam && !featured)
        ? 'ORDER BY p.display_order ASC, p.product_id ASC'
        : 'ORDER BY p.created_at DESC';

    const sql = `
        SELECT p.product_id, p.product_name, p.description, p.price, p.discount_percentage,
               p.stock, p.sku, p.low_stock_threshold, p.is_active, p.display_order,
               p.category_id, c.category_name, c.gender AS category_gender
        FROM products p
        JOIN categories c ON c.category_id = p.category_id
        ${whereSql}
        ${orderSql}
        ${limitSql}
    `;

    conn.query(sql, [...params, ...limitParams], (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);

        if (!rows.length) {
            return sendResponse(res, 200, true, 'Products fetched', { products: [], pagination: { page, limit, total: 0 } });
        }

        const productIds = rows.map(p => p.product_id);
        const mediaPlaceholders = productIds.map(() => '?').join(',');

        conn.query(
            `SELECT product_id, cloud_key FROM product_media
             WHERE product_id IN (${mediaPlaceholders}) ORDER BY product_id, display_order ASC`,
            productIds,
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

// Attaches the first image of each related product. Related products are
// fetched by id first, then this resolves images the same
// one-query-for-all-ids way the main /products list does, rather than
// N+1 queries per card.
function attachFirstImages(products, cb) {
    if (!products.length) return cb(null, products);

    const ids = products.map(p => p.product_id);
    const placeholders = ids.map(() => '?').join(',');

    conn.query(
        `SELECT product_id, cloud_key FROM product_media
         WHERE product_id IN (${placeholders}) ORDER BY product_id, display_order ASC`,
        ids,
        (err, mediaRows) => {
            if (err) return cb(err);

            const firstImageByProduct = {};
            for (const m of mediaRows) {
                if (!firstImageByProduct[m.product_id]) firstImageByProduct[m.product_id] = keyToUrl(m.cloud_key);
            }

            cb(null, products.map(p => withDiscount({
                ...p,
                images: firstImageByProduct[p.product_id] ? [firstImageByProduct[p.product_id]] : [],
            })));
        }
    );
}

// GET /products/:id — full product detail for the product page:
//   - the product itself (all images, full description)
//   - rating_summary (average_rating, review_count) so the page can
//     show stars without a second round trip on first paint
//   - related_products: other active products in the same category,
//     current product excluded (works the same regardless of the
//     category's gender bucket — MEN, WOMEN, or OTHERS)
router.get('/products/:id', (req, res) => {
    const { id } = req.params;

    conn.query(
        `SELECT p.*, c.category_name, c.gender AS category_gender FROM products p
         JOIN categories c ON c.category_id = p.category_id
         WHERE p.product_id = ? AND p.is_active = 1`,
        [id],
        (err, rows) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            if (!rows.length) return sendResponse(res, 404, false, 'Product not found');

            const product = rows[0];

            conn.query(
                'SELECT media_id, media_type, cloud_key, display_order FROM product_media WHERE product_id = ? ORDER BY display_order ASC',
                [id],
                (err2, media) => {
                    if (err2) return sendResponse(res, 500, false, 'Database error', err2.message);
                    const images = media.map(m => keyToUrl(m.cloud_key));

                    conn.query(
                        `SELECT COUNT(*) AS review_count, COALESCE(AVG(rating), 0) AS average_rating
                         FROM product_reviews WHERE product_id = ? AND is_approved = 1`,
                        [id],
                        (err3, ratingRows) => {
                            if (err3) return sendResponse(res, 500, false, 'Database error', err3.message);

                            const ratingSummary = {
                                review_count: Number(ratingRows[0].review_count) || 0,
                                average_rating: Math.round(Number(ratingRows[0].average_rating) * 10) / 10,
                            };

                            conn.query(
                                `SELECT p.product_id, p.product_name, p.price, p.discount_percentage,
                                        p.stock, p.low_stock_threshold, p.category_id
                                 FROM products p
                                 WHERE p.category_id = ? AND p.product_id != ? AND p.is_active = 1
                                 ORDER BY p.created_at DESC
                                 LIMIT ?`,
                                [product.category_id, id, RELATED_PRODUCTS_LIMIT],
                                (err4, relatedRows) => {
                                    if (err4) return sendResponse(res, 500, false, 'Database error', err4.message);

                                    attachFirstImages(relatedRows, (err5, relatedProducts) => {
                                        if (err5) return sendResponse(res, 500, false, 'Database error', err5.message);

                                        return sendResponse(res, 200, true, 'Product fetched', {
                                            ...withDiscount({ ...product, images }),
                                            rating_summary: ratingSummary,
                                            related_products: relatedProducts,
                                        });
                                    });
                                }
                            );
                        }
                    );
                }
            );
        }
    );
});

// GET /slider — active slides only, in display order, for the homepage carousel
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