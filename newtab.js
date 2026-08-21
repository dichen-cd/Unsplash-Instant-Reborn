// newtab.js

/* =====================================================================
   Constants & Configuration
   ===================================================================== */
const API_URL = 'https://api.unsplash.com';
const STORAGE_KEYS = {
    SETTINGS: 'ui_settings',
    CACHE: 'photo_cache',
    HISTORY: 'photo_history',
    PREFETCH: 'photo_prefetch',
    ACTIVE: 'active_photo_metadata' // Persistent fallback for cold starts
};

/* ---------------------------------------------------------------------
   Editorial pool
   ---------------------------------------------------------------------
   317099 is the "Unsplash Editorial" collection, owned by the official
   `unsplash` account. It is the same id Unsplash hardcodes as
   `editorialCollectionId` in their official iOS and Android photo-picker
   SDKs, which is where this value originally comes from.

   `/photos/random` cannot combine `collections` and `topics` in one request,
   so the editorial option picks one of these pools per fetch. The Wallpapers
   topic is curated by Unsplash specifically for screen-sized backgrounds.
--------------------------------------------------------------------- */
const EDITORIAL_ID = 'EDITORIAL';
const LEGACY_EDITORIAL_ID = 'EDITOR_CHOICE'; // pre-rename value, still in synced settings
const EDITORIAL_COLLECTION = '317099';
const WALLPAPERS_TOPIC = 'bo8jQKTaE0Y';

const DEFAULTS = {
    topics: EDITORIAL_ID,
    photoOrientation: 'landscape',
    cacheDuration: 5, // minutes
    imageQuality: 'balanced',
    customWidth: 2560
};

/* Batch fetching.
   `/photos/random` returns up to 30 photos per request and, crucially, only
   the JSON counts against the rate limit - image files served from
   images.unsplash.com are free. So one request buys many ranked candidates
   for the price of one rate-limit unit. Pixels are only ever downloaded for
   a photo we are about to show. */
const BATCH_COUNT = 12;
const QUEUE_LOW_WATER = 3; // refill the queue once it drops below this

const QUALITY_PRESETS = {
    balanced: { maxDpr: 1.5, maxWidth: 3840 },
    sharp: { maxDpr: Infinity, maxWidth: 3840 },
    maximum: { maxDpr: Infinity, maxWidth: 5120 }
};

const PREVIEW_QUALITY = 60; // sized first paint
const FINAL_QUALITY = 85;   // sized full-quality swap
const PLACEHOLDER_WIDTH = 32;

let cachedApiKey = null;

/* =====================================================================
   Storage Helpers
   ===================================================================== */
function storageGet(key, store = chrome.storage.local) {
    return new Promise(resolve => {
        store.get(key, data => resolve(data[key] ?? null));
    });
}

function storageSet(key, value, store = chrome.storage.local) {
    return new Promise(resolve => {
        store.set({ [key]: value }, resolve);
    });
}

/* =====================================================================
   Utility Functions
   ===================================================================== */
async function fetchWithRetry(url, options, retries = 3, retryDelay = 1000) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            return response;
        } catch (error) {
            lastError = error;
            if (i < retries - 1) await new Promise(res => setTimeout(res, retryDelay));
        }
    }
    throw lastError;
}

function blobToDataUri(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = e => reject(e);
        reader.readAsDataURL(blob);
    });
}

function unsplashUrl(url) {
    const u = new URL(url);
    u.searchParams.set('utm_source', 'Unsplash Instant Reborn');
    u.searchParams.set('utm_medium', 'referral');
    return u.toString();
}

/* =====================================================================
   Unsplash API & Photo Logic
   ===================================================================== */
/**
 * Resolve the target pixel width for this display, honouring the user's
 * quality preset. Unsplash never upscales past a photo's native size, so
 * asking for more than the screen needs only costs bandwidth.
 */
