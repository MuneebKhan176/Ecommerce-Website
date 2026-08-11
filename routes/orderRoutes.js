// routes/orderRoutes.js
//
// Guest checkout — replaces the old User_Routes/userOrderRoutes.js.
// No verifyToken, no accounts: the buyer's name/phone/address is typed
// fresh at checkout and stored directly on the order row (see the v2
// schema). There is no "my orders" list anymore, since there is no login
// to own one — order status is instead looked up per-order by pairing
// the order id with the phone number that placed it.
//
// POST /api/orders          (multipart/form-data) — place an order, ONE payment screenshot required
// GET  /api/orders/:id?phone=...   — order status lookup (order id + phone must match)

const express = require('express');
const router = express.Router();

const { conn } = require('../Database/db_connection');
const upload = require('../utils/uploadMiddleware');
const { uploadImages, keyToUrl } = require('../utils/r2Upload');

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
// email (optional), city, province, postal_code, address, screenshot (single file, required).
//
// Used by BOTH the "Buy Now" flow (single-item items array) and the cart
// checkout flow (multi-item items array built from localStorage) — the
// homepage sends the same shape either way.
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

    const full_name = req.body.full_name?.trim();
    const phone = req.body.phone?.trim();
    const email = req.body.email?.trim() || null;
    const city = req.body.city?.trim();
    const province = req.body.province?.trim();
    const postal_code = req.body.postal_code?.trim();
    const address = req.body.address?.trim();

    if (!full_name || !phone || !city || !province || !postal_code || !address) {
        return sendResponse(res, 400, false, 'Full shipping details (name, phone, city, province, postal code, address) are required');
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

            const subtotal = Math.round(orderItems.reduce((s, i) => s + i.total, 0) * 100) / 100;
            const shippingPrice = SHIPPING_PRICE;
            const totalPrice = Math.round((subtotal + shippingPrice) * 100) / 100;

            // ----- 3. The order itself — buyer/shipping info stored directly, no address table. -----
            conn.query(
                `INSERT INTO orders
                    (full_name, phone, email, city, province, postal_code, address, status, subtotal, shipping_price, total_price)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`,
                [full_name, phone, email, city, province, postal_code, address, subtotal, shippingPrice, totalPrice],
                (orderErr, orderResult) => {
                    if (orderErr) return sendResponse(res, 500, false, 'Database error creating order', orderErr.message);
                    const orderId = orderResult.insertId;

                    // ----- 4. Order items -----
                    const itemValues = orderItems.map(i => [orderId, i.product_id, i.quantity, i.price, i.total]);
                    conn.query(
                        'INSERT INTO order_items (order_id, product_id, quantity, price, total) VALUES ?',
                        [itemValues],
                        (itemsErr) => {
                            if (itemsErr) return sendResponse(res, 500, false, 'Database error saving order items', itemsErr.message);

                            // ----- 5. Decrement stock -----
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
                                    conn.query(
                                        `INSERT INTO payments (order_id, screenshot_key, payment_status)
                                         VALUES (?, ?, 'PENDING')`,
                                        [orderId, uploaded[0].key],
                                        (payErr) => (payErr ? reject(payErr) : resolve())
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
});

// GET /orders/:id?phone=...  — order status lookup.
// There's no login anymore, so instead of "my orders" this is a
// receipt/status page: the buyer needs BOTH the order id (from their
// confirmation) AND the phone number they checked out with.
router.get('/orders/:id', (req, res) => {
    const { id } = req.params;
    const phone = req.query.phone?.trim();

    if (!phone) {
        return sendResponse(res, 400, false, 'Provide the phone number used at checkout to look up this order');
    }

    conn.query(
        `SELECT * FROM orders WHERE order_id = ? AND phone = ?`,
        [id, phone],
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
