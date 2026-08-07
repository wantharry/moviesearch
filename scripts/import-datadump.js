// Imports the full local IMDb CSV dump (datadump/archive/imdb_datasets/*.csv) into SQLite.
// Unlike the earlier gz-based importer, this keeps every row (no titleType/rating filtering)
// so nothing from the provided dump is dropped, and loads the full relational schema
// (titles, ratings merged in, names, crew, principals, episodes, akas).
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse");
const Database = require("better-sqlite3");

const DUMP_DIR = path.join(__dirname, "..", "datadump", "archive", "imdb_datasets");
const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "movies.db");

function streamCsv(fileName) {
  const filePath = path.join(DUMP_DIR, fileName);
  if (!fs.existsSync(filePath)) throw new Error(`missing ${filePath}`);
  return fs.createReadStream(filePath).pipe(parse({ columns: true, skip_empty_lines: true, relax_column_count: true }));
}

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
  const ratings = new Map(); // tconst -> { rating, votes }
  for await (const row of streamCsv("title.ratings.csv")) {
    ratings.set(row.tconst, { rating: toFloatOrNull(row.averageRating), votes: toIntOrNull(row.numVotes) });
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
      originalTitle TEXT,
      year INTEGER,
      endYear INTEGER,
      runtimeMinutes INTEGER,
      genres TEXT,
      isAdult INTEGER,
      rating REAL,
      votes INTEGER
    );
  `);
  const insert = db.prepare(`
    INSERT OR REPLACE INTO titles (imdbId, titleType, title, originalTitle, year, endYear, runtimeMinutes, genres, isAdult, rating, votes)
    VALUES (@imdbId, @titleType, @title, @originalTitle, @year, @endYear, @runtimeMinutes, @genres, @isAdult, @rating, @votes)
  `);
  const insertMany = db.transaction((rows) => { for (const row of rows) insert.run(row); });

  let batch = [];
  let count = 0;
  for await (const row of streamCsv("title.basics.csv")) {
    const ratingInfo = ratings.get(row.tconst) || { rating: null, votes: null };
    batch.push({
      imdbId: row.tconst,
      titleType: row.titleType || null,
      title: row.primaryTitle || null,
      originalTitle: row.originalTitle || null,
      year: toIntOrNull(row.startYear),
      endYear: toIntOrNull(row.endYear),
      runtimeMinutes: toIntOrNull(row.runtimeMinutes),
      genres: row.genres && row.genres !== "\\N" ? `,${row.genres},` : "",
      isAdult: toIntOrNull(row.isAdult) || 0,
      rating: ratingInfo.rating,
      votes: ratingInfo.votes,
    });
    count++;
    if (batch.length >= 5000) {
      insertMany(batch);
      batch = [];
      process.stdout.write(`\r  titles: ${count}`);
    }
  }
  if (batch.length) insertMany(batch);
  console.log(`\r  titles: ${count} total`);

  db.exec(`
    CREATE INDEX idx_titles_rating ON titles(rating);
    CREATE INDEX idx_titles_votes ON titles(votes);
    CREATE INDEX idx_titles_year ON titles(year);
    CREATE INDEX idx_titles_type ON titles(titleType);
  `);
}

async function importSimpleTable(db, fileName, tableName, createSql, mapRow, batchSize = 5000) {
  db.exec(`DROP TABLE IF EXISTS ${tableName}; ${createSql}`);
  const columns = Object.keys(mapRow({}));
  const insert = db.prepare(`INSERT INTO ${tableName} (${columns.join(",")}) VALUES (${columns.map((c) => "@" + c).join(",")})`);
  const insertMany = db.transaction((rows) => { for (const row of rows) insert.run(row); });

  let batch = [];
  let count = 0;
  for await (const row of streamCsv(fileName)) {
    batch.push(mapRow(row));
    count++;
    if (batch.length >= batchSize) {
      insertMany(batch);
      batch = [];
      process.stdout.write(`\r  ${tableName}: ${count}`);
    }
  }
  if (batch.length) insertMany(batch);
  console.log(`\r  ${tableName}: ${count} total`);
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  console.log("loading ratings...");
  const ratings = await loadRatings();
  console.log(`${ratings.size} rated titles`);

  console.log("importing titles...");
  await importTitles(db, ratings);

  console.log("importing names...");
  await importSimpleTable(
    db, "name.basics.csv", "names",
    `CREATE TABLE names (nconst TEXT PRIMARY KEY, primaryName TEXT, birthYear INTEGER, deathYear INTEGER, primaryProfession TEXT, knownForTitles TEXT);`,
    (row) => ({
      nconst: row.nconst, primaryName: row.primaryName || null,
      birthYear: toIntOrNull(row.birthYear), deathYear: toIntOrNull(row.deathYear),
      primaryProfession: row.primaryProfession || null, knownForTitles: row.knownForTitles || null,
    })
  );

  console.log("importing crew...");
  await importSimpleTable(
    db, "title.crew.csv", "crew",
    `CREATE TABLE crew (tconst TEXT PRIMARY KEY, directors TEXT, writers TEXT);`,
    (row) => ({ tconst: row.tconst, directors: row.directors || null, writers: row.writers || null })
  );

  console.log("importing episodes...");
  await importSimpleTable(
    db, "title.episode.csv", "episodes",
    `CREATE TABLE episodes (tconst TEXT PRIMARY KEY, parentTconst TEXT, seasonNumber INTEGER, episodeNumber INTEGER);`,
    (row) => ({
      tconst: row.tconst, parentTconst: row.parentTconst || null,
      seasonNumber: toIntOrNull(row.seasonNumber), episodeNumber: toIntOrNull(row.episodeNumber),
    })
  );
  db.exec(`CREATE INDEX idx_episodes_parent ON episodes(parentTconst);`);

  console.log("importing principals (cast/crew per title)...");
  await importSimpleTable(
    db, "title.principals.csv", "principals",
    `CREATE TABLE principals (id INTEGER PRIMARY KEY AUTOINCREMENT, tconst TEXT, ordering INTEGER, nconst TEXT, category TEXT, job TEXT, characters TEXT);`,
    (row) => ({
      tconst: row.tconst, ordering: toIntOrNull(row.ordering), nconst: row.nconst,
      category: row.category || null, job: row.job || null, characters: row.characters || null,
    })
  );
  db.exec(`CREATE INDEX idx_principals_tconst ON principals(tconst); CREATE INDEX idx_principals_nconst ON principals(nconst);`);

  console.log("importing akas (alternate titles)...");
  await importSimpleTable(
    db, "title.akas.csv", "akas",
    `CREATE TABLE akas (id INTEGER PRIMARY KEY AUTOINCREMENT, titleId TEXT, ordering INTEGER, title TEXT, region TEXT, language TEXT, types TEXT, attributes TEXT, isOriginalTitle INTEGER);`,
    (row) => ({
      titleId: row.titleId, ordering: toIntOrNull(row.ordering), title: row.title || null,
      region: row.region || null, language: row.language || null, types: row.types || null,
      attributes: row.attributes || null, isOriginalTitle: toIntOrNull(row.isOriginalTitle) || 0,
    })
  );
  db.exec(`CREATE INDEX idx_akas_titleid ON akas(titleId);`);

  db.exec(`CREATE TABLE IF NOT EXISTS posters (imdbId TEXT PRIMARY KEY, tmdbId INTEGER, posterUrl TEXT, fetchedAt INTEGER);`);

  db.close();
  console.log(`done. database at ${DB_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
