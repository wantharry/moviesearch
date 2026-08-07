#!/usr/bin/env python3
"""
Generate embeddings for ALL titles with TMDb overviews
This will process ~678k titles instead of just 100k
"""

import sys
import sqlite3
import numpy as np
from sentence_transformers import SentenceTransformer
import time

# Paths (will be in WSL)
db_path = "/home/openclaw/imdb-temp/movies.db"

print("Loading sentence transformer model...")
model = SentenceTransformer('all-MiniLM-L6-v2')
print("✓ Model loaded\n")

# Connect to database
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

def setup_embeddings_table():
    """Create the embeddings table"""
    print("Creating embeddings table...")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS movie_embeddings_local (
            imdbId TEXT PRIMARY KEY,
            embedding BLOB NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    print("✓ Table created\n")

def generate_all_embeddings():
    """Generate embeddings for ALL movies/series with overviews"""
    print("Fetching ALL titles with TMDb overviews (no limit)...")
    
    cursor.execute("""
        SELECT t.imdbId, t.title, td.overview, t.genres
        FROM titles t
        LEFT JOIN tmdb_details td ON t.imdbId = td.imdbId
        WHERE t.titleType IN ('movie', 'tvSeries', 'tvMovie', 'tvMiniSeries', 'tvSpecial')
        AND td.overview IS NOT NULL
        AND td.overview != ''
        ORDER BY t.votes DESC
    """)
    
    movies = cursor.fetchall()
    total = len(movies)
    print(f"✓ Found {total:,} titles to embed\n")
    
    if total == 0:
        print("No movies to process!")
        return
    
    print("Generating embeddings...")
    print("This will take approximately", int(total / 6700), "minutes for", total, "titles")
    print("")
    
    # Generate embeddings in batches
    batch_size = 100
    start_time = time.time()
    processed = 0
    
    for i in range(0, len(movies), batch_size):
        batch = movies[i:i+batch_size]
        
        # Prepare texts
        texts = []
        for imdbId, title, overview, genres in batch:
            genre_str = genres if genres else ""
            text = f"{title}. {overview} Genres: {genre_str}"
            texts.append(text)
        
        # Generate embeddings
        embeddings = model.encode(texts, show_progress_bar=False)
        
        # Store in database
        for j, (imdbId, _, _, _) in enumerate(batch):
            embedding_blob = embeddings[j].astype(np.float32).tobytes()
            cursor.execute(
                "INSERT OR REPLACE INTO movie_embeddings_local (imdbId, embedding) VALUES (?, ?)",
                (imdbId, embedding_blob)
            )
        
        conn.commit()
        processed += len(batch)
        
        # Progress update every 1000
        if processed % 1000 == 0:
            elapsed = time.time() - start_time
            rate = processed / elapsed
            remaining = (total - processed) / rate / 60
            print(f"Progress: {processed:,}/{total:,} ({processed/total*100:.1f}%) - {int(rate)}/sec - ETA: {int(remaining)} min")
    
    elapsed = time.time() - start_time
    print(f"\n✓ Done! Processed {total:,} titles in {elapsed/60:.1f} minutes")
    print(f"  Rate: {int(total/elapsed)} embeddings/second")

if __name__ == "__main__":
    setup_embeddings_table()
    generate_all_embeddings()
    conn.close()