function resolveTargetWidth(settings) {
    const preset = QUALITY_PRESETS[settings.imageQuality];
    const screenWidth = window.screen.width || 1920;
    const rawDpr = window.devicePixelRatio || 1;

    if (!preset) {
        // 'custom': an explicit width ceiling, still bounded by real device pixels.
        const custom = Math.min(Math.max(settings.customWidth || DEFAULTS.customWidth, 640), 7680);
        return Math.min(Math.round(screenWidth * rawDpr), custom);
    }

    const dpr = Math.min(rawDpr, preset.maxDpr);
    return Math.min(Math.round(screenWidth * dpr), preset.maxWidth);
}

/**
 * Build the three-tier image ladder for a photo.
 * Every tier is width-capped: requesting `raw` without a `w` param pulls the
 * full master file, which Unsplash explicitly advises against.
 */
function buildImageUrls(photo, targetWidth) {
    const raw = photo.urls.raw;
    const sized = (w, q) => `${raw}&w=${w}&auto=format&fit=max&q=${q}`;
    return {
        placeholderUrl: sized(PLACEHOLDER_WIDTH, 40),
        previewUrl: sized(targetWidth, PREVIEW_QUALITY),
        highResUrl: sized(targetWidth, FINAL_QUALITY)
    };
}

/**
 * Score a candidate on how well it works as a background for this screen.
 * Resolution and aspect fit dominate; EXIF completeness is a smaller bonus
 * because the UI surfaces camera info.
 */
function scoreCandidate(photo, targetWidth, viewportAspect) {
    if (!photo || !photo.urls || !photo.urls.raw || !photo.width || !photo.height) return -Infinity;

    // Resolution: reward covering the target width, with diminishing returns
    // past it. Penalise photos that would need upscaling.
    const coverage = photo.width / targetWidth;
    const resolutionScore = coverage >= 1
        ? 1 + Math.min(coverage - 1, 1) * 0.15
        : coverage * coverage; // quadratic penalty below target

    // Aspect fit: how much cropping to fill the viewport. 1 is a perfect match.
    const photoAspect = photo.width / photo.height;
    const aspectScore = Math.min(photoAspect, viewportAspect) / Math.max(photoAspect, viewportAspect);

    const exif = photo.exif || {};
    const exifFields = [exif.make || exif.model, exif.exposure_time, exif.aperture, exif.iso];
    const exifScore = exifFields.filter(Boolean).length / exifFields.length;

    return resolutionScore * 3 + aspectScore * 2 + exifScore * 0.5;
}

/** Strip a photo record down to the fields the UI actually reads. */
function trimPhoto(photo) {
    return {
        id: photo.id,
        width: photo.width,
        height: photo.height,
        blur_hash: photo.blur_hash,
        color: photo.color,
        urls: { raw: photo.urls.raw, thumb: photo.urls.thumb },
        links: { html: photo.links?.html },
        exif: photo.exif || {},
        user: {
            name: photo.user?.name,
            location: photo.user?.location,
            links: { html: photo.user?.links?.html },
            profile_image: { medium: photo.user?.profile_image?.medium }
        }
    };
}

/**
 * One API request, many ranked candidates.
 * Returns entries sorted best-first. Only metadata is fetched here - no pixels.
 */
