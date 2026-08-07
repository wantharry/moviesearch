#!/usr/bin/env bash
# Install dependencies for local semantic search in WSL

set -euo pipefail

echo "==> Installing Python dependencies for local semantic search..."
echo ""

# Check if pip is available
if ! command -v pip3 &> /dev/null; then
    echo "Installing pip..."
    sudo apt-get update
    sudo apt-get install -y python3-pip
fi

# Install sentence-transformers
echo "Installing sentence-transformers (this may take a few minutes)..."
pip3 install sentence-transformers numpy

echo ""
echo "✓ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Generate embeddings: python3 /mnt/c/Users/openclaw/projects/ai/apps1/imdb/local-semantic-search.py setup"
echo "2. Test search: python3 /mnt/c/Users/openclaw/projects/ai/apps1/imdb/local-semantic-search.py search 'woman spy thriller'"
