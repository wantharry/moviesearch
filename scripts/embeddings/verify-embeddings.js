const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('data/movies.db');
const emb = db.prepare('SELECT COUNT(*) as c FROM movie_embeddings_local').get();
const titles = db.prepare('SELECT COUNT(*) as c FROM titles').get();
const tmdb = db.prepare('SELECT COUNT(*) as c FROM tmdb_details').get();
const size = fs.statSync('data/movies.db').size;

console.log('\n🎉 SEMANTIC SEARCH READY!\n');
console.log('Database Statistics:');
console.log('===================');
console.log('✓ Total titles:', titles.c.toLocaleString());
console.log('✓ TMDb data:', tmdb.c.toLocaleString(), 'movies');
console.log('✓ AI Embeddings:', emb.c.toLocaleString(), 'movies');
console.log('✓ Database size:', (size/1024/1024/1024).toFixed(2), 'GB');
console.log('\nCoverage:', ((emb.c / tmdb.c) * 100).toFixed(1) + '%', 'of movies with descriptions');

db.close();
