const fs = require('fs');
const path = require('path');
const { conn } = require('./db_connection');

async function runMigrations() {
    try {
        // 1. Ensure migrations tracking table exists
        await conn.promise().query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                migration_name VARCHAR(255) NOT NULL UNIQUE,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. Read all files in the migrations directory
        const migrationsDir = path.join(__dirname, 'migrations');
        if (!fs.existsSync(migrationsDir)) {
            return;
        }

        const files = fs.readdirSync(migrationsDir).sort(); // Order chronologically by filename

        for (const file of files) {
            if (!file.endsWith('.sql')) continue;

            // Check if this specific migration file has already been executed
            const [rows] = await conn.promise().query(
                'SELECT id FROM schema_migrations WHERE migration_name = ?',
                [file]
            );

            if (rows.length === 0) {
                console.log(`🔄 Running migration: ${file}...`);
                const sqlPath = path.join(migrationsDir, file);
                const sql = fs.readFileSync(sqlPath, 'utf8');

                // Execute the SQL file
                await conn.promise().query(sql);

                // Record execution in database
                await conn.promise().query(
                    'INSERT INTO schema_migrations (migration_name) VALUES (?)',
                    [file]
                );

                console.log(`✅ Migration applied successfully: ${file}`);
            }
        }
    } catch (error) {
        console.error('❌ Migration runner error:', error.message);
        throw error;
    }
}

module.exports = runMigrations;