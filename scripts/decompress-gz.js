// Decompress .gz files using Node.js zlib
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const files = ['title.basics.tsv.gz', 'title.ratings.tsv.gz'];
const baseDir = path.join(__dirname, '..', 'datadump', 'imdb_official');

files.forEach(file => {
  const inputPath = path.join(baseDir, file);
  const outputPath = inputPath.replace('.gz', '');
  
  if (!fs.existsSync(inputPath)) {
    console.log(`Skipping ${file} - not found`);
    return;
  }
  
  console.log(`Decompressing ${file}...`);
  const gunzip = zlib.createGunzip();
  const input = fs.createReadStream(inputPath);
  const output = fs.createWriteStream(outputPath);
  
  input.pipe(gunzip).pipe(output);
  
  output.on('finish', () => {
    console.log(`✓ ${file} decompressed to ${path.basename(outputPath)}`);
  });
  
  output.on('error', (err) => {
    console.error(`Error decompressing ${file}:`, err);
  });
});