async function fetchCandidates() {
    if (!cachedApiKey) {
        const { unsplashApiKey } = await chrome.storage.sync.get('unsplashApiKey');
        cachedApiKey = unsplashApiKey;
    }
    if (!cachedApiKey) return { error: "API Key not set." };

    const settings = await chrome.storage.sync.get([
        'topics', 'photoOrientation', 'imageQuality', 'customWidth'
    ]);
    const topics = settings.topics ?? DEFAULTS.topics;
    const photoOrientation = settings.photoOrientation ?? DEFAULTS.photoOrientation;
    const targetWidth = resolveTargetWidth({
        imageQuality: settings.imageQuality ?? DEFAULTS.imageQuality,
        customWidth: settings.customWidth ?? DEFAULTS.customWidth
    });

    const topicsList = topics.split(',').filter(t => t);
    const chosen = topicsList.length
        ? topicsList[Math.floor(Math.random() * topicsList.length)]
        : DEFAULTS.topics;

    let apiUrl = `${API_URL}/photos/random?orientation=${photoOrientation}&count=${BATCH_COUNT}`;
    if (chosen === EDITORIAL_ID || chosen === LEGACY_EDITORIAL_ID) {
        // Blend the official editorial collection with the Wallpapers topic.
        // These cannot be combined in a single request, so alternate randomly.
        if (Math.random() < 0.5) apiUrl += `&collections=${EDITORIAL_COLLECTION}`;
        else apiUrl += `&topics=${WALLPAPERS_TOPIC}`;
    } else {
        apiUrl += `&topics=${encodeURIComponent(chosen)}`;
    }

    const apiResponse = await fetchWithRetry(apiUrl, {
        headers: { 'Authorization': `Client-ID ${cachedApiKey}`, 'Accept-Version': 'v1' }
    });
    if (!apiResponse.ok) return { error: `API Error: ${apiResponse.status}` };

    // With `count` present the API always returns an array, even for count=1.
    const payload = await apiResponse.json();
    const photos = Array.isArray(payload) ? payload : [payload];

    const viewportAspect = (window.innerWidth || window.screen.width || 1920) /
                           (window.innerHeight || window.screen.height || 1080);

    const ranked = photos
        .filter(p => p && p.urls && p.urls.raw)
        .map(photo => ({ photo, score: scoreCandidate(photo, targetWidth, viewportAspect) }))
        .filter(entry => entry.score > -Infinity)
        .sort((a, b) => b.score - a.score)
        .map(({ photo }) => {
            const trimmed = trimPhoto(photo);
            return {
                photo: trimmed,
                ...buildImageUrls(trimmed, targetWidth),
                targetWidth,
                thumbDataUri: null,
                timestamp: Date.now()
            };
        });

    if (!ranked.length) return { error: 'No usable photos returned.' };
    return { candidates: ranked };
}

/**
 * Fetch a single photo, ready to display. Also banks the runners-up as
 * metadata so later tabs cost no API calls.
 */
async function performFetch() {
    try {
        const { candidates, error } = await fetchCandidates();
        if (error) return { error };

        const [best, ...rest] = candidates;
        if (rest.length) {
            const queue = await storageGet(STORAGE_KEYS.PREFETCH, chrome.storage.session) || [];
            await storageSet(STORAGE_KEYS.PREFETCH, [...queue, ...rest], chrome.storage.session);
        }
        return best;
    } catch (error) {
        return { error: error.message };
    }
}

/**
 * Off-critical-path queue maintenance. Runs after the current photo has
 * painted, so it never delays a new tab.
 *
 * Two jobs:
 *  1. Refill the queue with metadata when it runs low (one API call).
 *  2. Warm the next entry by decoding its preview into a data URI, so the
 *     following tab paints with no network at all.
 */
async function prefetchNextPhoto() {
    try {
        let queue = await storageGet(STORAGE_KEYS.PREFETCH, chrome.storage.session) || [];

        // 1. Top up metadata if we're running dry.
        if (queue.length < QUEUE_LOW_WATER) {
            const { candidates, error } = await fetchCandidates();
            if (!error && candidates) {
                queue = [...queue, ...candidates];
                await storageSet(STORAGE_KEYS.PREFETCH, queue, chrome.storage.session);
            }
        }

        // 2. Warm only the next photo's pixels. The rest stay as metadata.
        const next = queue[0];
        if (next && !next.thumbDataUri) {
            const res = await fetchWithRetry(next.previewUrl);
            if (res.ok) {
                next.thumbDataUri = await blobToDataUri(await res.blob());
                // Re-read before writing: resolvePhoto may have shifted the
                // queue while this download was in flight.
                const current = await storageGet(STORAGE_KEYS.PREFETCH, chrome.storage.session) || [];
                if (current.length && current[0].photo?.id === next.photo?.id) {
                    current[0] = next;
                    await storageSet(STORAGE_KEYS.PREFETCH, current, chrome.storage.session);
                }
            }
        }
    } catch (e) {
        console.error("Prefetch failed:", e);
    }
}

