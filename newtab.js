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

const DEFAULTS = {
    topics: 'EDITOR_CHOICE',
    photoOrientation: 'landscape',
    cacheDuration: 5 // minutes
};

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
async function performFetch() {
    try {
        const { unsplashApiKey, topics = DEFAULTS.topics, photoOrientation = DEFAULTS.photoOrientation } = await chrome.storage.sync.get(['unsplashApiKey', 'topics', 'photoOrientation']);
        if (!unsplashApiKey) return { error: "API Key not set." };

        const width = window.screen.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 1.3);
        const optimizedWidth = Math.min(Math.round(width * dpr * 1.1), 3840);

        let topicsList = topics.split(',').filter(t => t);
        const randomTopic = topicsList[Math.floor(Math.random() * topicsList.length)];
        let apiUrl = `${API_URL}/photos/random?orientation=${photoOrientation}`;
        if (randomTopic === 'EDITOR_CHOICE') apiUrl += `&collections=317099`;
        else apiUrl += `&topics=${encodeURIComponent(randomTopic)}`;

        let photoMetadata = null;
        let attempts = 0;
        // Retry up to 3 times for complete EXIF data
        while (attempts < 3) {
            attempts++;
            const apiResponse = await fetchWithRetry(apiUrl, {
                headers: { 'Authorization': `Client-ID ${unsplashApiKey}`, 'Accept-Version': 'v1' }
            });
            if (!apiResponse.ok) return { error: `API Error: ${apiResponse.status}` };
            photoMetadata = await apiResponse.json();
            
            const exif = photoMetadata.exif || {};
            // Check for key EXIF properties
            if ((exif.make || exif.model) && exif.exposure_time && exif.aperture && exif.iso) {
                break;
            }
        }

        const highResUrl = `${photoMetadata.urls.raw}&auto=format&q=80`;
        const optimizedThumbUrl = `${photoMetadata.urls.raw}&w=${optimizedWidth}&auto=format&fit=max&q=60`;

        return {
            photo: photoMetadata,
            highResUrl: highResUrl,
            optimizedThumbUrl: optimizedThumbUrl,
            thumbDataUri: null,
            timestamp: Date.now()
        };
    } catch (error) {
        return { error: error.message };
    }
}

async function prefetchNextPhoto() {
    try {
        const queue = await storageGet(STORAGE_KEYS.PREFETCH, chrome.storage.session) || [];
        if (queue.length >= 1) return;

        const data = await performFetch();
        if (data.error) return;

        // Use fetchWithRetry for the image blob as well
        const res = await fetchWithRetry(data.optimizedThumbUrl);
        if (res.ok) {
            data.thumbDataUri = await blobToDataUri(await res.blob());
        }

        await storageSet(STORAGE_KEYS.PREFETCH, [...queue, data], chrome.storage.session);
    } catch (e) {
        console.error("Prefetch failed:", e);
    }
}

async function resolvePhoto() {
    const { cacheDuration = DEFAULTS.cacheDuration } = await chrome.storage.sync.get('cacheDuration');
    const cacheDurationMs = cacheDuration * 60 * 1000;

    // 1. Check current active photo in session
    let active = await storageGet('activePhoto', chrome.storage.session);
    if (active && (Date.now() - active.timestamp) < cacheDurationMs) {
        return active;
    }

    // 2. Check prefetch queue
    const queue = await storageGet(STORAGE_KEYS.PREFETCH, chrome.storage.session) || [];
    if (queue.length > 0) {
        const [next, ...rest] = queue;
        await storageSet(STORAGE_KEYS.PREFETCH, rest, chrome.storage.session);
        await storageSet('activePhoto', next, chrome.storage.session);
        await storageSet(STORAGE_KEYS.ACTIVE, { ...next, thumbDataUri: null }); // Persist metadata only
        return next;
    }

    // 3. Fallback to local persistent metadata
    const persistent = await storageGet(STORAGE_KEYS.ACTIVE);
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
    const bgEl = document.getElementById('background-photo');
    const photoAnchor = document.getElementById('photo-anchor');
    const topSection = document.getElementById('top-section');
    const bottomSection = document.getElementById('bottom-section');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingMainText = document.getElementById('loading-main-text');
    const unsplashLogoLink = document.getElementById('unsplash-logo-link');
    
    // EXIF & Info Elements
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
        const { photo, highResUrl, optimizedThumbUrl, thumbDataUri } = data;
        if (!photo) return;

        // Progressive Loading
        bgEl.onload = () => {
            bgEl.style.opacity = '1';
            topSection?.classList.add('loaded');
            bottomSection?.classList.add('loaded');
            hideLoading();
        };

        const displayUrl = thumbDataUri || optimizedThumbUrl || highResUrl;
        bgEl.src = displayUrl;
        photoAnchor.href = highResUrl || optimizedThumbUrl;
        bgEl.alt = `Photo by ${photo.user.name}`;

        if (bgEl.complete) bgEl.onload();

        // Metadata Rendering
        const profileUrl = unsplashUrl(photo.user.links.html);
        const photoPageUrl = unsplashUrl(photo.links.html);

        if (unsplashLogoLink) unsplashLogoLink.href = photoPageUrl;
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
            // Force a brand new fetch
            const fresh = await performFetch();
            if (!fresh.error) {
                // Wipe the prefetch queue and active cache to start fresh
                await storageSet(STORAGE_KEYS.PREFETCH, [], chrome.storage.session);
                await storageSet('activePhoto', fresh, chrome.storage.session);
                await storageSet(STORAGE_KEYS.ACTIVE, fresh);
                
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
});
