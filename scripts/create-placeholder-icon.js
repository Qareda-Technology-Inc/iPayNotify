// Simple script to create a basic placeholder icon
// This creates a simple SVG that can be converted to PNG
// Run: node scripts/create-placeholder-icon.js

const fs = require('fs');
const path = require('path');

const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="192" height="192" viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">
  <rect width="192" height="192" rx="20" fill="#2563eb"/>
  <g fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round">
    <path d="M 96 60 A 40 40 0 0 1 136 100"/>
    <path d="M 96 50 A 50 50 0 0 1 146 100"/>
    <path d="M 96 40 A 60 60 0 0 1 156 100"/>
  </g>
  <circle cx="96" cy="100" r="12" fill="#ffffff"/>
  <line x1="96" y1="30" x2="96" y2="40" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/>
</svg>`;

const publicDir = path.join(__dirname, '..', 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Save as SVG (can be converted to PNG)
fs.writeFileSync(path.join(publicDir, 'icon-placeholder.svg'), svgContent);
console.log('✅ Placeholder icon created: public/icon-placeholder.svg');
console.log('\n📝 Next steps:');
console.log('1. Open public/generate-icons.html in your browser');
console.log('2. Click "Generate All Icons"');
console.log('3. Move all generated PNG files to the public folder');
console.log('\nOr convert icon-placeholder.svg to PNG using an online tool or image editor.');

