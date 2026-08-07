const Database = require("better-sqlite3");
const db = new Database("data/movies.db");

console.log("=== Adding overview search capability ===\n");

console.log("Step 1: Drop old FTS index...");
db.exec("DROP TABLE IF EXISTS titles_fts");

console.log("Step 2: Create new FTS index with title + overview...");
db.exec(`
  CREATE VIRTUAL TABLE titles_fts USING fts5(
    imdbId UNINDEXED, 
    title, 
    overview,
    genres,
    tokenize='porter unicode61'
  )
`);

console.log("Step 3: Populate FTS index with titles and overviews...");
db.exec(`
  INSERT INTO titles_fts(imdbId, title, overview, genres)
  SELECT 
    t.imdbId, 
    t.title, 
    COALESCE(d.overview, ''),
    t.genres
  FROM titles t
  LEFT JOIN tmdb_details d ON t.imdbId = d.imdbId
  WHERE t.isAdult = 0
`);

const count = db.prepare("SELECT COUNT(*) as c FROM titles_fts").get();
console.log(`✓ Indexed ${count.c.toLocaleString()} titles with overviews`);

console.log("\n=== Testing contextual search ===\n");

// Test: "woman spy"
const results = db.prepare(`
  SELECT 
    t.imdbId,
    t.title,
    t.year,
    t.rating,
    d.overview,
    bm25(titles_fts) as relevance
  FROM titles_fts
  JOIN titles t ON titles_fts.imdbId = t.imdbId
  LEFT JOIN tmdb_details d ON t.imdbId = d.imdbId
  WHERE titles_fts MATCH 'woman spy OR female agent OR spy thriller'
  ORDER BY bm25(titles_fts)
  LIMIT 10
`).all();

console.log('Search: "woman spy OR female agent OR spy thriller"\n');
results.forEach((r, i) => {
  console.log(`${i + 1}. ${r.title} (${r.year}) - Rating: ${r.rating || 'N/A'}`);
  console.log(`   ${r.overview?.substring(0, 100)}...`);
  console.log(`   Relevance: ${r.relevance.toFixed(2)}\n`);
});

db.close();
console.log("✅ Done! Overview search is now enabled.");