async function resolvePhoto() {
    const { cacheDuration = DEFAULTS.cacheDuration } = await chrome.storage.sync.get('cacheDuration');
    const cacheDurationMs = cacheDuration * 60 * 1000;

    // Read all storage in parallel
    const [active, queue, persistent] = await Promise.all([
        storageGet('activePhoto', chrome.storage.session),
        storageGet(STORAGE_KEYS.PREFETCH, chrome.storage.session),
        storageGet(STORAGE_KEYS.ACTIVE)
    ]);

    // 1. Check current active photo in session
    if (active && (Date.now() - active.timestamp) < cacheDurationMs) {
        return active;
    }

    // 2. Check prefetch queue. This is the fast path: the head entry is
    //    already-ranked metadata, usually with its preview pre-decoded, so it
    //    paints without touching the network.
    const queueItems = queue || [];
    if (queueItems.length > 0) {
        const [next, ...rest] = queueItems;
        next.timestamp = Date.now(); // start the cache window at display time
        await storageSet(STORAGE_KEYS.PREFETCH, rest, chrome.storage.session);
        await storageSet('activePhoto', next, chrome.storage.session);
        await storageSet(STORAGE_KEYS.ACTIVE, { ...next, thumbDataUri: null }); // Persist metadata only
        return next;
    }

    // 3. Fallback to local persistent metadata
    if (persistent && (Date.now() - persistent.timestamp) < cacheDurationMs) {
        return persistent;
    }

    // 4. Cold start fetch
    const fresh = await performFetch();
    if (!fresh.error) {
        await storageSet('activePhoto', fresh, chrome.storage.session);
        await storageSet(STORAGE_KEYS.ACTIVE, fresh);
    }
    return fresh;
}

