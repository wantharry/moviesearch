const Database = require("better-sqlite3");
const db = new Database("data/movies.db");

console.log("Checkpointing WAL...");
db.pragma("wal_checkpoint(TRUNCATE)");
console.log("✓ WAL checkpointed");

console.log("\nOptimizing database...");
db.pragma("optimize");
console.log("✓ Optimized");

console.log("\nFinal statistics:");
const stats = db.prepare("SELECT titleType, COUNT(*) as count FROM titles GROUP BY titleType ORDER BY count DESC").all();
stats.forEach(t => console.log(`  ${t.titleType}: ${t.count.toLocaleString()}`));
console.log(`Total: ${db.prepare("SELECT COUNT(*) FROM titles").get()['COUNT(*)'].toLocaleString()}`);

db.close();
console.log("\n✅ Done! Check size with: Get-ChildItem data\\movies.db");
