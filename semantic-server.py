#!/usr/bin/env python3
"""
Persistent semantic search server
Keeps the AI model loaded in memory for fast searches
Reads queries from stdin, outputs JSON to stdout
"""

import sys
import json
import sqlite3
import numpy as np
from sentence_transformers import SentenceTransformer

# Load model once at startup
print("Loading AI model...", file=sys.stderr, flush=True)
model = SentenceTransformer('all-MiniLM-L6-v2')
print("✓ Model loaded and ready!", file=sys.stderr, flush=True)

# Connect to database
db_path = "/home/openclaw/imdb-temp/movies.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

def search_similar(query, limit=100):
    """Search for movies similar to the query"""
    # Generate query embedding (fast since model is pre-loaded)
    query_embedding = model.encode(query)
    
    # Get all embeddings from database
    cursor.execute('''
        SELECT e.imdbId, e.embedding, t.title, t.year, t.rating, t.votes, t.genres, d.overview
        FROM movie_embeddings_local e
        JOIN titles t ON t.imdbId = e.imdbId
        LEFT JOIN tmdb_details d ON d.imdbId = e.imdbId
    ''')
    
    results = []
    for row in cursor.fetchall():
        imdbId, embedding_blob, title, year, rating, votes, genres, overview = row
        
        # Convert BLOB to numpy array
        stored_embedding = np.frombuffer(embedding_blob, dtype=np.float32)
        
        # Calculate cosine similarity
        similarity = np.dot(query_embedding, stored_embedding) / (
            np.linalg.norm(query_embedding) * np.linalg.norm(stored_embedding)
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

# Signal ready
print("READY", file=sys.stderr, flush=True)
sys.stderr.flush()

# Read queries from stdin
for line in sys.stdin:
    try:
        query = line.strip()
        if not query:
            continue
        
        results = search_similar(query, limit=100)
        print(json.dumps(results), flush=True)
    except Exception as e:
        error_response = {"error": str(e)}
        print(json.dumps(error_response), flush=True)

conn.close()
