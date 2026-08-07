const Database = require("better-sqlite3");
const db = new Database("data/movies.db");

console.log("\n=== Before Cleanup ===");
const beforeStats = db.prepare("SELECT titleType, COUNT(*) as count FROM titles GROUP BY titleType ORDER BY count DESC").all();
beforeStats.forEach(t => console.log(`  ${t.titleType}: ${t.count.toLocaleString()}`));
console.log(`Total: ${db.prepare("SELECT COUNT(*) FROM titles").get()['COUNT(*)'].toLocaleString()}`);

console.log("\n=== Removing TV episodes, shorts, videos, and games ===");

// Delete from FTS5 index first
const deleteFromFTS = db.prepare(`
  DELETE FROM titles_fts 
  WHERE imdbId IN (
    SELECT imdbId FROM titles 
    WHERE titleType IN ('tvEpisode', 'short', 'video', 'videoGame', 'tvShort')
  )
`);

// Delete from main table
const deleteFromTitles = db.prepare(`
  DELETE FROM titles 
  WHERE titleType IN ('tvEpisode', 'short', 'video', 'videoGame', 'tvShort')
`);

console.log("Deleting from FTS index...");
const ftsResult = deleteFromFTS.run();
console.log(`  Removed ${ftsResult.changes.toLocaleString()} entries from FTS index`);

console.log("Deleting from main table...");
const titlesResult = deleteFromTitles.run();
console.log(`  Removed ${titlesResult.changes.toLocaleString()} titles`);

console.log("\n=== After Cleanup ===");
const afterStats = db.prepare("SELECT titleType, COUNT(*) as count FROM titles GROUP BY titleType ORDER BY count DESC").all();
afterStats.forEach(t => console.log(`  ${t.titleType}: ${t.count.toLocaleString()}`));
console.log(`Total: ${db.prepare("SELECT COUNT(*) FROM titles").get()['COUNT(*)'].toLocaleString()}`);

console.log("\n=== Vacuuming database to reclaim space ===");
db.exec("VACUUM");
console.log("✓ Database vacuumed");

db.close();

console.log("\n✅ Database cleanup complete!");
console.log("Check new size with: Get-ChildItem data/movies.db");
