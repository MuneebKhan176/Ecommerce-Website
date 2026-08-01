require('dotenv').config();

const bcrypt = require('bcryptjs');
const { conn } = require('../Database/db_connection'); // Path fixed to Database directory

const admins = [
    { username: process.env.ADMIN1_USER, password: process.env.ADMIN1_PASS, role: 'SUPER_ADMIN' },
    { username: process.env.ADMIN2_USER, password: process.env.ADMIN2_PASS, role: 'STAFF' },
    { username: process.env.ADMIN3_USER, password: process.env.ADMIN3_PASS, role: 'STAFF' },
];

async function seedAdmins() {
    for (const admin of admins) {
        // Skip admins if environment variables aren't set in Railway/env
        if (!admin.username || !admin.password) {
            continue;
        }

        try {
            const passwordHash = await bcrypt.hash(admin.password, 10);

            await conn.promise().query(
                `INSERT INTO admins (username, password_hash, role)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role)`,
                [admin.username, passwordHash, admin.role]
            );

        } catch (err) {
            console.error(`❌ Failed to seed admin ${admin.username}:`, err.message);
        }
    }
}

module.exports = seedAdmins;