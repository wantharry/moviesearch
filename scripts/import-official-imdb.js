// Import official IMDb datasets from datadump/imdb_official/*.tsv
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const Database = require("better-sqlite3");

const DUMP_DIR = path.join(__dirname, "..", "datadump", "imdb_official");
const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "movies.db");

function toIntOrNull(v) {
  if (v === undefined || v === null || v === "" || v === "\\N") return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function toFloatOrNull(v) {
  if (v === undefined || v === null || v === "" || v === "\\N") return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

async function loadRatings() {
  console.log("Loading ratings...");
  const ratings = new Map();
  const filePath = path.join(DUMP_DIR, "title.ratings.tsv");
  
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  
  let isHeader = true;
  let count = 0;
  
  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    
    const parts = line.split('\t');
    if (parts.length >= 3) {
      ratings.set(parts[0], {
        rating: toFloatOrNull(parts[1]),
        votes: toIntOrNull(parts[2])
      });
      count++;
      if (count % 100000 === 0) process.stdout.write(`\r  Ratings loaded: ${count.toLocaleString()}`);
    }
  }
  
  console.log(`\r  Ratings loaded: ${count.toLocaleString()} total`);
  return ratings;
}

async function importTitles(db, ratings) {
  console.log("\nImporting titles...");
  
  // Drop and recreate titles table
  db.exec(`DROP TABLE IF EXISTS titles`);
  db.exec(`
    CREATE TABLE titles (
      imdbId TEXT PRIMARY KEY,
      titleType TEXT,
      title TEXT,
      originalTitle TEXT,
      year INTEGER,
      endYear INTEGER,
      runtimeMinutes INTEGER,
      genres TEXT,
      isAdult INTEGER,
      rating REAL,
      votes INTEGER
    )
  `);
  
  const insert = db.prepare(`
    INSERT INTO titles (imdbId, titleType, title, originalTitle, year, endYear, runtimeMinutes, genres, isAdult, rating, votes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });
  
  const filePath = path.join(DUMP_DIR, "title.basics.tsv");
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  
  let isHeader = true;
  let batch = [];
  let count = 0;
  const BATCH_SIZE = 5000;
  
  for await (const line of rl) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    
    const parts = line.split('\t');
    if (parts.length >= 9) {
      const imdbId = parts[0];
      const ratingInfo = ratings.get(imdbId) || { rating: null, votes: null };
      
      batch.push([
        imdbId,
        parts[1] || null, // titleType
        parts[2] || null, // primaryTitle
        parts[3] || null, // originalTitle
        toIntOrNull(parts[5]), // startYear
        toIntOrNull(parts[6]), // endYear
        toIntOrNull(parts[7]), // runtimeMinutes
        parts[8] && parts[8] !== "\\N" ? `,${parts[8]},` : "", // genres
        toIntOrNull(parts[4]) || 0, // isAdult
        ratingInfo.rating,
        ratingInfo.votes
      ]);
      
      count++;
      
      if (batch.length >= BATCH_SIZE) {
        insertMany(batch);
        batch = [];
        process.stdout.write(`\r  Titles imported: ${count.toLocaleString()}`);
      }
    }
  }
  
  if (batch.length > 0) {
    insertMany(batch);
  }
  
  console.log(`\r  Titles imported: ${count.toLocaleString()} total`);
  
  // Create indexes
  console.log("\nCreating indexes...");
  db.exec(`CREATE INDEX idx_titles_rating ON titles(rating)`);
  db.exec(`CREATE INDEX idx_titles_votes ON titles(votes)`);
  db.exec(`CREATE INDEX idx_titles_year ON titles(year)`);
  db.exec(`CREATE INDEX idx_titles_type ON titles(titleType)`);
  console.log("  Indexes created");
}

async function main() {
  console.log("Official IMDb Dataset Import");
  console.log("============================\n");
  
  const ratingsFile = path.join(DUMP_DIR, "title.ratings.tsv");
  const basicsFile = path.join(DUMP_DIR, "title.basics.tsv");
  
  if (!fs.existsSync(ratingsFile) || !fs.existsSync(basicsFile)) {
    console.error("Error: Required TSV files not found in", DUMP_DIR);
    console.error("Expected files: title.basics.tsv, title.ratings.tsv");
    process.exit(1);
  }
  
  console.log("Opening database...");
  const db = new Database(DB_PATH);
  
  try {
    const ratings = await loadRatings();
    await importTitles(db, ratings);
    
    // Show stats
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN titleType = 'movie' THEN 1 END) as movies,
        COUNT(CASE WHEN titleType = 'tvSeries' THEN 1 END) as tv_series,
        COUNT(CASE WHEN votes >= 1000 THEN 1 END) as with_1k_votes
      FROM titles
    `).get();
    
    console.log("\n=== Database Statistics ===");
    console.log(`Total titles: ${stats.total.toLocaleString()}`);
    console.log(`Movies: ${stats.movies.toLocaleString()}`);
    console.log(`TV Series: ${stats.tv_series.toLocaleString()}`);
    console.log(`With 1000+ votes: ${stats.with_1k_votes.toLocaleString()}`);
    
    // Check for Breaking Bad
    const breakingBad = db.prepare("SELECT * FROM titles WHERE imdbId = 'tt0903747'").get();
    if (breakingBad) {
      console.log("\n✓ Breaking Bad found!");
      console.log(`  Title: ${breakingBad.title}`);
      console.log(`  Year: ${breakingBad.year}`);
      console.log(`  Rating: ${breakingBad.rating}`);
      console.log(`  Votes: ${breakingBad.votes?.toLocaleString()}`);
    }
    
    console.log("\n✓ Import complete!");
    
  } catch (err) {
    console.error("Error during import:", err);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
