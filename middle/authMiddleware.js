const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../db_connection');

// Verifies any logged-in user (either role: 'user' or role: 'admin')
function verifyToken(req, res, next) {

    const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1];

    if (!token) {
        if (req.headers['accept']?.includes('text/html')) {
            return res.redirect('/login');
        }
        return res.status(401).json({ success: false, message: 'No token provided' });
    }

    jwt.verify(token, jwtSecret, (err, decoded) => {

        if (err) {
            if (req.headers['accept']?.includes('text/html')) {
                return res.redirect('/login');
            }
            return res.status(403).json({ success: false, message: 'Invalid or expired token' });
        }

        req.user = decoded; // { id, role, ...}
        next();
    });
}

// Same as verifyToken, but also requires role === 'admin'.
// Use this on any admin-only route (e.g. product management).
function verifyAdmin(req, res, next) {
    verifyToken(req, res, () => {
        if (req.user?.role !== 'admin') {
            if (req.headers['accept']?.includes('text/html')) {
                return res.redirect('/login');
            }
            return res.status(403).json({ success: false, message: 'Admin access only' });
        }
        next();
    });
}

module.exports = { verifyToken, verifyAdmin };