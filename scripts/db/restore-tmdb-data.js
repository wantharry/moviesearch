const Database = require('better-sqlite3');

console.log('Copying tmdb_details from backup...');

// Open both databases
const backup = new Database('c:/Users/openclaw/projects/ai/apps1/imdb/data/movies-cleaned-backup.db', { readonly: true });
const main = new Database('c:/Users/openclaw/projects/ai/apps1/imdb/data/movies.db');

// Attach backup database
main.exec("ATTACH DATABASE 'c:/Users/openclaw/projects/ai/apps1/imdb/data/movies-cleaned-backup.db' AS backup");

// Copy the tmdb_details table
console.log('Creating tmdb_details table...');
main.exec(`
  CREATE TABLE IF NOT EXISTS tmdb_details AS 
  SELECT * FROM backup.tmdb_details
`);

// Copy the posters table too
console.log('Creating posters table...');
main.exec(`
  CREATE TABLE IF NOT EXISTS posters AS 
  SELECT * FROM backup.posters
`);

// Detach
main.exec("DETACH DATABASE backup");

// Verify
const tmdb_count = main.prepare('SELECT COUNT(*) as count FROM tmdb_details').get();
const posters_count = main.prepare('SELECT COUNT(*) as count FROM posters').get();

console.log(`✓ tmdb_details: ${tmdb_count.count.toLocaleString()} rows`);
console.log(`✓ posters: ${posters_count.count.toLocaleString()} rows`);

// Count movies with overviews
const overviews = main.prepare(`
  SELECT COUNT(*) as count 
  FROM titles t 
  JOIN tmdb_details td ON t.imdbId = td.imdbId 
  WHERE td.overview IS NOT NULL AND td.overview != ''
`).get();

console.log(`\n✓ Movies with plot descriptions: ${overviews.count.toLocaleString()}`);

main.close();
backup.close();
