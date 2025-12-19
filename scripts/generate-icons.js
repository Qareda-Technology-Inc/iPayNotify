// Simple icon generator script
// Run with: node scripts/generate-icons.js
// Requires: npm install canvas (or use online tool)

const fs = require('fs');
const path = require('path');

// Create a simple SVG icon that can be converted to PNG
const svgIcon = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" fill="#2563eb"/>
  <g fill="none" stroke="#ffffff" stroke-width="30" stroke-linecap="round">
    <!-- Signal waves -->
    <path d="M 256 200 A 80 80 0 0 1 336 280" stroke-width="25"/>
    <path d="M 256 180 A 100 100 0 0 1 356 280" stroke-width="20"/>
    <path d="M 256 160 A 120 120 0 0 1 376 280" stroke-width="15"/>
  </g>
  <!-- Center dot -->
  <circle cx="256" cy="280" r="30" fill="#ffffff"/>
  <!-- Antenna -->
  <line x1="256" y1="120" x2="256" y2="160" stroke="#ffffff" stroke-width="20" stroke-linecap="round"/>
</svg>`;

// Save SVG icon
const publicDir = path.join(__dirname, '..', 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgIcon);
console.log('SVG icon created at public/icon.svg');

// Instructions for generating PNG icons
console.log('\n📱 To generate PNG icons:');
console.log('1. Open public/icon.svg in an image editor');
console.log('2. Export as PNG in these sizes: 72x72, 96x96, 128x128, 144x144, 152x152, 192x192, 384x384, 512x512');
console.log('3. Save them as icon-{size}x{size}.png in the public folder');
console.log('\nOr use an online tool like: https://realfavicongenerator.net/');
console.log('Or use the HTML generator: Open public/generate-icons.html in a browser');

