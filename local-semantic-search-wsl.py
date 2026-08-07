#!/usr/bin/env python3
"""
Local Semantic Search - WSL Version
"""

import sqlite3
import numpy as np
from sentence_transformers import SentenceTransformer
import json
import sys

# Load model (downloads ~90MB on first run, then cached)
print("Loading sentence transformer model...")
model = SentenceTransformer('all-MiniLM-L6-v2')
print("✓ Model loaded\n")

# Connect to database  
db_path = "/home/openclaw/imdb-temp/movies.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

def setup_embeddings_table():
    """Create table for storing embeddings"""
    print("Creating embeddings table...")
    cursor.execute("DROP TABLE IF EXISTS movie_embeddings_local")
    cursor.execute("""
        CREATE TABLE movie_embeddings_local (
            imdbId TEXT PRIMARY KEY,
            embedding BLOB NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    print("✓ Table created\n")

def generate_embeddings(limit=100000):
    """Generate embeddings for top movies"""
    print(f"Fetching top {limit} movies with overviews...")
    
    cursor.execute("""
        SELECT t.imdbId, t.title, td.overview, t.genres
        FROM titles t
        LEFT JOIN tmdb_details td ON t.imdbId = td.imdbId
        WHERE t.titleType IN ('movie', 'tvSeries', 'tvMovie', 'tvMiniSeries', 'tvSpecial')
        AND td.overview IS NOT NULL
        AND td.overview != ''
        ORDER BY t.votes DESC
        LIMIT ?
    """, (limit,))
    
    movies = cursor.fetchall()
    print(f"✓ Found {len(movies)} movies to embed\n")
    
    if len(movies) == 0:
        print("No movies to process!")
        return
    
    print("Generating embeddings...")
    print("Progress:")
    
    # Generate embeddings in batches
    batch_size = 100
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
        print(f"  {min(i+batch_size, len(movies))}/{len(movies)} movies")
    
    print("\n✓ Embeddings generated successfully!\n")

def search_similar(query, limit=20):
    """Find movies similar to query"""
    print(f'Searching for: "{query}"\n')
    
    # Generate query embedding
    query_embedding = model.encode([query])[0]
    
    # Get all movie embeddings
    cursor.execute("""
        SELECT 
            e.imdbId, 
            e.embedding, 
            t.title, 
            t.year, 
            t.rating, 
            t.votes,
            t.genres, 
            td.overview
        FROM movie_embeddings_local e
        JOIN titles t ON e.imdbId = t.imdbId
        LEFT JOIN tmdb_details td ON e.imdbId = td.imdbId
    """)
    
    results = []
    for row in cursor.fetchall():
        imdbId, embedding_bytes, title, year, rating, votes, genres, overview = row
        
        # Convert bytes back to numpy array
        movie_embedding = np.frombuffer(embedding_bytes, dtype=np.float32)
        
        # Cosine similarity
        similarity = np.dot(query_embedding, movie_embedding) / (
            np.linalg.norm(query_embedding) * np.linalg.norm(movie_embedding)
        )
        
        results.append({
            'imdbId': imdbId,
            'title': title,
            'year': year,
            'rating': rating,
            'votes': votes,
            'genres': genres,
            'overview': overview,
            'similarity': float(similarity)
        })
    
    # Sort by similarity
    results.sort(key=lambda x: x['similarity'], reverse=True)
    
    return results[:limit]

def main():
    if len(sys.argv) < 2:
        print("Usage:")
        print("  Setup:  python3 local-semantic-search-wsl.py setup")
        print("  Search: python3 local-semantic-search-wsl.py search 'woman spy thriller'")
        print("  JSON:   python3 local-semantic-search-wsl.py json 'woman spy thriller'")
        return
    
    command = sys.argv[1]
    
    if command == "setup":
        setup_embeddings_table()
        generate_embeddings(limit=100000)
        
    elif command == "search":
        query = sys.argv[2] if len(sys.argv) > 2 else "woman spy thriller"
        results = search_similar(query, limit=10)
        
        print(f"Top 10 results:\n")
        for i, movie in enumerate(results, 1):
            print(f"{i}. {movie['title']} ({movie['year']})")
            if movie['rating']:
                print(f"   Rating: {movie['rating']}/10 ({movie['votes']:,} votes)")
            print(f"   Similarity: {movie['similarity']*100:.1f}%")
            print(f"   Genres: {movie['genres'] or 'N/A'}")
            if movie['overview']:
                print(f"   {movie['overview'][:120]}...")
            print()
    
    elif command == "json":
        query = sys.argv[2] if len(sys.argv) > 2 else "woman spy thriller"
        results = search_similar(query, limit=20)
        print(json.dumps(results, indent=2))
    
    else:
        print(f"Unknown command: {command}")
    
    conn.close()

if __name__ == "__main__":
    main()
