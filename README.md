# Ecommerce-Website
<div align="center">

# 🛍️ Faisalabad Textile Store

### A Modern Full-Stack E-Commerce Platform

Built with **Node.js**, **Express.js**, **MySQL**, **JWT Authentication**, and **Cloud Storage**.

<img src="https://img.shields.io/badge/Node.js-Backend-339933?style=for-the-badge&logo=node.js&logoColor=white">

<img src="https://img.shields.io/badge/MySQL-Database-4479A1?style=for-the-badge&logo=mysql&logoColor=white">

<img src="https://img.shields.io/badge/JWT-Authentication-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white">

<img src="https://img.shields.io/badge/Cloud-Storage-FF9900?style=for-the-badge">

<img src="https://img.shields.io/badge/Status-Completed-success?style=for-the-badge">

---

*"A complete e-commerce solution with customer and admin dashboards, real-time inventory management, and secure order processing."*

</div>

---

# ✨ Overview

**Faisalabad Textile Store** is a complete e-commerce platform designed for garment businesses. It provides customers with a seamless shopping experience while giving administrators full control over products, categories, inventory, users, and orders.

---

# 🚀 Features

## 👤 Customer Features

✅ Secure JWT Authentication

✅ User Registration & Login

✅ Browse Products

✅ Add to Cart

✅ Checkout & Invoice Generation

✅ Upload Payment Screenshots

✅ Track Order Status

✅ View Order History

---

## 🛍️ Landing Page

- Responsive design
- Product listings
- Men's and Women's categories
- Dynamic product updates

---

## 💳 Checkout System

- Personal information form
- Payment screenshot upload
- Invoice generation
- Order confirmation

---

## 📦 Order Tracking

Track your order in real time:

```text
Pending → Verified → Processing → Shipped → Delivered
```

---

# ⚙️ Admin Dashboard

The admin panel provides complete control over the platform.

---

## 📂 Category Management

- Add categories
- Edit categories
- Delete categories
- Separate sections for Men and Women

---

## 🛍️ Product Management

- Add products
- Edit products
- Delete products
- Upload multiple images
- Update prices and descriptions

---

## 📊 Inventory Management

- Low-stock alerts
- Manual inventory updates
- Stock monitoring

---

## 👥 User Management

- View all registered users
- Manage user accounts

---

## 📦 Order Management

- View customer orders
- Verify payment screenshots
- Approve or reject payments
- Update order status

---

# 🛠️ Tech Stack

| Category | Technology |
|----------|-------------|
| Backend | Node.js, Express.js |
| Database | MySQL |
| Authentication | JWT |
| Storage | Cloud Storage |
| Frontend | HTML, CSS, JavaScript |

---

# 📁 Project Structure

```text
📦 Faisalabad-Textile-Store

├── 📂 Database
│   ├── db_connection.js
│   ├── initDB.js
│   └── schema.sql
│
├── 📂 Frontend
│   │
│   ├── 📂 Admin_UI
│   │   ├── admin-categories.html
│   │   ├── admin-inventory.html
│   │   ├── admin-orders.html
│   │   ├── admin-products.html
│   │   ├── admin-slider.html
│   │   └── admin-users.html
│   │
│   ├── 📂 Auth_UI
│   │   ├── login.html
│   │   └── register.html
│   │
│   └── 📂 User_UI
│       ├── checkout.html
│       ├── user-cart.html
│       ├── user-order.html
│       └── index.html
│
├── 📂 middleware
│   ├── adminAuth.js
│   └── authMiddleware.js
│
├── 📂 routes
│
├── 📂 utils
│   ├── r2Upload.js
│   ├── seedAdmins.js
│   └── uploadMiddleware.js
│
├── 📄 server.js
├── 📄 package.json
├── 📄 README.md
└── 📄 .env
```

---

# 🔐 Authentication Flow

```text
User Login/Register
        │
        ▼
Generate JWT Token
        │
        ▼
Verify User Identity
        │
        ▼
Access Protected Routes
        │
        ▼
Dashboard Access
```

---

# 🗄️ Database Modules

The database manages:

- 👤 Users
- 🛍️ Products
- 📂 Categories
- 📦 Orders
- 🛒 Cart
- 📊 Inventory
- 💳 Payments

All operations update the database in real time.

---

# ⚡ Installation

### Clone the repository

```bash
git clone https://github.com/your-username/repository-name.git
```

### Install dependencies

```bash
npm install
```

### Configure environment variables

```env
PORT=7070

DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=your_database

JWT_SECRET=your_secret

R2_ACCESS_KEY=
R2_SECRET_KEY=
R2_BUCKET=
```

### Start the server

```bash
node server.js
```

---

# 🌟 Future Enhancements

- Product reviews and ratings
- Search and filtering
- Coupons and discounts
- Email notifications
- Analytics dashboard
- Online payment gateway

---

<div align="center">

# 👨‍💻 Developer

### M. Muneeb Khan

**Computer Science Student • Full-Stack Developer • Problem Solver**

*"Passionate about building scalable applications and modern digital experiences."*

⭐ **If you like this project, don't forget to star the repository!**

</div>

Join me on LinkedIn
