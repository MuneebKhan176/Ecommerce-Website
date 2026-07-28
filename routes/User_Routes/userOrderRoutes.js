// routes/userOrderRoutes.js
//
// POST /api/orders        (multipart/form-data) — place an order, ONE payment screenshot required
// GET  /api/orders                              — this user's order history
// GET  /api/orders/:id                          — one order's full detail (items + payment)

const express = require('express');
const router = express.Router();

const { conn } = require('../../db_connection');
const { verifyToken } = require('../../middle/authMiddleware');
const upload = require('../../utils/uploadMiddleware');
const { uploadImages, keyToUrl } = require('../../utils/r2Upload');

function sendResponse(res, statusCode, success, message, data = null) {
    return res.status(statusCode).json({ success, message, data });
}

// Flat shipping fee applied to every order.
const SHIPPING_PRICE = 300;

function withDiscount(p) {
    const price = Number(p.price);
    const discountPercentage = Number(p.discount_percentage) || 0;
    const hasDiscount = discountPercentage > 0;
    const discountedPrice = hasDiscount
        ? Math.round((price - (price * discountPercentage) / 100) * 100) / 100
        : price;
    return discountedPrice;
}


// POST /orders
// Fields: items (JSON string: [{product_id, quantity}, ...]), full_name, phone,
// city, province, postal_code, address, screenshot (single file, required)


