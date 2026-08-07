const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'movies.db');
const SQL_PATH = path.join(__dirname, 'data', 'embeddings_backup.sql');

console.log('Importing embeddings...');
console.log(`Database: ${DB_PATH}`);
console.log(`SQL file: ${SQL_PATH}`);

const db = new Database(DB_PATH);

// Read and execute SQL file
const sql = fs.readFileSync(SQL_PATH, 'utf8');
const statements = sql.split(';\n').filter(s => s.trim());

console.log(`\nExecuting ${statements.length} SQL statements...`);

let count = 0;
for (const stmt of statements) {
    if (stmt.trim()) {
        db.exec(stmt);
        count++;
        if (count % 1000 === 0) {
            process.stdout.write(`\r  Progress: ${count}/${statements.length}`);
        }
    }
}

console.log(`\r  Progress: ${count}/${statements.length} - Done!`);

// Verify
const result = db.prepare('SELECT COUNT(*) as count FROM movie_embeddings_local').get();
console.log(`\n✓ Imported ${result.count} embeddings`);

db.close();
console.log('✓ Complete!');
