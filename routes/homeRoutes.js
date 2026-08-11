// routes/homeRoutes.js
//
// Public storefront entry point. No accounts, no register page — the
// homepage (Frontend/index.html) is the entire customer experience.
// Admin login/dashboard lives in authRoutes.js; checkout is registered
// directly in server.js.

const express = require('express');
const router = express.Router();
const path = require('path');

router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../Frontend/index.html'));
});

module.exports = router;