// background.js

// --- New: Cache Name ---
const IMAGE_CACHE_NAME = 'unsplash-image-cache-v1';

// --- New: Flag to prevent duplicate photo fetch processes ---
let isFetchingPhoto = false;

async function fetchWithRetry(url, retries = 10, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            // We use 'no-cache' to ensure we get a fresh response from the network
            // before we decide to put it into our own Cache API.
            const response = await fetch(url, { cache: 'no-cache' });

            if (response.ok) {
                return response;
            } else {
                if (response.status >= 500 || response.status === 408) {
                    console.warn(`Fetch attempt ${i + 1} for ${url} failed with status ${response.status}. Retrying...`);
                    if (i < retries - 1) {
                        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
                        continue;
                    } else {
                        console.error(`Final fetch attempt for ${url} failed with status ${response.status}.`);
                        return null;
                    }
                } else {
                    console.error(`Fetch for ${url} failed permanently with status ${response.status}. Not retrying.`);
                    return null;
                }
            }
        } catch (error) {
            console.warn(`Network error during fetch attempt ${i + 1} for ${url}:`, error.message);
            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
            } else {
                console.error(`Final fetch attempt for ${url} failed due to network error:`, error.message);
                return null;
            }
        }
    }
    return null;
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

// --- REMOVED: arrayBufferToBase64 and base64ToArrayBuffer functions are no longer needed. ---


// --- MODIFIED: Function to save photo data (metadata to storage, images to Cache API) ---
async function savePhotoData() {
    try {
        // Save metadata to chrome.storage.local
        const dataToSave = { ...currentCachedPhotoMetadata };
        // We don't need to save the actual image data in this object anymore.
        delete dataToSave.highResArrayBuffer;
        delete dataToSave.lowResArrayBuffer;

        await chrome.storage.local.set({ 'cachedUnsplashPhoto': dataToSave });
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

        const { unsplashApiKey, photoQuery = 'nature', photoOrientation = 'landscape' } = await chrome.storage.sync.get(['unsplashApiKey', 'photoQuery', 'photoOrientation']);

        if (!unsplashApiKey) {
            console.error("Unsplash API Key not found.");
            currentCachedPhotoMetadata = { photo: null, highResUrl: null, lowResUrl: null, is_used: false, cached_time: 0, error: "API Key not set. Please set it in extension options." };
            await savePhotoData();
            return;
        }

        const apiUrl = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(photoQuery)}&orientation=${photoOrientation}`;
        const apiResponse = await fetch(apiUrl, {
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

        // Fetch both image responses
        const [highResImageResponse, lowResImageResponse] = await Promise.all([
            fetchWithRetry(highResImageUrl),
            fetchWithRetry(lowResImageUrl)
        ]);

        if (!highResImageResponse || !highResImageResponse.ok) {
            console.error("Could not fetch the high-resolution image. Aborting cache update.");
            return;
        }

        // --- NEW: Extract the actual MIME type from the response headers ---
        const highResMimeType = highResImageResponse.headers.get('Content-Type') || 'image/webp';
        const lowResMimeType = (lowResImageResponse && lowResImageResponse.ok) ? (lowResImageResponse.headers.get('Content-Type') || 'image/webp') : null;

        // Cache the responses directly in the Cache API
        const cache = await caches.open(IMAGE_CACHE_NAME);
        await cache.put(highResImageUrl, highResImageResponse.clone());
        if (lowResImageResponse && lowResImageResponse.ok) {
            await cache.put(lowResImageUrl, lowResImageResponse.clone());
        }

        // Update the in-memory metadata cache, now including the MIME types
        currentCachedPhotoMetadata = {
            photo: photoMetadata,
            highResUrl: highResImageUrl,
            lowResUrl: (lowResImageResponse && lowResImageResponse.ok) ? lowResImageUrl : null,
            highResMimeType: highResMimeType, // Add MIME type
            lowResMimeType: lowResMimeType,   // Add MIME type
            is_used: false,
            cached_time: Date.now(),
            error: null
        };
        console.log("New photo fetched and responses stored in Cache API. Marked as UNUSED.");

        await savePhotoData(); // Save the new metadata (including MIME types) to local storage

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
    await fetchAndCacheNewPhoto(true);
    await scheduleCacheRefreshAlarm();
});


// --- MODIFIED: Listen for messages from newtab.js ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getUnsplashPhoto") {
        (async () => {
            if (!currentCachedPhotoMetadata.photo) {
                await loadPhotoMetadata();
            }

            if (!currentCachedPhotoMetadata.photo) {
                 await fetchAndCacheNewPhoto(true);
            }

            // Now, we destructure the new MIME type properties as well
            const { photo, highResUrl, lowResUrl, highResMimeType, lowResMimeType, error } = currentCachedPhotoMetadata;

            if (error || !photo) {
                sendResponse({ error: error || "Photo data is not available." });
                return;
            }

            // ... (Getting responses from cache is unchanged) ...
            const cache = await caches.open(IMAGE_CACHE_NAME);
            const highResCachedResponse = await cache.match(highResUrl);
            const lowResCachedResponse = lowResUrl ? await cache.match(lowResUrl) : null;
            
            if (!highResCachedResponse) {
                console.error("High-res image not found in cache! Re-fetching.");
                await fetchAndCacheNewPhoto(true);
                sendResponse({ error: "Image not found in cache, please reopen the tab." });
                return;
            }
            
            const highResArrayBuffer = await highResCachedResponse.arrayBuffer();
            const lowResArrayBuffer = lowResCachedResponse ? await lowResCachedResponse.arrayBuffer() : null;
            
            // Prepare data to send, now including the MIME types
            const responseData = {
                photo: photo,
                highResArrayBuffer: highResArrayBuffer,
                lowResArrayBuffer: lowResArrayBuffer,
                highResMimeType: highResMimeType, // Send MIME type
                lowResMimeType: lowResMimeType,   // Send MIME type
            };

            sendResponse(responseData);

            // After serving, mark as used and trigger a pre-fetch for the next tab.
            currentCachedPhotoMetadata.is_used = true;
            await savePhotoData();
            console.log("Served photo marked as used. Triggering pre-fetch for next tab...");
            
            fetchAndCacheNewPhoto(false);
            scheduleCacheRefreshAlarm();
        })();

        return true;
    }
});