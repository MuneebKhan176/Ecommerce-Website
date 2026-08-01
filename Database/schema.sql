-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(30),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
    category_id INT AUTO_INCREMENT PRIMARY KEY,
    gender ENUM('MEN','WOMEN') NOT NULL,
    category_name VARCHAR(100) NOT NULL
);

-- 3. PRODUCTS
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

-- 4. PRODUCT MEDIA
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

-- 5. USER ADDRESSES
CREATE TABLE IF NOT EXISTS addresses (
    address_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(30),
    city VARCHAR(100),
    province VARCHAR(100),
    postal_code VARCHAR(20),
    address TEXT NOT NULL,
    FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
);

-- 6. ORDERS
CREATE TABLE IF NOT EXISTS orders (
    order_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    address_id INT NOT NULL,
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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (address_id) REFERENCES addresses(address_id)
);

-- 7. ORDER ITEMS
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

-- 8. PAYMENTS
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


-- 9. ADMINS
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

-- 10. HOMEPAGE SLIDERS
CREATE TABLE IF NOT EXISTS homepage_sliders (
    slider_id INT AUTO_INCREMENT PRIMARY KEY,
    cloud_key VARCHAR(500) NOT NULL,
    caption VARCHAR(255),
    display_order INT NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 11. CART ITEMS
CREATE TABLE IF NOT EXISTS cart_items (
    cart_item_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_cart_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_cart_product
        FOREIGN KEY (product_id)
        REFERENCES products(product_id)
        ON DELETE CASCADE,
    CONSTRAINT uq_cart_user_product
        UNIQUE (user_id, product_id)
);