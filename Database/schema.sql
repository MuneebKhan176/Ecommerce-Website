-- ============================================================
-- COD + ADVANCE PAYMENT UPDATE
--
-- What changed:
--   - orders gets a new `payment_type` column: 'COD' (default) or
--     'ADVANCE'. COD is chosen automatically unless the buyer
--     switches to the Advance Payment tab at checkout.
--   - payments.screenshot_key is now NULLable (it used to be
--     mandatory when every order paid in advance). In practice a
--     `payments` row is now ONLY ever created for ADVANCE orders —
--     COD orders never get a payments row at all, since there is
--     nothing to verify upfront.
--   - Default shipping fee changed from 300 -> 200 (enforced in
--     app code, routes/orderRoutes.js — not a column default here
--     since shipping_price is captured per-order at checkout time).
--
-- Scope of this migration: ONLY the order-related tables are
-- dropped and recreated (payments -> order_items -> orders, in
-- FK-safe order). categories, products, product_media, admins,
-- homepage_sliders, and product_reviews are NOT touched and keep
-- all existing data.
--
-- WARNING: this DROPS all existing orders, order_items, and
-- payments data. Export/back up first if you need to keep it.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
SET FOREIGN_KEY_CHECKS = 1;

-- 4. ORDERS
CREATE TABLE orders (
    order_id BIGINT AUTO_INCREMENT PRIMARY KEY,

    -- buyer / shipping info, captured fresh at checkout every time
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(255),
    city VARCHAR(100) NOT NULL,
    province VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    address TEXT NOT NULL,

    -- COD = pay the rider cash on delivery (default, no screenshot
    --       required, no bank/wallet details shown to the buyer).
    -- ADVANCE = bank/wallet transfer, verified upfront via a
    --           mandatory payment screenshot.
    payment_type ENUM('COD', 'ADVANCE') NOT NULL DEFAULT 'COD',

    subtotal DECIMAL(12,2) NOT NULL,
    shipping_price DECIMAL(12,2) NOT NULL,
    total_price DECIMAL(12,2) NOT NULL,

    status ENUM(
        'PENDING',
        'CONFIRMED',
        'PACKED',
        'SHIPPED',
        'DELIVERED',
        'COMPLETED',
        'CANCELLED'
    ) DEFAULT 'PENDING',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. ORDER ITEMS
CREATE TABLE order_items (
    item_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    price DECIMAL(12,2) NOT NULL,
    total DECIMAL(12,2) NOT NULL,
    FOREIGN KEY (order_id)
        REFERENCES orders(order_id)
        ON DELETE CASCADE,
    FOREIGN KEY (product_id)
        REFERENCES products(product_id)
);

-- 6. PAYMENTS
-- Only ever populated for ADVANCE orders. COD orders never get a row
-- here — admin side treats "no payments row" + payment_type = 'COD'
-- as "nothing to verify, proceed normally".
CREATE TABLE payments (
    payment_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL UNIQUE,
    payment_method VARCHAR(50),
    screenshot_key VARCHAR(500) NULL,
    payment_status ENUM(
        'PENDING',
        'VERIFIED',
        'REJECTED'
    ) DEFAULT 'PENDING',
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id)
        REFERENCES orders(order_id)
        ON DELETE CASCADE
);