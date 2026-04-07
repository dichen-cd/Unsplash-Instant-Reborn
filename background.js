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

// Global in-memory cache for the photos
let activePhoto = {
    photo: null, highResUrl: null, optimizedThumbUrl: null, thumbDataUri: null,
    is_used: false, cached_time: 0, error: null
};

let nextPhoto = null; // The pre-fetched photo waiting in the wings

// Save photo data to storage
async function savePhotoData() {
    try {
        // Save Active photo
        await chrome.storage.session.set({ 'activePhoto': activePhoto });
        await chrome.storage.local.set({ 'activeMetadata': { ...activePhoto, thumbDataUri: null } });
        
        // Save Next photo
        if (nextPhoto) {
            await chrome.storage.session.set({ 'nextPhoto': nextPhoto });
            await chrome.storage.local.set({ 'nextMetadata': { ...nextPhoto, thumbDataUri: null } });
        }
    } catch (e) {
        console.error("Error saving photo data:", e);
    }
}

// Load photo metadata
async function loadPhotoMetadata() {
    try {
        const session = await chrome.storage.session.get(['activePhoto', 'nextPhoto']);
        if (session.activePhoto) activePhoto = session.activePhoto;
        if (session.nextPhoto) nextPhoto = session.nextPhoto;

        const local = await chrome.storage.local.get(['activeMetadata', 'nextMetadata']);
        if (!activePhoto.photo && local.activeMetadata) activePhoto = local.activeMetadata;
        if (!nextPhoto && local.nextMetadata) nextPhoto = local.nextMetadata;
        
        return !!activePhoto.photo;
    } catch (e) {
        return false;
    }
}

// The core fetcher (now returns a photo object instead of modifying global state)
async function performFetch() {
    try {
        const { unsplashApiKey, topics = 'EDITOR_CHOICE', photoOrientation = 'landscape' } = await chrome.storage.sync.get(['unsplashApiKey', 'topics', 'photoOrientation']);
        if (!unsplashApiKey) return { error: "API Key not set." };

        const dims = await chrome.storage.local.get(['screenWidth', 'devicePixelRatio']);
        const width = dims.screenWidth || 1920;
        const dpr = dims.devicePixelRatio || 1;
        const optimizedWidth = Math.min(Math.round(width * dpr * 1.1), 3840);

        let topicsList = topics.split(',').filter(t => t);
        const randomTopic = topicsList[Math.floor(Math.random() * topicsList.length)];
        let apiUrl = `https://api.unsplash.com/photos/random?orientation=${photoOrientation}`;
        if (randomTopic === 'EDITOR_CHOICE') apiUrl += `&collections=317099`;
        else apiUrl += `&topics=${encodeURIComponent(randomTopic)}`;

        let photoMetadata = null;
        let attempts = 0;
        while (attempts < 3) {
            attempts++;
            const apiResponse = await fetchWithRetry(apiUrl, {
                headers: { 'Authorization': `Client-ID ${unsplashApiKey}`, 'Accept-Version': 'v1' }
            });
            if (!apiResponse.ok) return { error: `API Error: ${apiResponse.status}` };
            photoMetadata = await apiResponse.json();
            const exif = photoMetadata.exif;
            if (exif && (exif.make || exif.model) && exif.exposure_time && exif.aperture && exif.iso) break;
        }
        
        const highResUrl = `${photoMetadata.urls.raw}&auto=format&q=80`;
        const optimizedThumbUrl = `${photoMetadata.urls.raw}&w=${optimizedWidth}&auto=format&fit=max&q=70`;

        let thumbDataUri = null;
        try {
            const thumbResponse = await fetchWithRetry(optimizedThumbUrl);
            if (thumbResponse.ok) thumbDataUri = await blobToDataUri(await thumbResponse.blob());
        } catch (e) { }

        if (highResUrl) fetchWithRetry(highResUrl).catch(() => {});

        return {
            photo: photoMetadata,
            highResUrl: highResUrl,
            optimizedThumbUrl: optimizedThumbUrl,
            thumbDataUri: thumbDataUri,
            is_used: false,
            cached_time: 0,
            error: null
        };
    } catch (error) {
        return { error: error.message };
    }
}

// Background task to ensure we have a 'Next' photo ready
async function preFetchNextPhoto() {
    if (isFetchingPhoto || nextPhoto) return;
    isFetchingPhoto = true;
    try {
        const newPhoto = await performFetch();
        if (!newPhoto.error) {
            nextPhoto = newPhoto;
            await savePhotoData();
        }
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
    if (alarm.name === CACHE_REFRESH_ALARM) preFetchNextPhoto();
});

chrome.runtime.onStartup.addListener(async () => {
    await loadPhotoMetadata();
    await scheduleCacheRefreshAlarm();
    if (!activePhoto.photo) {
        activePhoto = await performFetch();
        await savePhotoData();
    }
    preFetchNextPhoto();
});

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install' || details.reason === 'update') {
        chrome.runtime.openOptionsPage();
    }
    activePhoto = await performFetch();
    await savePhotoData();
    await scheduleCacheRefreshAlarm();
    preFetchNextPhoto();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getUnsplashPhoto") {
        (async () => {
            if (!activePhoto.photo) await loadPhotoMetadata();
            
            const preferences = await chrome.storage.sync.get('cacheDuration');
            const cacheDurationMs = (preferences.cacheDuration || 5) * 60 * 1000;
            const now = Date.now();
            const photoIsStale = activePhoto.is_used && (activePhoto.cached_time + cacheDurationMs) < now;

            // If stale and we have a fresh one ready, swap it in!
            if (photoIsStale && nextPhoto) {
                activePhoto = nextPhoto;
                nextPhoto = null;
            }

            // If we still have no photo (e.g. first run), fetch one immediately
            if (!activePhoto.photo) {
                activePhoto = await performFetch();
                await savePhotoData();
            }

            sendResponse(activePhoto);

            // Mark as used and start timer if this is the first display
            if (!activePhoto.is_used) {
                activePhoto.is_used = true;
                activePhoto.cached_time = Date.now();
                await savePhotoData();
                
                // Now that we're showing a new photo, ensure the 'Next' slot is filled
                setTimeout(() => preFetchNextPhoto(), 2000);
            }
        })();
        return true;
    }

    if (request.action === "forceRefreshPhoto") {
        (async () => {
            // Optimization: If we already have a 'Next' photo ready, use it!
            if (nextPhoto) {
                activePhoto = nextPhoto;
                nextPhoto = null;
            } else {
                // Otherwise, fetch a brand new one
                activePhoto = await performFetch();
            }

            activePhoto.is_used = true;
            activePhoto.cached_time = Date.now();
            await savePhotoData();
            sendResponse(activePhoto);

            // Ensure the 'Next' slot is filled after the swap/fetch
            setTimeout(() => preFetchNextPhoto(), 2000);
        })();
        return true;
    }
});
