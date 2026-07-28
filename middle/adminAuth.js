// middle/adminAuth.js
//
// Use AFTER verifyToken on any /admin or /admin/api route:
//   router.use(verifyToken, requireAdmin);
//
// Optionally restrict further to SUPER_ADMIN only with requireSuperAdmin.

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    next();
}

function requireSuperAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin' || req.user.adminRole !== 'SUPER_ADMIN') {
        return res.status(403).json({ success: false, message: 'Super admin access required' });
    }
    next();
}

module.exports = { requireAdmin, requireSuperAdmin };