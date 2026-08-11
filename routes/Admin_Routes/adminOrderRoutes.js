// routes/Admin_Routes/adminOrderRoutes.js
//
// Admin order management: listing, detail, STEP-GATED status changes
// (one step forward at a time, no arbitrary enum jumps), and payment
// screenshot verification. Mount this at '/admin/api' in web.js.
//
// UPDATED FOR v2 SCHEMA: orders no longer join to `addresses` or `users`
// — buyer name/phone/email/shipping address live directly on the
// `orders` row (guest checkout, see Database/schema.sql), so every query
// below reads those columns straight off `o` instead of joining out to
// tables that no longer exist.
//
// GET   /admin/api/orders                     — list (filter by status/search, paginated)
// GET   /admin/api/orders/:id                 — full detail (items + shipping info + payment)
// PATCH /admin/api/orders/:id/advance          — move to the NEXT status in the flow
//                                                 (blocked until payment is VERIFIED)
// PATCH /admin/api/orders/:id/cancel           — cancel (only if not COMPLETED/CANCELLED)
// PATCH /admin/api/orders/:id/payment          — { action: 'VERIFY' | 'REJECT' }
//                                                 (REJECT also cancels the order)

const express = require('express');
const router = express.Router();

const { conn } = require('../../Database/db_connection');
const { verifyToken } = require('../../middle/authMiddleware');
const { requireAdmin } = require('../../middle/adminAuth');
const { keyToUrl } = require('../../utils/r2Upload');

function sendResponse(res, statusCode, success, message, data = null) {
    return res.status(statusCode).json({ success, message, data });
}

router.use(verifyToken, requireAdmin);

// ============================================================
// Status flow — CANCELLED is a separate dead-end branch reachable
// from any non-terminal state; it is never part of the forward chain.
// ============================================================
const STATUS_FLOW = ['PENDING', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'COMPLETED'];
const ALL_STATUSES = [...STATUS_FLOW, 'CANCELLED'];

function nextStatus(current) {
    const idx = STATUS_FLOW.indexOf(current);
    if (idx === -1 || idx === STATUS_FLOW.length - 1) return null; // CANCELLED or already COMPLETED
    return STATUS_FLOW[idx + 1];
}

