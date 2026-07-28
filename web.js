require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');

const { verifyToken }=require('./middle/authMiddleware')

const homeRoutes = require('./routes/homeRoutes');
const authRoutes = require('./routes/authRoutes');
const storeFrontRoutes = require('./routes/storeFrontRoutes'); // matches actual capitalization on disk

// Admin routes
const adminViewRoutes = require('./routes/Admin_Routes/adminViewRoutes');
const adminStockRoutes = require('./routes/Admin_Routes/adminStockRoutes');
const adminCategoryRoutes = require('./routes/Admin_Routes/adminCategoryRoutes');
const adminOrderRoutes = require('./routes/Admin_Routes/adminOrderRoutes');
const adminSliderRoutes = require('./routes/Admin_Routes/adminSliderRoutes');
const adminUserRoutes = require('./routes/Admin_Routes/adminUserRoutes');

// User-facing (customer) routes
const userRoutes = require('./routes/User_Routes/userRoutes');
const userCatalogRoutes = require('./routes/User_Routes/userCatalogRoutes');
const cartRoutes = require('./routes/User_Routes/cartRoutes');
const userOrderRoutes = require('./routes/User_Routes/userOrderRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(express.static(path.join(__dirname, 'Frontend')));

// ── Routes ──────────────────────────────────────────────────
app.use('/', homeRoutes);
app.use('/', authRoutes);

// Public storefront JSON API — no auth
app.use('/api', storeFrontRoutes);

// Logged-in customer JSON APIs (verifyToken applied inside each router)
app.use('/api', userRoutes);
app.use('/api', userCatalogRoutes);
app.use('/api', cartRoutes);
app.use('/api', userOrderRoutes);

// Admin dashboard pages
app.use('/admin', adminViewRoutes);

// Admin JSON APIs
app.use('/admin/api', adminStockRoutes);
app.use('/admin/api', adminCategoryRoutes);
app.use('/admin/api', adminOrderRoutes);
app.use('/admin/api', adminSliderRoutes);
app.use('/admin/api', adminUserRoutes);

/////////////////////

app.get('/user-cart', verifyToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'Frontend/User_UI/user-cart.html'));
});

app.get('/user-order', verifyToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'Frontend/User_UI/user-order.html'));
});

app.get('/checkout', verifyToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'Frontend/User_UI/checkout.html'));
});

///////////////////////

app.use('/assets', express.static(path.join(__dirname, 'Frontend/assets')));

// ── 404 fallback ────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).send('Page not found');
});

app.use((err, req, res, next) => {
    console.error('🔥 Unhandled error:', err);
    res.status(500).json({ success: false, message: err.message });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
});