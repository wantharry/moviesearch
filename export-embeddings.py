#!/usr/bin/env python3
import sqlite3
import sys

# Export embeddings from WSL database
source_db = "/home/openclaw/imdb-temp/movies.db"
export_file = "/home/openclaw/imdb-temp/embeddings_backup.sql"

print(f"Exporting embeddings from {source_db}...")

conn = sqlite3.connect(source_db)
cursor = conn.cursor()

# Get count
cursor.execute("SELECT COUNT(*) FROM movie_embeddings_local")
count = cursor.fetchone()[0]
print(f"Found {count} embeddings to export")

# Write SQL dump
with open(export_file, 'w') as f:
    # Table schema
    f.write("DROP TABLE IF EXISTS movie_embeddings_local;\n")
    f.write("""CREATE TABLE movie_embeddings_local (
    imdbId TEXT PRIMARY KEY,
    embedding BLOB NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
""")
    
    # Data
    cursor.execute("SELECT imdbId, embedding FROM movie_embeddings_local")
    for row in cursor.fetchall():
        imdb_id = row[0]
        embedding_hex = row[1].hex()
        f.write(f"INSERT INTO movie_embeddings_local (imdbId, embedding) VALUES ('{imdb_id}', X'{embedding_hex}');\n")

conn.close()
print(f"✓ Exported to {export_file}")
print(f"File size: {len(open(export_file).read())/1024/1024:.1f} MB")
