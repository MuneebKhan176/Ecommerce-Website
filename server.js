// server.js
//
// Entry point. Guest-checkout storefront — no customer accounts anywhere
// in this app. The homepage is the entire customer experience: browse,
// add to cart (client-side, localStorage via Frontend/assets/js/cart.js),
// and check out with no login. Only admins authenticate, via authRoutes.js.

require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

// Import Database Initializer from Database directory
const initDatabase = require('./Database/initDB');
const seedAdmins = require('./utils/seedAdmins');

const homeRoutes = require('./routes/homeRoutes');
const authRoutes = require('./routes/authRoutes');             // admin-only now
const storeFrontRoutes = require('./routes/storeFrontRoutes'); // public catalog — covers everything the old userCatalogRoutes did
const orderRoutes = require('./routes/orderRoutes');           // guest checkout, replaces User_Routes/userOrderRoutes.js
const reviewRoutes = require('./routes/reviewRoutes');         // public product reviews & ratings

// Admin routes
const adminViewRoutes = require('./routes/Admin_Routes/adminViewRoutes');
const adminStockRoutes = require('./routes/Admin_Routes/adminStockRoutes');
const adminCategoryRoutes = require('./routes/Admin_Routes/adminCategoryRoutes');
const adminOrderRoutes = require('./routes/Admin_Routes/adminOrderRoutes');
const adminSliderRoutes = require('./routes/Admin_Routes/adminSliderRoutes');

// NOTE: adminUserRoutes is gone — there are no customer accounts left to
// list/manage, so that route file (and its require here) is deleted.

// NOTE: the entire User_Routes/ folder (userRoutes.js, userCatalogRoutes.js,
// cartRoutes.js, userOrderRoutes.js, checkout.js) is deleted. The cart now
// lives client-side in localStorage (Frontend/assets/js/cart.js) and
// checkout posts straight to the new orderRoutes.js — no account, no
// server-side cart table, no /api/user/profile, no /api/cart/*.

const app = express();

// Railway will provide PORT automatically.
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(express.static(path.join(__dirname, 'Frontend')));

// Routes
app.use('/', homeRoutes);
app.use('/', authRoutes);

app.use('/api', storeFrontRoutes);
app.use('/api', orderRoutes);
app.use('/api', reviewRoutes);

app.use('/admin', adminViewRoutes);

app.use('/admin/api', adminStockRoutes);
app.use('/admin/api', adminCategoryRoutes);
app.use('/admin/api', adminOrderRoutes);
app.use('/admin/api', adminSliderRoutes);

// Checkout page — public. Buying no longer requires an account, so
// there's no verifyToken here. The homepage's Buy Now / Add to Cart
// buttons route straight here with the selected product(s) already
// staged in localStorage (see cart.js), and checkout.html's inline
// script reads that state to build the order.
app.get('/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, 'Frontend/User_UI/checkout.html'));
});

// Individual product page — public, matches /api/products/:id which
// already returns everything the page needs (images, price, stock,
// description, rating summary, related products) in one call. The id
// itself is read client-side from the URL path, not passed to the
// template, so this route just needs to always serve the same file.
app.get('/product/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'Frontend/User_UI/product.html'));
});

// NOTE: /user-cart and /user-order are gone — there's no account-bound
// cart page or order-history page anymore. The cart lives on the
// checkout page itself (order summary with qty steppers / remove), and
// order status is looked up per-order (order id + phone) via
// GET /api/orders/:id?phone=... rather than listed per-account.

app.use('/assets', express.static(path.join(__dirname, 'Frontend/assets')));

// 404
app.use((req, res) => {
    res.status(404).send('Page not found');
});

// Error handler
app.use((err, req, res, next) => {
    console.error('🔥 Unhandled error:', err);
    res.status(500).json({
        success: false,
        message: err.message
    });
});

// Initialize DB schema before listening for incoming connections
initDatabase()
    .then(() => seedAdmins())
    .then(() => {
        app.listen(PORT, '0.0.0.0');
    })
    .catch((err) => {
        console.error('💥 Database initialization failed. Server startup aborted:', err);
    });