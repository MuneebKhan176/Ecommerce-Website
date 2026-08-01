require('dotenv').config(); // MUST be first line

const mysql = require('mysql2');

// Destructure directly using Railway's default variable names (with local fallbacks)
const DB_HOST = process.env.MYSQLHOST;
const DB_PORT = process.env.MYSQLPORT;
const DB_USERNAME = process.env.MYSQLUSER;
const DB_PASSWORD = process.env.MYSQLPASSWORD;
const DB_NAME = process.env.MYSQLDATABASE;

const jwtSecret = process.env.JWT_SECRET_KEY;

// Log values to verify on startup
console.log({
    DB_HOST, 
    DB_PORT,
    DB_USERNAME,
    DB_NAME
});

console.log('Connecting to MySQL database...');

const pool = mysql.createPool({
    host: DB_HOST,
    port: Number(DB_PORT), // Ensured it is parsed as a number
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