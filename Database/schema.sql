-- ============================================================
-- GITNIFY / FTD E-COMMERCE DATABASE SCHEMA v4
-- Full reset with FK-safe drop and creation order
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- DROP TABLES
-- Child tables must be dropped before parent tables
-- ============================================================

DROP TABLE IF EXISTS product_reviews;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS product_media;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS homepage_sliders;
DROP TABLE IF EXISTS admins;
DROP TABLE IF EXISTS categories;

SET FOREIGN_KEY_CHECKS = 1;


-- ============================================================
-- 1. CATEGORIES
-- ============================================================

CREATE TABLE categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,

    gender ENUM('MEN', 'WOMEN', 'OTHERS') NOT NULL,

    category_name VARCHAR(100) NOT NULL,

    display_order INT NOT NULL DEFAULT 0
);


-- ============================================================
-- 2. ADMINS
-- Independent table
-- ============================================================

CREATE TABLE admins (
    admin_id INT AUTO_INCREMENT PRIMARY KEY,

    username VARCHAR(100) NOT NULL UNIQUE,

    password_hash VARCHAR(255) NOT NULL,

    role ENUM('SUPER_ADMIN', 'STAFF') NOT NULL DEFAULT 'STAFF',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- 3. HOMEPAGE SLIDERS
-- Independent table
-- ============================================================

CREATE TABLE homepage_sliders (
    slider_id INT AUTO_INCREMENT PRIMARY KEY,

    cloud_key VARCHAR(500) NOT NULL,

    caption VARCHAR(255),

    display_order INT NOT NULL DEFAULT 1,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- 4. PRODUCTS
-- Depends on: categories
-- ============================================================

CREATE TABLE products (
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

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_products_category
        FOREIGN KEY (category_id)
        REFERENCES categories(category_id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    CONSTRAINT chk_discount_percentage
        CHECK (
            discount_percentage >= 0
            AND discount_percentage <= 100
        )
);


-- ============================================================
-- 5. PRODUCT MEDIA
-- Depends on: products
-- ============================================================

CREATE TABLE product_media (
    media_id INT AUTO_INCREMENT PRIMARY KEY,

    product_id INT NOT NULL,

    media_type ENUM('IMAGE', 'VIDEO') NOT NULL,

    cloud_key VARCHAR(500) NOT NULL,

    display_order INT NOT NULL DEFAULT 1,

    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_media_product
        FOREIGN KEY (product_id)
        REFERENCES products(product_id)
        ON DELETE CASCADE
);


-- ============================================================
-- 6. ORDERS
-- Independent from products because products are linked
-- through order_items
-- ============================================================

CREATE TABLE orders (
    order_id BIGINT AUTO_INCREMENT PRIMARY KEY,

    full_name VARCHAR(100) NOT NULL,

    phone VARCHAR(30) NOT NULL,

    email VARCHAR(255),

    city VARCHAR(100) NOT NULL,

    province VARCHAR(100) NOT NULL,

    postal_code VARCHAR(20) NOT NULL,

    address TEXT NOT NULL,

    payment_type ENUM('COD', 'ADVANCE')
        NOT NULL DEFAULT 'COD',

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
    ) NOT NULL DEFAULT 'PENDING',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- 7. ORDER ITEMS
-- Depends on: orders and products
-- ============================================================

CREATE TABLE order_items (
    item_id BIGINT AUTO_INCREMENT PRIMARY KEY,

    order_id BIGINT NOT NULL,

    product_id INT NOT NULL,

    quantity INT NOT NULL,

    price DECIMAL(12,2) NOT NULL,

    total DECIMAL(12,2) NOT NULL,

    CONSTRAINT fk_order_items_order
        FOREIGN KEY (order_id)
        REFERENCES orders(order_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_order_items_product
        FOREIGN KEY (product_id)
        REFERENCES products(product_id)
        ON DELETE RESTRICT
);


-- ============================================================
-- 8. PAYMENTS
-- Depends on: orders
-- One payment record per order
-- ============================================================

CREATE TABLE payments (
    payment_id BIGINT AUTO_INCREMENT PRIMARY KEY,

    order_id BIGINT NOT NULL UNIQUE,

    payment_method VARCHAR(50),

    screenshot_key VARCHAR(500),

    payment_status ENUM(
        'PENDING',
        'VERIFIED',
        'REJECTED'
    ) NOT NULL DEFAULT 'PENDING',

    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_payments_order
        FOREIGN KEY (order_id)
        REFERENCES orders(order_id)
        ON DELETE CASCADE
);


-- ============================================================
-- 9. PRODUCT REVIEWS
-- Depends on: products
-- ============================================================

CREATE TABLE product_reviews (
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