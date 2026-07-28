
// Run this ONCE (node utils/seedAdmins.js) to create your default admin
// accounts. Admins are never created through the website itself —
// only through this script, or manually in the database.
//
// Set ADMIN1_USER/ADMIN1_PASS, ADMIN2_USER/ADMIN2_PASS, ADMIN3_USER/ADMIN3_PASS
// in your .env file before running.

require('dotenv').config({ path: '../routes/.env' });

const bcrypt = require('bcryptjs');
const { conn } = require('../db_connection');

const admins = [
    { username: process.env.ADMIN1_USER, password: process.env.ADMIN1_PASS, role: 'SUPER_ADMIN' },
    { username: process.env.ADMIN2_USER, password: process.env.ADMIN2_PASS, role: 'STAFF' },
    { username: process.env.ADMIN3_USER, password: process.env.ADMIN3_PASS, role: 'STAFF' },
];

async function seed() {
    for (const admin of admins) {
        if (!admin.username || !admin.password) {
            console.error(`❌ Skipping admin — missing username/password in .env (check ADMIN*_USER / ADMIN*_PASS)`);
            continue;
        }

        try {
            const passwordHash = await bcrypt.hash(admin.password, 10);

            await new Promise((resolve, reject) => {
                conn.query(
                    `INSERT INTO admins (username, password_hash, role)
                     VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role)`,
                    [admin.username, passwordHash, admin.role],
                    (err) => (err ? reject(err) : resolve())
                );
            });

            console.log(`✅ Seeded admin: ${admin.username} (${admin.role})`);
        } catch (err) {
            console.error(`❌ Failed to seed ${admin.username}:`, err.message);
        }
    }

    console.log('Done. You can now log in with any of the above admin accounts.');
    process.exit(0);
}

seed();