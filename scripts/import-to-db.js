// One-time (re-run to refresh) import of IMDb's dataset dumps into a local SQLite DB
// for fast, flexible querying (genres, rating, votes, runtime, year) from the web app.
// Skips tvEpisode (huge volume, not relevant for a movie-browsing app) and untitled/unrated rows.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const readline = require("readline");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "movies.db");

function readTsvGz(fileName) {
  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`missing ${filePath} — run download-datasets.js first`);
  }
  const stream = fs.createReadStream(filePath).pipe(zlib.createGunzip());
  return readline.createInterface({ input: stream, crlfDelay: Infinity });
}

async function loadRatings() {
  const ratings = new Map(); // tconst -> { rating, votes }
  const rl = readTsvGz("title.ratings.tsv.gz");
  let first = true;
  for await (const line of rl) {
    if (first) {
      first = false;
      continue;
    }
    const [tconst, averageRating, numVotes] = line.split("\t");
    ratings.set(tconst, { rating: parseFloat(averageRating), votes: parseInt(numVotes, 10) });
  }
  return ratings;
}

async function importTitles(db, ratings) {
  db.exec(`
    DROP TABLE IF EXISTS titles;
    CREATE TABLE titles (
      imdbId TEXT PRIMARY KEY,
      titleType TEXT,
      title TEXT,
      year INTEGER,
      runtimeMinutes INTEGER,
      genres TEXT,
      isAdult INTEGER,
      rating REAL,
      votes INTEGER
    );
  `);

  const insert = db.prepare(`
    INSERT INTO titles (imdbId, titleType, title, year, runtimeMinutes, genres, isAdult, rating, votes)
    VALUES (@imdbId, @titleType, @title, @year, @runtimeMinutes, @genres, @isAdult, @rating, @votes)
  `);

  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(row);
  });

  const rl = readTsvGz("title.basics.tsv.gz");
  let first = true;
  let batch = [];
  let count = 0;

  for await (const line of rl) {
    if (first) {
      first = false;
      continue;
    }
    const [tconst, titleType, primaryTitle, , isAdult, startYear, , runtimeMinutes, genres] = line.split("\t");

    if (titleType === "tvEpisode") continue;
    const ratingInfo = ratings.get(tconst);
    if (!ratingInfo) continue;

    const year = parseInt(startYear, 10);
    const runtime = parseInt(runtimeMinutes, 10);

    batch.push({
      imdbId: tconst,
      titleType,
      title: primaryTitle,
      year: Number.isNaN(year) ? null : year,
      runtimeMinutes: Number.isNaN(runtime) ? null : runtime,
      genres: genres === "\\N" ? "" : `,${genres},`,
      isAdult: isAdult === "1" ? 1 : 0,
      rating: ratingInfo.rating,
      votes: ratingInfo.votes,
    });
    count++;

    if (batch.length >= 5000) {
      insertMany(batch);
      batch = [];
      process.stdout.write(`\rimported ${count} titles...`);
    }
  }
  if (batch.length) insertMany(batch);
  console.log(`\rimported ${count} titles total.`);

  console.log("creating indices...");
  db.exec(`
    CREATE INDEX idx_titles_rating ON titles(rating);
    CREATE INDEX idx_titles_votes ON titles(votes);
    CREATE INDEX idx_titles_year ON titles(year);
    CREATE INDEX idx_titles_type ON titles(titleType);
  `);
}

function ensurePostersTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posters (
      imdbId TEXT PRIMARY KEY,
      tmdbId INTEGER,
      posterUrl TEXT,
      fetchedAt INTEGER
    );
  `);
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  console.log("loading ratings...");
  const ratings = await loadRatings();
  console.log(`${ratings.size} rated titles`);

  console.log("importing titles (this can take a couple minutes)...");
  await importTitles(db, ratings);

  ensurePostersTable(db);
  db.close();
  console.log(`done. database at ${DB_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
