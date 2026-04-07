// background.js

// --- New: Flag to prevent duplicate photo fetch processes ---
let isFetchingPhoto = false;

// --- New: Helper function for fetch with retry on network errors ---
async function fetchWithRetry(url, options, retries = 3, retryDelay = 1000) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            return response; 
        } catch (error) {
            lastError = error;
            console.warn(`Fetch attempt ${i + 1} of ${retries} for "${url}" failed: ${error.message}`);
            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }
    throw lastError;
}

// Global in-memory cache for the last fetched photo data
let currentCachedPhotoMetadata = {
    photo: null,
    highResUrl: null,
    optimizedThumbUrl: null,
    thumbDataUri: null,
    is_used: false,
    cached_time: 0,
    error: null
};

// --- Convert Blob to Data URI for instant loading ---
async function blobToDataUri(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.byteLength; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return `data:${blob.type};base64,${btoa(binary)}`;
}

// Save photo data to SESSION storage (RAM) for speed, and LOCAL for persistence
async function savePhotoData() {
    try {
        // High-speed session storage for the heavy Data URI
        await chrome.storage.session.set({ 'cachedUnsplashPhoto': currentCachedPhotoMetadata });
        // Local storage for metadata persistence (without the heavy Data URI to save space)
        const persistentMetadata = { ...currentCachedPhotoMetadata, thumbDataUri: null };
        await chrome.storage.local.set({ 'cachedUnsplashMetadata': persistentMetadata });
    } catch (e) {
        console.error("Error saving photo data:", e);
    }
}

// Load photo metadata
async function loadPhotoMetadata() {
    try {
        const sessionResult = await chrome.storage.session.get('cachedUnsplashPhoto');
        if (sessionResult.cachedUnsplashPhoto && sessionResult.cachedUnsplashPhoto.photo) {
            currentCachedPhotoMetadata = sessionResult.cachedUnsplashPhoto;
            return true;
        }
        const localResult = await chrome.storage.local.get('cachedUnsplashMetadata');
        if (localResult.cachedUnsplashMetadata && localResult.cachedUnsplashMetadata.photo) {
            currentCachedPhotoMetadata = localResult.cachedUnsplashMetadata;
            return true;
        }
        return false;
    } catch (e) {
        console.error("Error loading photo metadata:", e);
        return false;
    }
}

// Fetch metadata and pre-load images
async function fetchAndCacheNewPhoto(forceFetch = false) {
    if (isFetchingPhoto) return;
    isFetchingPhoto = true;

    try {
        if (!forceFetch) {
            const preferences = await chrome.storage.sync.get('cacheDuration');
            const cacheDurationMs = (preferences.cacheDuration || 5) * 60 * 1000;
            const now = Date.now();
            const photoIsStale = (currentCachedPhotoMetadata.cached_time + cacheDurationMs) < now;

            if (!currentCachedPhotoMetadata.is_used || !photoIsStale) {
                return;
            }
        }

        const { unsplashApiKey, topics, photoOrientation = 'landscape' } = await chrome.storage.sync.get(['unsplashApiKey', 'topics', 'photoOrientation']);
        if (!unsplashApiKey) {
            currentCachedPhotoMetadata.error = "API Key not set.";
            await savePhotoData();
            return;
        }

        // Get screen dimensions saved by newtab.js
        const dims = await chrome.storage.local.get(['screenWidth', 'devicePixelRatio']);
        const width = dims.screenWidth || 1920;
        const dpr = dims.devicePixelRatio || 1;
        const optimizedWidth = Math.min(Math.round(width * dpr * 1.1), 3840);

        let topicsList = (topics || '6sMVjTLSkeQ,Fzo3zuOHN6w,bo8jQKTaE0Y').split(',').filter(t => t);
        const randomTopic = topicsList[Math.floor(Math.random() * topicsList.length)];
        const apiUrl = `https://api.unsplash.com/photos/random?topics=${encodeURIComponent(randomTopic)}&orientation=${photoOrientation}`;

        const apiResponse = await fetchWithRetry(apiUrl, {
            headers: { 'Authorization': `Client-ID ${unsplashApiKey}`, 'Accept-Version': 'v1' }
        });

        if (!apiResponse.ok) {
             currentCachedPhotoMetadata.error = `API Error: ${apiResponse.status}`;
             await savePhotoData();
             return;
        }

        const photoMetadata = await apiResponse.json();
        
        // Strategy: 
        // 1. highResUrl = original raw/full for progressive swap
        // 2. optimizedThumbUrl = q=70, auto=format, tailored width for instant paint
        const highResUrl = `${photoMetadata.urls.raw}&auto=format&q=80`;
        const optimizedThumbUrl = `${photoMetadata.urls.raw}&w=${optimizedWidth}&auto=format&fit=max&q=70`;

        let thumbDataUri = null;
        try {
            const thumbResponse = await fetchWithRetry(optimizedThumbUrl);
            if (thumbResponse.ok) {
                const blob = await thumbResponse.blob();
                thumbDataUri = await blobToDataUri(blob);
            }
        } catch (e) { console.warn("Optimized thumb download failed", e); }

        // Pre-warm the browser cache for the high-res image
        if (highResUrl) {
            fetchWithRetry(highResUrl).catch(() => {});
        }

        currentCachedPhotoMetadata = {
            photo: photoMetadata,
            highResUrl: highResUrl,
            optimizedThumbUrl: optimizedThumbUrl,
            thumbDataUri: thumbDataUri,
            is_used: false,
            cached_time: Date.now(),
            error: null
        };

        await savePhotoData();
    } catch (error) {
        console.error("Fetch process failed:", error);
    } finally {
        isFetchingPhoto = false;
    }
}

const CACHE_REFRESH_ALARM = 'cacheRefreshAlarm';
async function scheduleCacheRefreshAlarm() {
    const { cacheDuration = 5 } = await chrome.storage.sync.get('cacheDuration');
    chrome.alarms.clear(CACHE_REFRESH_ALARM);
    chrome.alarms.create(CACHE_REFRESH_ALARM, { periodInMinutes: cacheDuration });
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CACHE_REFRESH_ALARM) fetchAndCacheNewPhoto(false);
});

chrome.runtime.onStartup.addListener(async () => {
    await loadPhotoMetadata();
    await scheduleCacheRefreshAlarm();
    if (!currentCachedPhotoMetadata.photo) fetchAndCacheNewPhoto(true);
});

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install' || details.reason === 'update') {
        chrome.runtime.openOptionsPage();
    }
    await fetchAndCacheNewPhoto(true);
    await scheduleCacheRefreshAlarm();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getUnsplashPhoto") {
        (async () => {
            if (!currentCachedPhotoMetadata.photo) await loadPhotoMetadata();
            if (!currentCachedPhotoMetadata.photo) await fetchAndCacheNewPhoto(true);

            sendResponse(currentCachedPhotoMetadata);

            if (!currentCachedPhotoMetadata.is_used) {
                currentCachedPhotoMetadata.cached_time = Date.now();
                currentCachedPhotoMetadata.is_used = true;
                await savePhotoData();
                fetchAndCacheNewPhoto(false);
            }
        })();
        return true;
    }
});