/* =====================================================================
   UI Rendering & Events
   ===================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
    // DOM Elements
    // Reassigned when a higher tier is cross-faded in as a new <img>.
    let bgEl = document.getElementById('background-photo');
    const photoAnchor = document.getElementById('photo-anchor');
    const topSection = document.getElementById('top-section');
    const bottomSection = document.getElementById('bottom-section');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingMainText = document.getElementById('loading-main-text');
    const unsplashLogoLink = document.getElementById('unsplash-logo-link');
    
    // EXIF & Info Elements
    const photographerProfileLink = document.getElementById('photographer-profile-link');
    const photographerAvatar = document.getElementById('photographer-avatar');
    const photographerName = document.getElementById('photographer-name');
    const photographerNameLink = document.getElementById('photographer-name-link');
    const photographerLocation = document.getElementById('photographer-location');
    const photographerLocationLink = document.getElementById('photographer-location-link');
    const exifItems = {
        camera: document.getElementById('exif-camera'),
        shutter: document.getElementById('exif-shutter'),
        aperture: document.getElementById('exif-aperture'),
        iso: document.getElementById('exif-iso'),
        focal: document.getElementById('exif-focal-length')
    };

    function showLoading(text) {
        if (loadingOverlay) {
            loadingMainText.textContent = text;
            loadingOverlay.classList.remove('hidden');
            loadingOverlay.style.opacity = '1';
        }
    }

    function hideLoading() {
        if (loadingOverlay) {
            loadingOverlay.style.opacity = '0';
            setTimeout(() => loadingOverlay.classList.add('hidden'), 500);
        }
    }

    function displayPhoto(data) {
        const { photo, highResUrl, previewUrl, placeholderUrl, thumbDataUri } = data;
        if (!photo) return;

        // Reveal the UI as soon as anything is on screen.
        const reveal = () => {
            bgEl.style.opacity = '1';
            topSection?.classList.add('loaded');
            bottomSection?.classList.add('loaded');
            hideLoading();
        };
        bgEl.onload = reveal;

        /* Climb the image ladder here rather than delegating to the old
           progressive-image.js helper (now removed). That helper scanned a
           *live* collection of `.progressive.replace` elements and removed the
           `replace` class as the first thing it did - before checking whether a
           URL was present. Since these URLs are only known after an async
           storage read, its window-load scan always ran too early, dropped the
           anchor from the collection, and no later mutation could bring it
           back. The full-resolution tier therefore never loaded.

           We keep its visual behaviour though: each tier is inserted as a new
           <img class="reveal">, which runs the `progressiveReveal` cross-fade
           from progressive-image.css, and the outgoing image is removed on
           `animationend`. That fade is the visible confirmation that a higher
           tier actually landed. */
        const swapIn = (url, { animate = true } = {}) => new Promise(resolve => {
            if (!url) return resolve(false);
            const img = new Image();
            img.onerror = () => resolve(false);
            img.onload = () => {
                const outgoing = photoAnchor.querySelector('img');
                if (!outgoing || !animate) {
                    bgEl.src = url;
                    bgEl.classList.remove('preview');
                    reveal();
                    return resolve(true);
                }

                // Mirror the outgoing element's identity/styling, minus the blur.
                img.id = outgoing.id;
                img.className = outgoing.className;
                img.classList.remove('preview');
                img.classList.add('reveal');
                img.alt = outgoing.alt || '';
                img.style.opacity = '1';

                img.addEventListener('animationend', () => {
                    img.classList.remove('reveal');
                    if (outgoing.parentNode === photoAnchor) photoAnchor.removeChild(outgoing);
                }, { once: true });

                photoAnchor.insertBefore(img, outgoing.nextSibling);
                // The freshly inserted node is now the live background element.
                bgEl = img;
                reveal();
                resolve(true);
                // Verifiable in DevTools: which tier is actually on screen.
                console.debug(`[unsplash] tier loaded: ${img.naturalWidth}px`, url);
            };
            img.src = url;
        });

        // Set alt before the ladder starts, so each cross-faded tier inherits it.
        bgEl.alt = `Photo by ${photo.user.name}`;
        // The image URL lives on data-href, not href, so the anchor never
        // navigates. Clicking the background is intentionally inert; the
        // camera button top-left opens the photo on Unsplash.
        photoAnchor.setAttribute('data-href', highResUrl || previewUrl);

        // First paint: whatever is cheapest. A prefetched data URI is already
        // in memory and already sized, so it needs no blur. The 32px
        // placeholder does - CSS `.preview` blurs it to hide the upscaling.
        // This tier is assigned directly (no cross-fade) since there is
        // nothing on screen yet to fade from.
        const immediate = thumbDataUri || placeholderUrl;
        if (immediate) {
            bgEl.classList.toggle('preview', !thumbDataUri);
            bgEl.src = immediate;
            if (bgEl.complete) reveal();
        }

        // Then decode the sized preview, then the full-quality image. Each tier
        // only replaces the visible image once it has fully decoded, so there is
        // no flash of a half-drawn photo, and each arrives with a visible fade.
        (async () => {
            // A prefetched data URI is already at preview quality; skip re-fetching it.
            if (!thumbDataUri) await swapIn(previewUrl, { animate: !!immediate });
            if (highResUrl && highResUrl !== previewUrl) await swapIn(highResUrl);
        })();

        // Metadata Rendering
        const profileUrl = unsplashUrl(photo.user.links.html);
        const photoPageUrl = unsplashUrl(photo.links.html);

        if (unsplashLogoLink) unsplashLogoLink.href = photoPageUrl;
        if (photographerProfileLink) photographerProfileLink.href = profileUrl;
        if (photographerAvatar) photographerAvatar.src = photo.user.profile_image.medium;
        if (photographerName) photographerName.textContent = photo.user.name;
        if (photographerNameLink) photographerNameLink.href = profileUrl;
        
        if (photo.user.location) {
            photographerLocation.textContent = photo.user.location;
            photographerLocationLink.href = profileUrl;
            photographerLocationLink.style.display = 'block';
        } else {
            photographerLocationLink.style.display = 'none';
        }

        // EXIF
        const exif = photo.exif || {};
        let hasExif = false;
        if (exif.make || exif.model) { exifItems.camera.textContent = `${exif.make || ''} ${exif.model || ''}`.trim(); hasExif = true; }
        if (exif.exposure_time) { exifItems.shutter.textContent = `${exif.exposure_time}s`; hasExif = true; }
        if (exif.aperture) { exifItems.aperture.textContent = `ƒ/${exif.aperture}`; hasExif = true; }
        if (exif.iso) { exifItems.iso.textContent = `ISO ${exif.iso}`; hasExif = true; }
        if (exif.focal_length) { exifItems.focal.textContent = `${exif.focal_length}mm`; hasExif = true; }
        
        const exifContainer = document.getElementById('bottom-right-exif');
        if (exifContainer) {
            exifContainer.classList.toggle('hidden', !hasExif);
            exifContainer.classList.toggle('loaded', hasExif);
        }

        // History
        addToHistory({
            id: photo.id,
            thumb: photo.urls.thumb,
            url: unsplashUrl(photo.links.html),
            photographer: photo.user.name,
            timestamp: Date.now()
        });
    }

    async function addToHistory(item) {
        let history = await storageGet(STORAGE_KEYS.HISTORY) || [];
        history = [item, ...history.filter(p => p.id !== item.id)].slice(0, 20);
        await storageSet(STORAGE_KEYS.HISTORY, history);
    }

    // Initialization
    const data = await resolvePhoto();
    if (data.error) {
        hideLoading();
        alert(data.error);
    } else {
        displayPhoto(data);
        setTimeout(prefetchNextPhoto, 2000);
    }

    // Refresh Logic
    document.getElementById('refresh-button')?.addEventListener('click', async () => {
        showLoading("Fetching new photo...");
        try {
            // Prefer an already-ranked candidate from the queue: it needs no API
            // call and is often pre-decoded, so refresh feels instant. Only fall
            // back to the network when the queue is empty.
            const queue = await storageGet(STORAGE_KEYS.PREFETCH, chrome.storage.session) || [];
            let fresh;
            if (queue.length > 0) {
                const [next, ...rest] = queue;
                await storageSet(STORAGE_KEYS.PREFETCH, rest, chrome.storage.session);
                fresh = next;
            } else {
                fresh = await performFetch();
            }

            if (!fresh.error) {
                fresh.timestamp = Date.now(); // restart the cache window
                await storageSet('activePhoto', fresh, chrome.storage.session);
                await storageSet(STORAGE_KEYS.ACTIVE, { ...fresh, thumbDataUri: null });

                // Refresh the tab to display the new image
                window.location.reload();
            } else {
                alert(fresh.error);
            }
        } catch (e) {
            console.error("Refresh failed:", e);
        } finally {
            hideLoading();
        }
    });

    // History Logic
    const historyButton = document.getElementById('history-button');
    const historyPanel = document.getElementById('history-panel');
    const historyItemsContainer = document.getElementById('history-items');

    historyButton?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const history = await storageGet(STORAGE_KEYS.HISTORY) || [];
        historyItemsContainer.innerHTML = history.length ? history.map(item => `
            <div class="history-item" data-url="${item.url}">
                <img src="${item.thumb}" alt="${item.photographer}">
                <div class="history-info">${item.photographer}</div>
            </div>
        `).join('') : '<p style="grid-column: span 2; text-align: center; opacity: 0.5; padding: 20px;">No history yet.</p>';
        
        historyItemsContainer.querySelectorAll('.history-item').forEach(el => {
            el.addEventListener('click', () => window.open(el.dataset.url, '_blank'));
        });
        historyPanel?.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
        if (!historyPanel?.contains(e.target) && !historyButton?.contains(e.target)) {
            historyPanel?.classList.add('hidden');
        }
    });

    document.getElementById('close-history')?.addEventListener('click', () => {
        historyPanel?.classList.add('hidden');
    });
});
