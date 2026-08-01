const fs = require('fs');
const path = require('path');
const { conn } = require('./db_connection'); 

async function initDatabase() {
    try {
        // Path to schema.sql in the same Database directory
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        // Run multi-statement query
        await conn.promise().query(schemaSql);
        
    } catch (error) {
        console.error('❌ Database initialization error:', error.message);
        throw error;
    }
}

module.exports = initDatabase;