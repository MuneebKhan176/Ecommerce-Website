-- ============================================================
-- SCHEMA v2 — guest-checkout storefront, no user accounts.
--
-- Removed entirely: `users`, `addresses`, `cart_items`.
--   - There are no customer accounts anymore, so nothing needs a
--     user_id anywhere in this schema.
--   - The cart is not persisted server-side at all — it lives in the
--     browser (localStorage) via Frontend/assets/js/cart.js and is
--     only ever sent to the server once, as the `items` array in the
--     POST /api/orders request body.
--   - Shipping "address" is no longer a separate reusable row tied to
--     an account — it's one-time information the buyer types at
--     checkout, so it's stored directly on the order itself.
--
-- Kept as-is: `categories`, `products`, `product_media`,
-- `order_items`, `payments`, `admins`, `homepage_sliders`. Admin
-- accounts remain (staff still need to log in to the admin panel);
-- only *customer* accounts are gone.
--
-- v2.1: added `display_order` to `categories` (ONE combined sequence
-- across MEN + WOMEN together — decides which category shows where
-- overall) and to `products` (ONE sequence PER category_id — decides
-- which product shows where within its own category).
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS homepage_sliders;
DROP TABLE IF EXISTS admins;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS addresses;
DROP TABLE IF EXISTS product_media;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

-- 1. CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    gender ENUM('MEN','WOMEN') NOT NULL,
    category_name VARCHAR(100) NOT NULL,
    -- Combined (gender-agnostic) display sequence. Lower = shown earlier.
    display_order INT NOT NULL DEFAULT 0
);

-- 2. PRODUCTS
CREATE TABLE IF NOT EXISTS products (
    product_id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL,
    product_name VARCHAR(200) NOT NULL,
    description TEXT,
    price DECIMAL(12,2) NOT NULL,
    discount_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
    stock INT NOT NULL DEFAULT 0,
    low_stock_threshold INT NOT NULL DEFAULT 3,
    sku VARCHAR(50) UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    -- Per-category display sequence. Lower = shown earlier within
    -- this product's category_id. Not comparable across categories.
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_products_category
        FOREIGN KEY (category_id)
        REFERENCES categories(category_id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,
    CONSTRAINT chk_discount_percentage
        CHECK (discount_percentage >= 0 AND discount_percentage <= 100)
);

-- 3. PRODUCT MEDIA
CREATE TABLE IF NOT EXISTS product_media (
    media_id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    media_type ENUM('IMAGE','VIDEO') NOT NULL,
    cloud_key VARCHAR(500) NOT NULL,
    display_order INT DEFAULT 1,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id)
        REFERENCES products(product_id)
        ON DELETE CASCADE
);

-- 4. ORDERS
-- Guest checkout: every field needed to fulfil the order (who it's for,
-- where it ships) lives directly on the row. No user_id, no address_id,
-- no FK to an accounts table of any kind.
CREATE TABLE IF NOT EXISTS orders (
    order_id BIGINT AUTO_INCREMENT PRIMARY KEY,

    -- buyer / shipping info, captured fresh at checkout every time
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(255),
    city VARCHAR(100) NOT NULL,
    province VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    address TEXT NOT NULL,

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
CREATE TABLE IF NOT EXISTS order_items (
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
CREATE TABLE IF NOT EXISTS payments (
    payment_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL UNIQUE,
    payment_method VARCHAR(50),
    screenshot_key VARCHAR(500) NOT NULL,
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

-- 7. ADMINS  (unchanged — staff/admin accounts are not affected)
CREATE TABLE IF NOT EXISTS admins (
    admin_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM(
        'SUPER_ADMIN',
        'STAFF'
    ) DEFAULT 'STAFF',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. HOMEPAGE SLIDERS  (unchanged)
CREATE TABLE IF NOT EXISTS homepage_sliders (
    slider_id INT AUTO_INCREMENT PRIMARY KEY,
    cloud_key VARCHAR(500) NOT NULL,
    caption VARCHAR(255),
    display_order INT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- 9. PRODUCT REVIEWS
CREATE TABLE IF NOT EXISTS product_reviews (
    review_id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    reviewer_name VARCHAR(100) NOT NULL,
    rating TINYINT UNSIGNED NOT NULL,
    review_text TEXT,
    is_approved BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_reviews_product
        FOREIGN KEY (product_id)
        REFERENCES products(product_id)
        ON DELETE CASCADE,

    CONSTRAINT chk_review_rating
        CHECK (rating BETWEEN 1 AND 5)
);

-- ============================================================
-- NOTE: if you're applying this to a database that already has
-- data in `categories` and `products`, run
-- migration_add_display_order.sql instead of re-running this file —
-- it adds the two new columns AND backfills sensible starting order
-- values so nothing on the storefront/admin visibly jumps around.
-- ============================================================