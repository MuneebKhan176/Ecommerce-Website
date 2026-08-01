require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

// Import Database Initializer from Database directory
const initDatabase = require('./Database/initDB');
const seedAdmins = require('./utils/seedAdmins');

const { verifyToken } = require('./middle/authMiddleware');

const homeRoutes = require('./routes/homeRoutes');
const authRoutes = require('./routes/authRoutes');
const storeFrontRoutes = require('./routes/storeFrontRoutes');

// Admin routes
const adminViewRoutes = require('./routes/Admin_Routes/adminViewRoutes');
const adminStockRoutes = require('./routes/Admin_Routes/adminStockRoutes');
const adminCategoryRoutes = require('./routes/Admin_Routes/adminCategoryRoutes');
const adminOrderRoutes = require('./routes/Admin_Routes/adminOrderRoutes');
const adminSliderRoutes = require('./routes/Admin_Routes/adminSliderRoutes');
const adminUserRoutes = require('./routes/Admin_Routes/adminUserRoutes');

// User routes
const userRoutes = require('./routes/User_Routes/userRoutes');
const userCatalogRoutes = require('./routes/User_Routes/userCatalogRoutes');
const cartRoutes = require('./routes/User_Routes/cartRoutes');
const userOrderRoutes = require('./routes/User_Routes/userOrderRoutes');

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

app.use('/api', userRoutes);
app.use('/api', userCatalogRoutes);
app.use('/api', cartRoutes);
app.use('/api', userOrderRoutes);

app.use('/admin', adminViewRoutes);

app.use('/admin/api', adminStockRoutes);
app.use('/admin/api', adminCategoryRoutes);
app.use('/admin/api', adminOrderRoutes);
app.use('/admin/api', adminSliderRoutes);
app.use('/admin/api', adminUserRoutes);

// Protected pages
app.get('/user-cart', verifyToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'Frontend/User_UI/user-cart.html'));
});

app.get('/user-order', verifyToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'Frontend/User_UI/user-order.html'));
});

app.get('/checkout', verifyToken, (req, res) => {
    res.sendFile(path.join(__dirname, 'Frontend/User_UI/checkout.html'));
});

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
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    })
    .catch((err) => {
        console.error('💥 Database initialization failed. Server startup aborted:', err);
    });