// GET /orders?status=&search=&page=&limit=
// search now matches order id, buyer name, or phone directly off `orders` —
// no address table to join for that anymore.
router.get('/orders', (req, res) => {
    const status = req.query.status;
    const search = req.query.search?.trim();
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];

    if (status && ALL_STATUSES.includes(status)) {
        where.push('o.status = ?');
        params.push(status);
    }
    if (search) {
        where.push('(o.order_id = ? OR o.full_name LIKE ? OR o.phone LIKE ?)');
        params.push(Number(search) || -1, `%${search}%`, `%${search}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `
        SELECT o.order_id, o.status, o.subtotal, o.shipping_price, o.total_price, o.created_at,
               o.full_name AS customer_name, o.phone AS customer_phone, o.city,
               p.payment_status, p.screenshot_key,
               (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.order_id) AS item_count
        FROM orders o
        LEFT JOIN payments p ON p.order_id = o.order_id
        ${whereSql}
        ORDER BY o.created_at DESC
        LIMIT ? OFFSET ?
    `;

    conn.query(sql, [...params, limit, offset], (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);

        const orders = rows.map(o => {
            const { screenshot_key, ...rest } = o;
            return {
                ...rest,
                has_payment_screenshot: !!screenshot_key,
                payment_screenshot_url: screenshot_key ? keyToUrl(screenshot_key) : null,
                next_status: nextStatus(o.status),
            };
        });

        const countSql = `
            SELECT COUNT(*) AS total FROM orders o
            LEFT JOIN payments p ON p.order_id = o.order_id
            ${whereSql}
        `;
        conn.query(countSql, params, (err2, countRows) => {
            if (err2) return sendResponse(res, 500, false, 'Database error', err2.message);
            return sendResponse(res, 200, true, 'Orders fetched', {
                orders,
                pagination: { page, limit, total: countRows[0].total },
            });
        });
    });
});

// GET /orders/:id — full detail
// Each item carries `category_name` and `thumbnail_url` (the product's
// lowest display_order IMAGE from product_media) so the admin can
// visually trace exactly what was ordered. Shipping/buyer info comes
// straight off the order row — no address/user join needed.
router.get('/orders/:id', (req, res) => {
    const { id } = req.params;

    conn.query(
        `SELECT * FROM orders WHERE order_id = ?`,
        [id],
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
                                next_status: nextStatus(orderRows[0].status),
                            });
                        }
                    );
                }
            );
        }
    );
});

// PATCH /orders/:id/advance — move exactly one step forward, never a jump.
// Gated: the order's payment must be VERIFIED before it can leave PENDING
// and move toward COMPLETED.
router.patch('/orders/:id/advance', (req, res) => {
    const { id } = req.params;

    conn.query('SELECT status FROM orders WHERE order_id = ?', [id], (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);
        if (!rows.length) return sendResponse(res, 404, false, 'Order not found');

        const current = rows[0].status;
        const next = nextStatus(current);
        if (!next) {
            return sendResponse(res, 400, false,
                current === 'COMPLETED' ? 'Order is already completed' : 'Cancelled orders cannot be advanced');
        }

        conn.query('SELECT payment_status FROM payments WHERE order_id = ?', [id], (payErr, payRows) => {
            if (payErr) return sendResponse(res, 500, false, 'Database error', payErr.message);

            const paymentStatus = payRows.length ? payRows[0].payment_status : null;
            if (paymentStatus !== 'VERIFIED') {
                return sendResponse(res, 400, false,
                    'Payment must be verified before this order can be advanced');
            }

            conn.query('UPDATE orders SET status = ? WHERE order_id = ?', [next, id], (updErr) => {
                if (updErr) return sendResponse(res, 500, false, 'Database error', updErr.message);
                return sendResponse(res, 200, true, `Order moved to ${next}`, {
                    order_id: id, status: next, next_status: nextStatus(next),
                });
            });
        });
    });
});

// PATCH /orders/:id/cancel
router.patch('/orders/:id/cancel', (req, res) => {
    const { id } = req.params;

    conn.query('SELECT status FROM orders WHERE order_id = ?', [id], (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);
        if (!rows.length) return sendResponse(res, 404, false, 'Order not found');

        const current = rows[0].status;
        if (current === 'COMPLETED' || current === 'CANCELLED') {
            return sendResponse(res, 400, false, `Cannot cancel an order that is already ${current.toLowerCase()}`);
        }

        conn.query("UPDATE orders SET status = 'CANCELLED' WHERE order_id = ?", [id], (updErr) => {
            if (updErr) return sendResponse(res, 500, false, 'Database error', updErr.message);
            return sendResponse(res, 200, true, 'Order cancelled', { order_id: id, status: 'CANCELLED', next_status: null });
        });
    });
});

// PATCH /orders/:id/payment   { action: 'VERIFY' | 'REJECT' }
// Rejecting a payment also cancels the order (unless it's already in a
// terminal state), since a rejected payment means the order can't proceed.
router.patch('/orders/:id/payment', (req, res) => {
    const { id } = req.params;
    const action = req.body.action;

    if (!['VERIFY', 'REJECT'].includes(action)) {
        return sendResponse(res, 400, false, "action must be 'VERIFY' or 'REJECT'");
    }
    const newStatus = action === 'VERIFY' ? 'VERIFIED' : 'REJECTED';

    conn.query('SELECT payment_id FROM payments WHERE order_id = ?', [id], (err, rows) => {
        if (err) return sendResponse(res, 500, false, 'Database error', err.message);
        if (!rows.length) return sendResponse(res, 404, false, 'No payment screenshot found for this order');

        conn.query('UPDATE payments SET payment_status = ? WHERE order_id = ?', [newStatus, id], (updErr) => {
            if (updErr) return sendResponse(res, 500, false, 'Database error', updErr.message);

            if (action === 'VERIFY') {
                return sendResponse(res, 200, true, 'Payment marked as verified', {
                    order_id: id, payment_status: newStatus,
                });
            }

            // REJECT: cascade into cancelling the order (unless already terminal).
            conn.query('SELECT status FROM orders WHERE order_id = ?', [id], (ordErr, ordRows) => {
                if (ordErr) return sendResponse(res, 500, false, 'Database error', ordErr.message);

                const current = ordRows.length ? ordRows[0].status : null;
                if (current === 'COMPLETED' || current === 'CANCELLED') {
                    return sendResponse(res, 200, true, 'Payment marked as rejected', {
                        order_id: id, payment_status: newStatus, order_status: current,
                    });
                }

                conn.query("UPDATE orders SET status = 'CANCELLED' WHERE order_id = ?", [id], (cancelErr) => {
                    if (cancelErr) return sendResponse(res, 500, false, 'Database error', cancelErr.message);
                    return sendResponse(res, 200, true, 'Payment rejected — order automatically cancelled', {
                        order_id: id, payment_status: newStatus, order_status: 'CANCELLED', next_status: null,
                    });
                });
            });
        });
    });
});

module.exports = router;
