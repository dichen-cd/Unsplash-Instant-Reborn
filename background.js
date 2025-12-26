// background.js

// --- REMOVED: Cache Name is no longer needed ---
// const IMAGE_CACHE_NAME = 'unsplash-image-cache-v1';

// --- New: Flag to prevent duplicate photo fetch processes ---
let isFetchingPhoto = false;

// --- New: Helper function for fetch with retry on network errors ---
async function fetchWithRetry(url, options, retries = 3, retryDelay = 1000) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            return response; // Success (even with HTTP error), return response
        } catch (error) {
            lastError = error;
            console.warn(`Fetch attempt ${i + 1} of ${retries} for "${url}" failed: ${error.message}`);
            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }
    console.error(`All ${retries} fetch attempts for "${url}" failed.`);
    throw lastError; // All retries failed, throw the last captured error.
}

// Global in-memory cache for the last fetched photo data
let currentCachedPhotoMetadata = {
    photo: null,
    highResUrl: null,       // URL for the high-resolution image
    lowResUrl: null,        // URL for the low-resolution image
    is_used: false,
    cached_time: 0,
    error: null
};


// --- HELPER FUNCTION TO GET WEBP URL ---
function getWebpUrl(originalUrl) {
    if (!originalUrl) return '';
    return `${originalUrl}&fm=webp`;
}

// --- MODIFIED: Function to save photo data (metadata only) ---
async function savePhotoData() {
    try {
        // Save metadata to chrome.storage.local
        await chrome.storage.local.set({ 'cachedUnsplashPhoto': currentCachedPhotoMetadata });
        console.log("Photo metadata saved to local storage with is_used:", currentCachedPhotoMetadata.is_used, "and time:", currentCachedPhotoMetadata.cached_time);
    } catch (e) {
        console.error("Error saving photo metadata to local storage:", e);
    }
}

// --- MODIFIED: Function to load photo metadata from local storage ---
async function loadPhotoMetadata() {
    try {
        const result = await chrome.storage.local.get('cachedUnsplashPhoto');
        if (result.cachedUnsplashPhoto && result.cachedUnsplashPhoto.photo) {
            currentCachedPhotoMetadata = result.cachedUnsplashPhoto;
            console.log("Photo metadata loaded from local storage with is_used:", currentCachedPhotoMetadata.is_used, "and time:", currentCachedPhotoMetadata.cached_time);
            return true;
        }
        return false;
    } catch (e) {
        console.error("Error loading photo metadata from local storage:", e);
        return false;
    }
}


// --- REWRITTEN: Function to fetch metadata and pre-load images into browser's HTTP cache ---
async function fetchAndCacheNewPhoto(forceFetch = false) {
    if (isFetchingPhoto) {
        console.log("A photo fetch is already in progress. Not initiating duplicate fetch.");
        return;
    }
    isFetchingPhoto = true;

    try {
        if (!forceFetch) {
            const preferences = await chrome.storage.sync.get('cacheDuration');
            const cacheDurationMinutes = preferences.cacheDuration || 5;
            const cacheDurationMs = cacheDurationMinutes * 60 * 1000;
            const now = Date.now();
            const photoIsStale = (currentCachedPhotoMetadata.cached_time + cacheDurationMs) < now;

            if (!currentCachedPhotoMetadata.is_used) {
                console.log("Cached photo is unused. Not fetching new.");
                return;
            }
            if (!photoIsStale) {
                console.log(`Cached photo is used but still fresh. Not fetching new.`);
                return;
            }
            console.log(`Cached photo is used AND stale. Proceeding to fetch new.`);
        }

        const { unsplashApiKey, topics, photoOrientation = 'landscape' } = await chrome.storage.sync.get(['unsplashApiKey', 'topics', 'photoOrientation']);
        let topicsToChooseFrom = (topics || '6sMVjTLSkeQ,Fzo3zuOHN6w,bo8jQKTaE0Y').split(',').filter(t => t);
        if (topicsToChooseFrom.length === 0) {
            topicsToChooseFrom = ['6sMVjTLSkeQ', 'Fzo3zuOHN6w', 'bo8jQKTaE0Y'];
        }
        const randomTopic = topicsToChooseFrom[Math.floor(Math.random() * topicsToChooseFrom.length)];

        if (!unsplashApiKey) {
            console.error("Unsplash API Key not found.");
            currentCachedPhotoMetadata = { photo: null, highResUrl: null, lowResUrl: null, is_used: false, cached_time: 0, error: "API Key not set. Please set it in extension options." };
            await savePhotoData();
            return;
        }

        // const apiUrl = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(randomTopic)}&orientation=${photoOrientation}`;
        const apiUrl = `https://api.unsplash.com/photos/random?topics=${encodeURIComponent(randomTopic)}&orientation=${photoOrientation}`;
        const apiResponse = await fetchWithRetry(apiUrl, {
            headers: { 'Authorization': `Client-ID ${unsplashApiKey}`, 'Accept-Version': 'v1' }
        });

        if (!apiResponse.ok) {
             const errorText = await apiResponse.text();
             let errorMsg = `Failed to pre-fetch: ${apiResponse.status}`;
             if (apiResponse.status === 401) errorMsg = "Invalid Unsplash API Key.";
             if (apiResponse.status === 403) errorMsg = "Unsplash API Rate Limit Exceeded.";
             console.error(`Unsplash API error: ${apiResponse.status} - ${errorText}`);
             currentCachedPhotoMetadata = { photo: null, highResUrl: null, lowResUrl: null, is_used: false, cached_time: 0, error: errorMsg };
             await savePhotoData();
             return;
        }

        const photoMetadata = await apiResponse.json();

        // Determine image URLs for download
        const highResImageUrl = getWebpUrl(photoMetadata.urls.full);
        const lowResImageUrl = getWebpUrl(photoMetadata.urls.thumb);

        // --- FIXED: Pre-load images into the browser's HTTP cache using fetch ---
        // By fetching the images, we ask the browser to cache them based on their
        // HTTP headers. We don't need to read the response body.
        const preloadPromises = [];
        if (lowResImageUrl) {
            await preloadPromises.push(fetchWithRetry(lowResImageUrl).catch(e => console.warn(`Preload failed for ${lowResImageUrl}`, e.message)));
        }
        if (highResImageUrl) {
            // This is a "fire and forget" to warm the browser cache.
            await preloadPromises.push(fetchWithRetry(highResImageUrl).catch(e => console.warn(`Preload failed for ${highResImageUrl}`, e.message)));
        }

        // Update the in-memory metadata cache
        currentCachedPhotoMetadata = {
            photo: photoMetadata,
            highResUrl: highResImageUrl,
            lowResUrl: lowResImageUrl,
            is_used: false,
            cached_time: Date.now(),
            error: null
        };
        console.log("New photo metadata fetched and images are pre-loading into browser cache. Marked as UNUSED.");

        await savePhotoData(); // Save the new metadata to local storage

    } catch (error) {
        console.error("General error during photo pre-fetch process:", error);
        currentCachedPhotoMetadata = { photo: null, highResUrl: null, lowResUrl: null, is_used: false, cached_time: 0, error: `General error: ${error.message}` };
        await savePhotoData();
    } finally {
        isFetchingPhoto = false;
    }
}