router.post('/orders', upload.single('screenshot'), (req, res) => {
    // ----- 1. Payment proof is mandatory. Schema stores exactly one screenshot per order. -----
    if (!req.file) {
        return sendResponse(res, 400, false, 'A payment screenshot is required to place an order');
    }

    let items;
    try {
        items = JSON.parse(req.body.items || '[]');
    } catch {
        return sendResponse(res, 400, false, 'items must be valid JSON');
    }
    if (!Array.isArray(items) || !items.length) {
        return sendResponse(res, 400, false, 'Select at least one item to order');
    }

    const { full_name, phone, city, province, postal_code, address } = req.body;
    if (!full_name || !phone || !city || !province || !postal_code || !address) {
        return sendResponse(res, 400, false, 'Full shipping address (name, phone, city, province, postal code, address) is required');
    }

    const productIds = items.map(i => Number(i.product_id)).filter(Boolean);
    if (!productIds.length) return sendResponse(res, 400, false, 'Invalid items');

    // ----- 2. Re-price everything server-side; never trust client-sent prices. -----
    conn.query(
        `SELECT product_id, product_name, price, discount_percentage, stock, is_active
         FROM products WHERE product_id IN (?)`,
        [productIds],
        (err, products) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);

            const productMap = {};
            products.forEach(p => (productMap[p.product_id] = p));

            const orderItems = [];
            for (const item of items) {
                const p = productMap[Number(item.product_id)];
                const qty = Math.max(parseInt(item.quantity) || 1, 1);

                if (!p) return sendResponse(res, 400, false, `Product ${item.product_id} not found`);
                if (!p.is_active) return sendResponse(res, 400, false, `${p.product_name} is no longer available`);
                if (p.stock < qty) return sendResponse(res, 400, false, `Only ${p.stock} left in stock for ${p.product_name}`);

                const unitPrice = withDiscount(p);
                orderItems.push({
                    product_id: p.product_id,
                    quantity: qty,
                    price: unitPrice,
                    total: Math.round(unitPrice * qty * 100) / 100,
                });
            }

            // orders.subtotal and orders.shipping_price are NOT NULL in the schema —
            // both must be supplied explicitly on insert.
            const subtotal = Math.round(orderItems.reduce((s, i) => s + i.total, 0) * 100) / 100;
            const shippingPrice = SHIPPING_PRICE;
            const totalPrice = Math.round((subtotal + shippingPrice) * 100) / 100;

            // ----- 3. Shipping address -----
            conn.query(
                `INSERT INTO addresses (user_id, full_name, phone, city, province, postal_code, address)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [req.user.id, full_name, phone, city, province, postal_code, address],
                (addrErr, addrResult) => {
                    if (addrErr) return sendResponse(res, 500, false, 'Database error saving address', addrErr.message);
                    const addressId = addrResult.insertId;

                    // ----- 4. The order itself -----
                    conn.query(
                        `INSERT INTO orders (user_id, address_id, status, subtotal, shipping_price, total_price)
                         VALUES (?, ?, 'PENDING', ?, ?, ?)`,
                        [req.user.id, addressId, subtotal, shippingPrice, totalPrice],
                        (orderErr, orderResult) => {
                            if (orderErr) return sendResponse(res, 500, false, 'Database error creating order', orderErr.message);
                            const orderId = orderResult.insertId;

                            // ----- 5. Order items -----
                            const itemValues = orderItems.map(i => [orderId, i.product_id, i.quantity, i.price, i.total]);
                            conn.query(
                                'INSERT INTO order_items (order_id, product_id, quantity, price, total) VALUES ?',
                                [itemValues],
                                (itemsErr) => {
                                    if (itemsErr) return sendResponse(res, 500, false, 'Database error saving order items', itemsErr.message);

                                    // ----- 6. Decrement stock -----
                                    const stockUpdates = orderItems.map(
                                        i => new Promise((resolve, reject) => {
                                            conn.query(
                                                'UPDATE products SET stock = GREATEST(0, stock - ?) WHERE product_id = ?',
                                                [i.quantity, i.product_id],
                                                (e) => (e ? reject(e) : resolve())
                                            );
                                        })
                                    );

                                    Promise.all(stockUpdates)
                                        .then(() => uploadImages([req.file], 'payment-screenshots'))
                                        .then(uploaded => new Promise((resolve, reject) => {
                                            // payments: one row per order (order_id UNIQUE), single screenshot_key column.
                                            conn.query(
                                                `INSERT INTO payments (order_id, screenshot_key, payment_status)
                                                 VALUES (?, ?, 'PENDING')`,
                                                [orderId, uploaded[0].key],
                                                (payErr) => (payErr ? reject(payErr) : resolve())
                                            );
                                        }))
                                        .then(() => new Promise((resolve, reject) => {
                                            // Clear only the ordered products out of the cart, not the whole cart,
                                            // in case "Buy Now" was used on a single item from a bigger cart.
                                            conn.query(
                                                'DELETE FROM cart_items WHERE user_id = ? AND product_id IN (?)',
                                                [req.user.id, productIds],
                                                (cartErr) => (cartErr ? reject(cartErr) : resolve())
                                            );
                                        }))
                                        .then(() => {
                                            return sendResponse(res, 201, true, 'Order placed successfully! We will verify your payment shortly.', {
                                                order_id: orderId,
                                                total_price: totalPrice,
                                            });
                                        })
                                        .catch(finalErr => {
                                            // Order + items are already committed at this point — surface the
                                            // failure but don't claim the order didn't go through.
                                            console.error('⚠️ Order placed but payment proof step failed:', finalErr.message);
                                            return sendResponse(res, 201, true,
                                                'Order placed, but we had trouble saving your payment screenshot. Please contact us on WhatsApp with your order number.',
                                                { order_id: orderId, total_price: totalPrice });
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

// GET /orders  — this user's order history
router.get('/orders', (req, res) => {
    conn.query(
        `SELECT o.order_id, o.status, o.total_price, o.created_at,
                (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.order_id) AS item_count
         FROM orders o
         WHERE o.user_id = ?
         ORDER BY o.created_at DESC`,
        [req.user.id],
        (err, rows) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            return sendResponse(res, 200, true, 'Orders fetched', rows);
        }
    );
});

// GET /orders/:id  — full detail, scoped to the logged-in user
// Each item now also carries `category_name` and `thumbnail_url` (the
// product's lowest display_order IMAGE from product_media), matching the
// admin order detail endpoint, so the customer can visually confirm what
// they ordered.
router.get('/orders/:id', (req, res) => {
    const { id } = req.params;

    conn.query(
        `SELECT o.*, a.full_name AS ship_name, a.phone AS ship_phone, a.city, a.province, a.postal_code, a.address
         FROM orders o JOIN addresses a ON a.address_id = o.address_id
         WHERE o.order_id = ? AND o.user_id = ?`,
        [id, req.user.id],
        (err, orderRows) => {
            if (err) return sendResponse(res, 500, false, 'Database error', err.message);
            if (!orderRows.length) return sendResponse(res, 404, false, 'Order not found');

            conn.query(
                `SELECT oi.item_id, oi.product_id, p.product_name, oi.quantity, oi.price, oi.total,
                        c.category_name,
                        pm.cloud_key AS thumbnail_key
                 FROM order_items oi
                 JOIN products p ON p.product_id = oi.product_id
                 JOIN categories c ON c.category_id = p.category_id
                 LEFT JOIN product_media pm
                        ON pm.product_id = p.product_id
                       AND pm.media_type = 'IMAGE'
                       AND pm.display_order = (
                            SELECT MIN(pm2.display_order)
                            FROM product_media pm2
                            WHERE pm2.product_id = p.product_id AND pm2.media_type = 'IMAGE'
                       )
                 WHERE oi.order_id = ?`,
                [id],
                (err2, items) => {
                    if (err2) return sendResponse(res, 500, false, 'Database error', err2.message);

                    const itemsWithMedia = items.map(i => {
                        const { thumbnail_key, ...rest } = i;
                        return {
                            ...rest,
                            thumbnail_url: thumbnail_key ? keyToUrl(thumbnail_key) : null,
                        };
                    });

                    // payments: one row per order — no join table needed.
                    conn.query(
                        `SELECT payment_method, screenshot_key, payment_status, uploaded_at
                         FROM payments WHERE order_id = ?`,
                        [id],
                        (err3, payRows) => {
                            if (err3) return sendResponse(res, 500, false, 'Database error', err3.message);

                            const payment = payRows.length ? {
                                payment_method: payRows[0].payment_method,
                                payment_status: payRows[0].payment_status,
                                uploaded_at: payRows[0].uploaded_at,
                                screenshot: keyToUrl(payRows[0].screenshot_key),
                            } : null;

                            return sendResponse(res, 200, true, 'Order fetched', {
                                ...orderRows[0],
                                items: itemsWithMedia,
                                payment,
                            });
                        }
                    );
                }
            );
        }
    );
});

module.exports = router;