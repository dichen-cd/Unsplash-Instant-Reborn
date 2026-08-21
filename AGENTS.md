# AGENTS.md

## Project

Chrome Manifest V3 new-tab extension that shows random Unsplash photos. No build step, no bundler, no package manager — plain JS/CSS/HTML files loaded directly.

## Architecture

- `manifest.json` — MV3 manifest. Service worker is `background.js` (type: module, but only opens options page on install).
- `newtab.html` / `newtab.js` / `newtab.css` — the actual new-tab page. All photo fetch, caching, prefetching, history, and UI logic lives in `newtab.js`.
- `options.html` / `options.js` — settings page for API key, cache duration, image resolution, topic selection.
- `progressive-image.css` — supplies the `.progressive img.preview` blur and the `progressiveReveal` cross-fade keyframes. `newtab.js` applies both itself; the companion `progressive-image.js` has been **deleted**, see "Image ladder" below.
- `icons/` — extension icons only.

## Key quirks

- **Storage split**: Settings go in `chrome.storage.sync` (cross-device). Photo cache, history, prefetch queue, and active photo metadata go in `chrome.storage.local`. Session-only prefetch data uses `chrome.storage.session`.
- **Batch fetching**: `fetchCandidates()` issues a single `/photos/random?count=12` request and ranks the results locally. Only `api.unsplash.com` JSON counts against the rate limit — image files from `images.unsplash.com` are free — so many candidates cost the same one unit as one. **No pixels are downloaded during ranking**; only the chosen photo's image is fetched.
- **Quality scoring**: `scoreCandidate()` ranks on resolution vs. the target width (quadratic penalty below it), aspect-ratio fit to the viewport, and EXIF completeness. This replaced an older loop that spent up to 3 API calls retrying for complete EXIF.
- **Prefetch pipeline**: New-tab open never waits on the network. `resolvePhoto()` drains the session queue first; the head entry usually already has a decoded `thumbDataUri`. 2 seconds after paint, `prefetchNextPhoto()` refills the queue when it drops below `QUEUE_LOW_WATER` (3) and warms only the *next* entry's pixels. Everything else stays metadata-only.
- **Image ladder**: Three width-capped tiers — a 32px placeholder, a `q=60` preview, and a `q=85` final — all built with `w` + `fit=max` + `auto=format`. Never request `urls.raw` without a `w` param; that pulls the full master (~2.3 MB vs ~340 KB) and Unsplash advises against it. The `ixid` param in `urls.raw` must be preserved for API-guideline compliance.
- **`displayPhoto()` climbs the ladder itself, and must keep doing so.** The old `progressive-image.js` helper could not do it: it scanned a *live* `getElementsByClassName('progressive replace')` collection and removed the `replace` class as its very first statement, *before* checking whether a URL was present. Because these URLs only exist after an async storage read, its window-load scan always ran too early, evicted the anchor from the collection, and no later mutation could re-add it — so the high-resolution tier silently never loaded. That script is deleted and the anchor no longer carries `class="replace"` or `data-sizes`. Do not reintroduce either.
- **Cross-fade**: `swapIn()` reproduces the old helper's visuals using the surviving CSS — each tier is decoded in an off-document `Image`, then inserted as a new `<img class="reveal">` to run the `progressiveReveal` animation, with the outgoing image removed on `animationend`. It carries over `id`, `className`, and `alt`, so `#background-photo` keeps resolving and no elements accumulate. `bgEl` is therefore a `let`, reassigned on every swap. The `preview` blur is applied only for the 32px placeholder and dropped once a sized tier lands. A `console.debug` reports each tier's `naturalWidth`, which is the direct way to confirm the `q=85` tier actually landed.
- **Resolution setting**: `imageQuality` in `chrome.storage.sync` — `balanced` (DPR capped at 1.5, default), `sharp` (full DPR, ≤3840), `maximum` (full DPR, ≤5120), or `custom` (uses `customWidth`, clamped 640–7680). Resolved by `resolveTargetWidth()`.
- **Caching**: `cacheDuration` is in minutes, stored in `chrome.storage.sync`. Default is 5 minutes. The window starts when a photo is *displayed*, not when it was fetched.
- **Topics**: Comma-separated string of Unsplash topic/collection IDs in `chrome.storage.sync`. `EDITORIAL` blends two official Unsplash-curated pools, alternating randomly per fetch because `/photos/random` cannot combine `collections` and `topics` in one request:
  - collection **317099** — "Unsplash Editorial", owned by the official `unsplash` account. This is the same id Unsplash hardcodes as `editorialCollectionId` in their official [iOS](https://github.com/unsplash/unsplash-photopicker-ios) and [Android](https://github.com/unsplash/unsplash-photopicker-android) photo-picker SDKs, which is where the value originally comes from.
  - topic **`bo8jQKTaE0Y`** — the official "Wallpapers" topic, curated for screen-sized backgrounds.
  - The legacy value `EDITOR_CHOICE` is still honoured on read in both `newtab.js` and `options.js` so existing synced settings keep working.
- **Inert background**: `#photo-anchor` has `pointer-events: none` in CSS and carries the image URL on `data-href` (not `href`), so clicking the background does nothing by design. The camera button in the top-left (`#unsplash-logo-link`) is what opens the photo on Unsplash.
- **No `content_filter`**: left at the API default of `low`, which is a deliberate choice.

## Relevant API constraints

- `/photos/random` supports `collections`, `topics`, `username`, `query`, `orientation`, `content_filter`, `count` (max 30). It has **no** `order_by`, and `collections`/`topics` cannot be combined with `query`.
- With `count` present the response is **always an array**, even for `count=1`.
- `GET /photos` is the true live Editorial feed but lost `order_by` in Sept 2024 and supports no `orientation` or randomization, so it is a poor fit here.
- `GET /collections/featured`, `/photos/curated`, and the curated-collection endpoints were all removed (2019–2021). `source.unsplash.com` was sunset in 2024.

## Testing / Linting

None configured. No test suite, no linter, no type checker, no build script.

## Loading the extension

Load unpacked from the project root in `chrome://extensions` (developer mode). Reload the extension or open a new tab to test changes. After changing settings, reload open tabs or restart Chrome.
