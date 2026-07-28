require('dotenv').config({ path: './routes/.env' }); // MUST be first line

const { DB_HOST, DB_USERNAME, DB_PASSWORD, DB_NAME } = process.env;
const jwtSecret = process.env.JWT_SECRET_KEY;

const mysql = require('mysql2');

/* ─────────────────────────────────────────────────────────────
   Connection POOL (not a single connection).
   pool.query(...) has the exact same signature as
   connection.query(...), so every route below just uses `conn`
   normally. If a route ever needs a real multi-statement
   transaction later (BEGIN ... COMMIT), use getConnection() to
   check out one dedicated connection instead of the pool.
   ───────────────────────────────────────────────────────────── */
const pool = mysql.createPool({
    host: DB_HOST,
    user: DB_USERNAME,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ MySQL pool: initial connection check failed:', err.message);
        return;
    }
    console.log('✅ MySQL pool connected');
    connection.release();
});

function getConnection() {
    return new Promise((resolve, reject) => {
        pool.getConnection((err, connection) => {
            if (err) return reject(err);
            resolve(connection);
        });
    });
}

module.exports = { conn: pool, getConnection, jwtSecret };