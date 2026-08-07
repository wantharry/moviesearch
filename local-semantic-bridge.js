const { spawn } = require("child_process");
const path = require("path");

/**
 * Local semantic search using Python sentence-transformers
 * 100% free, no API costs
 */
class LocalSemanticSearch {
  constructor() {
    this.pythonScript = "/mnt/c/Users/openclaw/projects/ai/apps1/imdb/local-semantic-search.py";
  }

  /**
   * Search for similar movies
   * @param {string} query - Search query (e.g., "woman spy thriller")
   * @param {number} limit - Number of results to return
   * @returns {Promise<Array>} - Array of similar movies
   */
  async search(query, limit = 20) {
    return new Promise((resolve, reject) => {
      const python = spawn("python3", [this.pythonScript, "json", query]);
      
      let stdout = "";
      let stderr = "";
      
      python.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      
      python.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      
      python.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Python script failed: ${stderr}`));
          return;
        }
        
        try {
          const results = JSON.parse(stdout);
          resolve(results.slice(0, limit));
        } catch (e) {
          reject(new Error(`Failed to parse results: ${e.message}`));
        }
      });
    });
  }
}

// Export for use in server.js
module.exports = LocalSemanticSearch;

// Test if run directly
if (require.main === module) {
  (async () => {
    const search = new LocalSemanticSearch();
    const query = process.argv[2] || "woman spy thriller";
    
    console.log(`Searching for: "${query}"\n`);
    
    try {
      const results = await search.search(query, 10);
      
      results.forEach((movie, i) => {
        console.log(`${i + 1}. ${movie.title} (${movie.year})`);
        console.log(`   Rating: ${movie.rating}/10`);
        console.log(`   Similarity: ${(movie.similarity * 100).toFixed(1)}%`);
        console.log(`   ${movie.overview?.substring(0, 120)}...\n`);
      });
    } catch (error) {
      console.error("Search failed:", error.message);
    }
  })();
}
