const Database = require('better-sqlite3');
const db = new Database('./data/movies.db');

console.log('Rebuilding FTS5 table...\n');

try {
  // Drop existing FTS table
  console.log('Dropping old FTS table...');
  db.exec(`DROP TABLE IF EXISTS titles_fts`);
  
  // Create new FTS5 table with explicit tokenizer
  console.log('Creating new FTS5 table...');
  db.exec(`CREATE VIRTUAL TABLE titles_fts USING fts5(imdbId UNINDEXED, title, tokenize='porter unicode61')`);
  
  // Populate it
  console.log('Populating FTS5 table (this will take a moment)...');
  db.exec(`INSERT INTO titles_fts(imdbId, title) SELECT imdbId, title FROM titles WHERE isAdult = 0`);
  
  const count = db.prepare(`SELECT COUNT(*) AS c FROM titles_fts`).get();
  console.log(`Inserted ${count.c.toLocaleString()} titles`);
  
  // Test search
  console.log('\nTesting search for "breaking*":');
  const results = db.prepare(`SELECT imdbId, title FROM titles_fts WHERE titles_fts MATCH ? LIMIT 5`).all('breaking*');
  console.log(`Found ${results.length} results:`);
  results.forEach(r => console.log(`  - ${r.title}`));
  
  console.log('\n✓ FTS5 table rebuilt successfully!');
} catch (error) {
  console.error('Error:', error.message);
}

db.close();
