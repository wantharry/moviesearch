# Local Semantic Search Setup

## Overview

**100% FREE** semantic search using Python sentence-transformers. No API costs, runs entirely on your machine.

## Features

- ✅ **Zero cost** - No API fees ever
- ✅ **Privacy** - All data stays local
- ✅ **Good quality** - Using `all-MiniLM-L6-v2` model
- ⚡ **Reasonable speed** - ~1-2 seconds per search
- 💾 **Small footprint** - ~90MB model download

## Setup (One-time)

### 1. Install Python Dependencies (in WSL)

```bash
bash /mnt/c/Users/openclaw/projects/ai/apps1/imdb/install-local-semantic.sh
```

This installs:
- `sentence-transformers` - For generating embeddings
- `numpy` - For vector math

### 2. Generate Embeddings

```bash
python3 /mnt/c/Users/openclaw/projects/ai/apps1/imdb/local-semantic-search.py setup
```

**Time**: ~5-10 minutes for 10,000 movies  
**Cost**: $0 (100% free)

The model (`all-MiniLM-L6-v2`) will download automatically (~90MB) on first run.

## Usage

### From Python (Direct)

```bash
# Search
python3 local-semantic-search.py search "woman spy thriller"

# JSON output
python3 local-semantic-search.py json "time travel paradox"
```

### From Node.js

```javascript
const LocalSemanticSearch = require("./local-semantic-bridge");

const search = new LocalSemanticSearch();
const results = await search.search("woman spy thriller", 10);

console.log(results);
// [
//   { title: "Salt", year: 2010, similarity: 0.87, ... },
//   { title: "Atomic Blonde", year: 2017, similarity: 0.84, ... },
//   ...
// ]
```

### Add to Server.js

```javascript
const LocalSemanticSearch = require("./local-semantic-bridge");
const semanticSearch = new LocalSemanticSearch();

// Semantic search endpoint
app.get("/api/semantic-search", async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ error: "Query required" });
    }

    const results = await semanticSearch.search(query, 20);

    res.json({
      query: query,
      results: results.map(r => ({
        imdbId: r.imdbId,
        title: r.title,
        year: r.year,
        rating: r.rating,
        votes: r.votes,
        genres: r.genres?.split(",") || [],
        overview: r.overview,
        matchScore: Math.round(r.similarity * 100)
      }))
    });
  } catch (error) {
    console.error("Semantic search error:", error);
    res.status(500).json({ error: "Search failed" });
  }
});
```

## Performance

| Operation | Time |
|-----------|------|
| Initial model load | 2-3 seconds |
| Generate 10K embeddings | 5-10 minutes |
| Single search | 1-2 seconds |

## Model Info

**all-MiniLM-L6-v2**:
- Size: 90MB
- Embedding dimension: 384 (vs OpenAI's 1536)
- Quality: Very good for semantic search
- Speed: Fast on CPU

## Storage

- Each embedding: 384 floats × 4 bytes = 1.5KB
- 10,000 movies: **15MB** database storage

## Comparison with OpenAI

| Feature | Local (Free) | OpenAI |
|---------|-------------|--------|
| Cost | $0 | $0.02 setup + $0.10/mo |
| Speed | 1-2s | 100ms |
| Privacy | 100% local | Cloud API |
| Quality | Very good | Excellent |
| Setup | 5-10 min | 10-15 min |

## Example Searches

```bash
python3 local-semantic-search.py search "woman spy thriller"
python3 local-semantic-search.py search "time travel paradox"
python3 local-semantic-search.py search "heartwarming friendship"
python3 local-semantic-search.py search "mind bending twist ending"
python3 local-semantic-search.py search "dystopian future"
```

## Troubleshooting

**Python not found:**
```bash
sudo apt-get install python3 python3-pip
```

**Import errors:**
```bash
pip3 install --upgrade sentence-transformers numpy
```

**Slow performance:**
- Model loads on first search (2-3s)
- Subsequent searches are faster
- Consider caching Python process in production
