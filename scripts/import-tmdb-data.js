// Import TMDb data from TMDB_all_movies.csv into the existing database
// Matches by IMDb ID and adds overview, certification, poster_path, etc.

const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse");
const Database = require("better-sqlite3");

const TMDB_CSV = path.join(__dirname, "..", "datadump", "archive (1)", "TMDB_all_movies.csv");
const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "movies.db");

if (!fs.existsSync(TMDB_CSV)) {
  console.error(`TMDb CSV not found at: ${TMDB_CSV}`);
  process.exit(1);
}

console.log("Opening database...");
const db = new Database(DB_PATH);

// Check if columns exist, add them if not
console.log("Ensuring schema has TMDb columns...");
const tableInfo = db.pragma("table_info(tmdb_details)");
const columns = new Set(tableInfo.map(col => col.name));

if (!columns.has('tmdb_id')) {
  console.log("  Adding tmdb_id column to tmdb_details...");
  db.exec("ALTER TABLE tmdb_details ADD COLUMN tmdb_id INTEGER");
}
if (!columns.has('poster_path')) {
  console.log("  Adding poster_path column to tmdb_details...");
  db.exec("ALTER TABLE tmdb_details ADD COLUMN poster_path TEXT");
}

// Prepare statements
const updateDetails = db.prepare(`
  INSERT INTO tmdb_details (imdbId, certification, overview, tmdb_id, poster_path, fetchedAt)
  VALUES (@imdbId, @certification, @overview, @tmdb_id, @poster_path, @fetchedAt)
  ON CONFLICT(imdbId) DO UPDATE SET 
    certification = COALESCE(excluded.certification, certification),
    overview = COALESCE(excluded.overview, overview),
    tmdb_id = COALESCE(excluded.tmdb_id, tmdb_id),
    poster_path = COALESCE(excluded.poster_path, poster_path),
    fetchedAt = excluded.fetchedAt
`);

const updatePoster = db.prepare(`
  INSERT INTO posters (imdbId, tmdbId, posterUrl, fetchedAt)
  VALUES (@imdbId, @tmdbId, @posterUrl, @fetchedAt)
  ON CONFLICT(imdbId) DO UPDATE SET 
    tmdbId = COALESCE(excluded.tmdbId, tmdbId),
    posterUrl = COALESCE(excluded.posterUrl, posterUrl),
    fetchedAt = excluded.fetchedAt
`);

const checkImdbId = db.prepare("SELECT 1 FROM titles WHERE imdbId = ? LIMIT 1");

console.log("Reading TMDb CSV and matching to database...");

let processed = 0;
let matched = 0;
let updated = 0;

const stream = fs.createReadStream(TMDB_CSV)
  .pipe(parse({ 
    columns: true, 
    skip_empty_lines: true,
    relax_column_count: true,
    quote: '"',
    escape: '"'
  }));

const transaction = db.transaction((batch) => {
  for (const row of batch) {
    updateDetails.run(row.details);
    updatePoster.run(row.poster);
    updated++;
  }
});

let batch = [];
const BATCH_SIZE = 1000;

stream.on('data', (row) => {
  processed++;
  
  const imdbId = row.imdb_id;
  if (!imdbId || imdbId === '0' || !imdbId.startsWith('tt')) {
    return;
  }
  
  // Check if this IMDb ID exists in our database
  const exists = checkImdbId.get(imdbId);
  if (!exists) {
    return;
  }
  
  matched++;
  
  // Parse certification (use US certification)
  let certification = row.certification_us || null;
  if (certification === '' || certification === 'NR' || certification === 'Not Rated') {
    certification = null;
  }
  
  // Parse overview
  const overview = row.overview && row.overview.length > 0 ? row.overview : null;
  
  // Parse TMDb ID
  const tmdb_id = row.id ? parseInt(row.id, 10) : null;
  
  // Parse poster path
  let poster_path = row.poster_path || null;
  
  const now = Date.now();
  
  batch.push({
    details: {
      imdbId,
      certification,
      overview,
      tmdb_id,
      poster_path,
      fetchedAt: now
    },
    poster: {
      imdbId,
      tmdbId: tmdb_id,
      posterUrl: poster_path ? `https://image.tmdb.org/t/p/w342${poster_path}` : null,
      fetchedAt: now
    }
  });
  
  if (batch.length >= BATCH_SIZE) {
    transaction(batch);
    batch = [];
    process.stdout.write(`\r  Processed: ${processed.toLocaleString()} | Matched: ${matched.toLocaleString()} | Updated: ${updated.toLocaleString()}`);
  }
});

stream.on('end', () => {
  if (batch.length > 0) {
    transaction(batch);
  }
  
  console.log(`\r  Processed: ${processed.toLocaleString()} | Matched: ${matched.toLocaleString()} | Updated: ${updated.toLocaleString()}`);
  console.log("\nCreating indexes...");
  
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_tmdb_details_tmdb_id ON tmdb_details(tmdb_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_tmdb_details_certification ON tmdb_details(certification)");
  } catch (e) {
    // Indexes might already exist
  }
  
  console.log("Done! TMDb data imported successfully.");
  
  // Show some stats
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      COUNT(overview) as with_overview,
      COUNT(certification) as with_cert,
      COUNT(poster_path) as with_poster
    FROM tmdb_details
  `).get();
  
  console.log("\nDatabase statistics:");
  console.log(`  Total records in tmdb_details: ${stats.total.toLocaleString()}`);
  console.log(`  With overview: ${stats.with_overview.toLocaleString()}`);
  console.log(`  With certification: ${stats.with_cert.toLocaleString()}`);
  console.log(`  With poster: ${stats.with_poster.toLocaleString()}`);
  
  db.close();
});

stream.on('error', (err) => {
  console.error("Error reading CSV:", err);
  db.close();
  process.exit(1);
});
