const fs = require('fs');
const path = require('path');

const root = __dirname;
const distDir = path.join(root, 'dist');

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

const filesToCopy = ['index.html', 'app.js', 'styles.css'];

filesToCopy.forEach((file) => {
  const src = path.join(root, file);
  const dest = path.join(distDir, file);
  fs.copyFileSync(src, dest);
});

const backendUrl = process.env.BACKEND_URL || 'http://localhost:4000';
const envContent = `window.API_BASE_URL = window.API_BASE_URL || ${JSON.stringify(backendUrl)};\n`;
fs.writeFileSync(path.join(distDir, 'env.js'), envContent);

console.log(`Built frontend assets with BACKEND_URL=${backendUrl}`);
