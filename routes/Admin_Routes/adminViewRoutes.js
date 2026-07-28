// routes/adminViewRoutes.js
//
// Serves the admin HTML pages themselves. /admin/dashboard is still
// handled inside authRoutes.js (unchanged) — this file only adds the
// pages it links out to.
//
// GET /admin/products
// GET /admin/categories
// GET /admin/orders
// GET /admin/inventory
// GET /admin/slider
// GET /admin/users

const express = require('express');
const router = express.Router();
const path = require('path');

const { verifyAdmin } = require('../../middle/authMiddleware');

// verifyAdmin (unlike adminAuth.js's requireAdmin) checks the request's
// Accept header and redirects to /login on failure for page loads —
// requireAdmin always responds with JSON, which is wrong for HTML routes
// and is what was causing raw JSON to render instead of a page.
router.use(verifyAdmin);

const VIEW_DIR = path.join(__dirname, '../../Frontend/Admin_UI');

router.get('/products', (req, res) => res.sendFile(path.join(VIEW_DIR, 'admin-products.html')));
router.get('/categories', (req, res) => res.sendFile(path.join(VIEW_DIR, 'admin-categories.html')));
router.get('/orders', (req, res) => res.sendFile(path.join(VIEW_DIR, 'admin-orders.html')));
router.get('/inventory', (req, res) => res.sendFile(path.join(VIEW_DIR, 'admin-inventory.html')));
router.get('/slider', (req, res) => res.sendFile(path.join(VIEW_DIR, 'admin-slider.html')));
router.get('/users', (req, res) => res.sendFile(path.join(VIEW_DIR, 'admin-users.html')));

module.exports = router;