// --- CHROME ALARMS FOR PROACTIVE CACHING ---
const CACHE_REFRESH_ALARM = 'cacheRefreshAlarm';
async function scheduleCacheRefreshAlarm() {
    const { cacheDuration = 5 } = await chrome.storage.sync.get('cacheDuration');
    chrome.alarms.clear(CACHE_REFRESH_ALARM);
    chrome.alarms.create(CACHE_REFRESH_ALARM, { periodInMinutes: cacheDuration });
    console.log(`Scheduled cache refresh alarm for every ${cacheDuration} minutes.`);
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CACHE_REFRESH_ALARM) {
        console.log("Cache refresh alarm triggered.");
        fetchAndCacheNewPhoto(false);
    }
});


// Event Listeners for startup and installation
chrome.runtime.onStartup.addListener(async () => {
    console.log("Background script started (onStartup).");
    await loadPhotoMetadata();
    await scheduleCacheRefreshAlarm();
    if (!currentCachedPhotoMetadata.photo || currentCachedPhotoMetadata.error) {
        console.log("No valid photo metadata on startup, forcing a new fetch.");
        fetchAndCacheNewPhoto(true);
    }
});

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log(`Extension installed/updated (reason: ${details.reason}).`);
    // Check if the reason is 'install' (first time installation)
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        console.log("Extension installed for the first time. Opening options page.");
        chrome.runtime.openOptionsPage(); // Open the options page
    }
    await fetchAndCacheNewPhoto(true);
    await scheduleCacheRefreshAlarm();
});


// --- REWRITTEN: Listen for messages from newtab.js and send back metadata only ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getUnsplashPhoto") {
        (async () => {
            if (!currentCachedPhotoMetadata.photo) {
                await loadPhotoMetadata();
            }

            if (!currentCachedPhotoMetadata.photo) {
                 await fetchAndCacheNewPhoto(true);
            }

            // We only need to send the metadata now. The newtab script will use the URLs directly.
            const { photo, highResUrl, lowResUrl, error } = currentCachedPhotoMetadata;

            if (error || !photo) {
                sendResponse({ error: error || "Photo data is not available." });
                return;
            }
            
            // Prepare data to send. No more ArrayBuffers or MIME types.
            const responseData = {
                photo,
                highResUrl,
                lowResUrl,
            };

            sendResponse(responseData);

            // After serving, mark as used and trigger a pre-fetch for the next tab.
            currentCachedPhotoMetadata.is_used = true;
            await savePhotoData();
            console.log("Served photo metadata. Marked as used. Triggering pre-fetch for next tab...");
            
            fetchAndCacheNewPhoto(false);
            scheduleCacheRefreshAlarm();
        })();

        return true;
    }
});
''