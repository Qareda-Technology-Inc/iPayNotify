# PWA Setup Instructions

This application is configured as a Progressive Web App (PWA) that can be installed on mobile devices.

## Quick Setup

1. **Generate Icons**:
   - Open `public/generate-icons.html` in your browser
   - Click "Generate All Icons"
   - Move all downloaded icons to the `public` folder
   - Ensure filenames are: `icon-72x72.png`, `icon-96x96.png`, etc.

2. **Build and Deploy**:
   ```bash
   npm run build
   ```
   - The service worker and manifest will be included automatically

3. **Test Installation**:
   - Open the app in a mobile browser (Chrome, Safari, etc.)
   - Look for the "Add to Home Screen" prompt
   - Or use the browser menu: "Add to Home Screen" / "Install App"

## Features

- ✅ Offline support (basic caching)
- ✅ Install prompt for mobile devices
- ✅ Standalone app experience
- ✅ Service worker for performance
- ✅ App icons and branding

## Icon Requirements

The app needs icons in these sizes:
- 72x72, 96x96, 128x128, 144x144, 152x152, 192x192, 384x384, 512x512

All icons should be PNG format and placed in the `public` folder.

## Troubleshooting

- **Icons not showing**: Make sure all icon files are in the `public` folder
- **Install prompt not appearing**: 
  - Check that the app is served over HTTPS (required for PWA)
  - Clear browser cache
  - Check browser console for errors
- **Service worker not registering**: 
  - Ensure `sw.js` is in the `public` folder
  - Check browser console for registration errors

## Browser Support

- ✅ Chrome/Edge (Android & Desktop)
- ✅ Safari (iOS 11.3+)
- ✅ Firefox (Android)
- ⚠️ Some features may vary by browser

