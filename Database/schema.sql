-- ============================================================
-- SCHEMA v4 — adds a third gender bucket, 'OTHERS', for unisex
-- categories like Blankets, Shawls, Bedsheets, etc. that don't
-- belong under Men or Women specifically.
--
-- Builds on v3 (guest checkout, no user accounts, COD + Advance
-- Payment). Everything from v3 is unchanged except:
--   - categories.gender ENUM widened to ('MEN','WOMEN','OTHERS').
--   - Nothing else changes: `products` has no gender column of its
--     own — it always inherits gender through category_id — so no
--     product-table change is needed.
--
-- WARNING: same as v3 — the DROP statements below only affect
-- `payments`, `order_items`, and `orders` (in FK-safe order).
-- `categories`, `products`, `product_media`, `admins`,
-- `homepage_sliders`, and `product_reviews` are left untouched
-- (and NOT dropped). The gender enum on an existing `categories`
-- table is widened in place via ALTER TABLE further down — this is
-- safe to re-run and does not affect existing MEN/WOMEN rows.
-- ============================================================


SeT FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS product_reviews;
DROP TABLE IF EXISTS product_media;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS admins;
DROP TABLE IF EXISTS homepage_sliders;

Set foreign_key_checks = 1;


-- 1. CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    gender ENUM('MEN','WOMEN','OTHERS') NOT NULL,
    category_name VARCHAR(100) NOT NULL,
    -- Combined (gender-agnostic) display sequence. Lower = shown earlier.
    display_order INT NOT NULL DEFAULT 0
);

-- If `categories` already existed before this file ran (from v2/v3),
-- the CREATE TABLE IF NOT EXISTS above was a no-op, so the enum needs
-- widening explicitly. Re-running this on a table that already has
-- 'OTHERS' is harmless.
ALTER TABLE categories MODIFY COLUMN gender ENUM('MEN','WOMEN','OTHERS') NOT NULL;

-- 2. PRODUCTS (unchanged from v3 — gender always comes via category_id)
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
CREATE TABLE orders (
    order_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(255),
    city VARCHAR(100) NOT NULL,
    province VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    address TEXT NOT NULL,
    payment_type ENUM('COD', 'ADVANCE') NOT NULL DEFAULT 'COD',
    subtotal DECIMAL(12,2) NOT NULL,
    shipping_price DECIMAL(12,2) NOT NULL,
    total_price DECIMAL(12,2) NOT NULL,
    status ENUM(
        'PENDING','CONFIRMED','PACKED','SHIPPED','DELIVERED','COMPLETED','CANCELLED'
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
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(product_id)
);

-- 6. PAYMENTS
CREATE TABLE payments (
    payment_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT NOT NULL UNIQUE,
    payment_method VARCHAR(50),
    screenshot_key VARCHAR(500) NULL,
    payment_status ENUM('PENDING','VERIFIED','REJECTED') DEFAULT 'PENDING',
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
);

-- 7. ADMINS (unchanged)
CREATE TABLE IF NOT EXISTS admins (
    admin_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('SUPER_ADMIN','STAFF') DEFAULT 'STAFF',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. HOMEPAGE SLIDERS (unchanged)
CREATE TABLE IF NOT EXISTS homepage_sliders (
    slider_id INT AUTO_INCREMENT PRIMARY KEY,
    cloud_key VARCHAR(500) NOT NULL,
    caption VARCHAR(255),
    display_order INT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. PRODUCT REVIEWS (unchanged)
CREATE TABLE IF NOT EXISTS product_reviews (
    review_id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    reviewer_name VARCHAR(100) NOT NULL,
    rating TINYINT UNSIGNED NOT NULL,
    review_text TEXT,
    is_approved BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_reviews_product FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
    CONSTRAINT chk_review_rating CHECK (rating BETWEEN 1 AND 5)
);