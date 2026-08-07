#!/usr/bin/env python3
"""
Local Semantic Search using Sentence Transformers
100% free, runs entirely on your machine
"""

import sqlite3
import numpy as np
from sentence_transformers import SentenceTransformer
import json
import sys

# Load model (downloads ~90MB on first run, then cached)
print("Loading sentence transformer model...")
model = SentenceTransformer('all-MiniLM-L6-v2')  # Fast, accurate, small
print("✓ Model loaded\n")

# Connect to database
db_path = "/mnt/c/Users/openclaw/projects/ai/apps1/imdb/data/movies.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

def setup_embeddings_table():
    """Create table for storing embeddings"""
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS movie_embeddings_local (
            imdbId TEXT PRIMARY KEY,
            embedding BLOB,
            created_at INTEGER DEFAULT (unixepoch())
        )
    """)
    conn.commit()
    print("✓ Embeddings table created\n")

def generate_embeddings(limit=10000):
    """Generate embeddings for top movies"""
    print(f"Fetching top {limit} movies with overviews...")
    
    cursor.execute("""
        SELECT t.imdbId, t.title, t.year, d.overview, t.genres
        FROM titles t
        JOIN tmdb_details d ON t.imdbId = d.imdbId
        LEFT JOIN movie_embeddings_local e ON t.imdbId = e.imdbId
        WHERE d.overview IS NOT NULL 
            AND d.overview != ''
            AND e.imdbId IS NULL
            AND t.titleType = 'movie'
            AND t.rating >= 5.0
        ORDER BY t.votes DESC
        LIMIT ?
    """, (limit,))
    
    movies = cursor.fetchall()
    print(f"Found {len(movies)} movies to process\n")
    
    if len(movies) == 0:
        print("No new movies to process!")
        return
    
    # Prepare texts for embedding
    texts = [
        f"{title} ({year}). {genres or ''}. {overview}"
        for imdb_id, title, year, overview, genres in movies
    ]
    
    print("Generating embeddings...")
    print("This will take ~5-10 minutes for 10,000 movies...")
    
    # Generate embeddings in batches
    batch_size = 100
    for i in range(0, len(texts), batch_size):
        batch_texts = texts[i:i+batch_size]
        batch_movies = movies[i:i+batch_size]
        
        # Generate embeddings
        embeddings = model.encode(batch_texts, show_progress_bar=False)
        
        # Store in database
        for j, (imdb_id, _, _, _, _) in enumerate(batch_movies):
            embedding_bytes = embeddings[j].tobytes()
            cursor.execute(
                "INSERT OR REPLACE INTO movie_embeddings_local (imdbId, embedding) VALUES (?, ?)",
                (imdb_id, embedding_bytes)
            )
        
        conn.commit()
        print(f"  Processed {min(i+batch_size, len(texts))}/{len(texts)} movies")
    
    print("\n✓ All embeddings generated!\n")

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
            d.overview
        FROM movie_embeddings_local e
        JOIN titles t ON e.imdbId = t.imdbId
        LEFT JOIN tmdb_details d ON e.imdbId = d.imdbId
        WHERE t.rating >= 5.0
    """)
    
    results = []
    for row in cursor.fetchall():
        imdb_id, embedding_bytes, title, year, rating, votes, genres, overview = row
        
        # Convert bytes back to numpy array
        movie_embedding = np.frombuffer(embedding_bytes, dtype=np.float32)
        
        # Cosine similarity
        similarity = np.dot(query_embedding, movie_embedding) / (
            np.linalg.norm(query_embedding) * np.linalg.norm(movie_embedding)
        )
        
        results.append({
            'imdbId': imdb_id,
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
        print("  Setup:  python3 local-semantic-search.py setup")
        print("  Search: python3 local-semantic-search.py search 'woman spy thriller'")
        print("  JSON:   python3 local-semantic-search.py json 'woman spy thriller'")
        return
    
    command = sys.argv[1]
    
    if command == "setup":
        setup_embeddings_table()
        generate_embeddings(limit=10000)
        
    elif command == "search":
        query = sys.argv[2] if len(sys.argv) > 2 else "woman spy thriller"
        results = search_similar(query, limit=10)
        
        print(f"Top 10 results:\n")
        for i, movie in enumerate(results, 1):
            print(f"{i}. {movie['title']} ({movie['year']})")
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
