# AGENTS.md

## Project

Chrome Manifest V3 new-tab extension that shows random Unsplash photos. No build step, no bundler, no package manager — plain JS/CSS/HTML files loaded directly.

## Architecture

- `manifest.json` — MV3 manifest. Service worker is `background.js` (type: module, but only opens options page on install).
- `newtab.html` / `newtab.js` / `newtab.css` — the actual new-tab page. All photo fetch, caching, prefetching, history, and UI logic lives in `newtab.js`.
- `options.html` / `options.js` — settings page for API key, cache duration, topic selection.
- `progressive-image.js` / `progressive-image.css` — progressive image loading helper. Loads low-res first, then swaps in high-res on window load via the anchor's `href`.
- `icons/` — extension icons only.

## Key quirks

- **Storage split**: Settings go in `chrome.storage.sync` (cross-device). Photo cache, history, prefetch queue, and active photo metadata go in `chrome.storage.local`. Session-only prefetch data uses `chrome.storage.session`.
- **Prefetch pipeline**: After displaying a photo, a 2-second delay triggers prefetching the next photo into the session prefetch queue. On next new-tab open, the prefetch queue is drained first, avoiding a cold-fetch.
- **EXIF retry**: `performFetch()` retries up to 3 times to get a photo with complete EXIF data (make/model, exposure, aperture, ISO).
- **Caching**: `cacheDuration` is in minutes, stored in `chrome.storage.sync`. Default is 5 minutes.
- **Topics**: Comma-separated string of Unsplash topic/collection IDs in `chrome.storage.sync`. `EDITOR_CHOICE` maps to Unsplash collection 317099.

## Testing / Linting

None configured. No test suite, no linter, no type checker, no build script.

## Loading the extension

Load unpacked from the project root in `chrome://extensions` (developer mode). Reload the extension or open a new tab to test changes. After changing settings, reload open tabs or restart Chrome.
