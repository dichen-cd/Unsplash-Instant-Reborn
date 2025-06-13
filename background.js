// background.js

// --- New: Flag to prevent duplicate photo fetch processes ---
let isFetchingPhoto = false;

async function fetchWithRetry(url, retries = 10, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, {
                cache: 'force-cache' // Or 'default', based on your caching strategy
            });

            // Check if the response is OK (status 200-299)
            if (response.ok) {
                return response; // Successfully fetched, return response
            } else {
                // For non-OK responses:
                // Retry for server errors (5xx) or request timeout (408).
                // Do not retry for client errors (4xx like 404 Not Found) as they are usually permanent.
                if (response.status >= 500 || response.status === 408) {
                    console.warn(`Fetch attempt ${i + 1} for ${url} failed with status ${response.status}. Retrying...`);
                    if (i < retries - 1) {
                        await new Promise(resolve => setTimeout(resolve, delay * (i + 1))); // Exponential backoff
                        continue; // Go to the next retry attempt
                    } else {
                        console.error(`Final fetch attempt for ${url} failed with status ${response.status}.`);
                        return null; // All retries exhausted, return null
                    }
                } else {
                    // For client errors (e.g., 400, 404) or other non-retriable statuses
                    console.error(`Fetch for ${url} failed permanently with status ${response.status}. Not retrying.`);
                    return null; // Do not retry for non-transient errors
                }
            }
        } catch (error) {
            // Catch network errors (e.g., offline, DNS lookup failed, CORS issues)
            console.warn(`Network error during fetch attempt ${i + 1} for ${url}:`, error.message);
            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay * (i + 1))); // Exponential backoff
            } else {
                console.error(`Final fetch attempt for ${url} failed due to network error:`, error.message);
                return null; // All retries exhausted due to network error
            }
        }
    }
    return null; // Should not be reached, but as a fallback
}


// Global in-memory cache for the last fetched photo data (including ArrayBuffers)
let currentCachedPhotoData = {
    photo: null,            // The Unsplash JSON metadata
    highResArrayBuffer: null, // ArrayBuffer for the high-resolution image file
    lowResArrayBuffer: null,  // ArrayBuffer for the low-resolution image file (placeholder)
    is_used: false,          // True if this photo has been displayed at least once
    cached_time: 0           // Timestamp (ms) when this photo was successfully cached
};

// --- HELPER FUNCTION TO GET WEBP URL ---
function getWebpUrl(originalUrl) {
    if (!originalUrl) return '';
    // Unsplash URLs from the API already contain query parameters,
    // so we always append with '&'.
    return `${originalUrl}&fm=webp`;
}

// --- HELPER FUNCTIONS FOR ARRAYBUFFER <-> BASE64 CONVERSION (for storage) ---
// Converts an ArrayBuffer to a Base64 string
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary); // btoa encodes binary string to Base64
}

// Converts a Base64 string to an ArrayBuffer
function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64); // atob decodes Base64 to binary string
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer; // Return as ArrayBuffer
}

// Function to save current cached photo data to local storage for persistence
async function savePhotoToLocalStorage() {
    try {
        const dataToSave = {
            photo: currentCachedPhotoData.photo,
            highResBase64: currentCachedPhotoData.highResArrayBuffer ? arrayBufferToBase64(currentCachedPhotoData.highResArrayBuffer) : null,
            lowResBase64: currentCachedPhotoData.lowResArrayBuffer ? arrayBufferToBase64(currentCachedPhotoData.lowResArrayBuffer) : null,
            is_used: currentCachedPhotoData.is_used,        // Save the is_used flag
            cached_time: currentCachedPhotoData.cached_time  // Save the cached_time
        };
        await chrome.storage.local.set({ 'cachedUnsplashPhoto': dataToSave });
        console.log("Photo data saved to local storage (Base64 encoded for persistence) with is_used:", currentCachedPhotoData.is_used, "and time:", currentCachedPhotoData.cached_time);
    } catch (e) {
        console.error("Error saving photo data to local storage:", e);
    }
}

// Function to load photo data from local storage into the in-memory cache
async function loadPhotoFromLocalStorage() {
    try {
        const result = await chrome.storage.local.get('cachedUnsplashPhoto');
        if (result.cachedUnsplashPhoto && result.cachedUnsplashPhoto.photo) {
            currentCachedPhotoData = {
                photo: result.cachedUnsplashPhoto.photo,
                highResArrayBuffer: result.cachedUnsplashPhoto.highResBase64 ? base64ToArrayBuffer(result.cachedUnsplashPhoto.highResBase64) : null,
                lowResArrayBuffer: result.cachedUnsplashPhoto.lowResBase64 ? base64ToArrayBuffer(result.cachedUnsplashPhoto.lowResBase64) : null,
                // For existing data, assume it was used if present. Default to true if not defined.
                is_used: result.cachedUnsplashPhoto.is_used !== undefined ? result.cachedUnsplashPhoto.is_used : true,
                // For existing data, if cached_time isn't present, assume it's old (0)
                cached_time: result.cachedUnsplashPhoto.cached_time !== undefined ? result.cachedUnsplashPhoto.cached_time : 0
            };
            console.log("Photo data loaded from local storage (Base64 decoded) with is_used:", currentCachedPhotoData.is_used, "and time:", currentCachedPhotoData.cached_time);
            return true; // Indicates data was loaded
        }
        return false; // No data found
    } catch (e) {
        console.error("Error loading photo data from local storage:", e);
        return false;
    }
}


// Function to fetch a new photo (metadata + image files) and update the cache
// forceFetch: If true, bypasses the is_used/cached_time check and always fetches.
async function fetchAndCacheNewPhoto(forceFetch = false) {
    // Check the global flag before proceeding with any fetch logic
    if (isFetchingPhoto) {
        console.log("A photo fetch is already in progress. Not initiating duplicate fetch.");
        return; // Exit without fetching
    }

    // Set the flag to true immediately when we start the fetch process
    isFetchingPhoto = true;

    try {
        // Only apply the `is_used` and `cached_time` logic if not forcing a fetch
        if (!forceFetch) {
            // Retrieve the user-set cache duration from storage for comparison
            const preferences = await chrome.storage.sync.get('cacheDuration');
            const cacheDurationMinutes = preferences.cacheDuration && typeof preferences.cacheDuration === 'number' && preferences.cacheDuration > 0
                                        ? preferences.cacheDuration
                                        : 5; // Default to 5 minutes

            const cacheDurationMs = cacheDurationMinutes * 60 * 1000; // Convert to milliseconds
            const now = Date.now();
            const photoIsStale = (currentCachedPhotoData.cached_time + cacheDurationMs) < now;

            // --- APPLYING USER'S CASES ---

            // Case 1: If is_used = False, don't send request no matter how old cached_time is.
            if (!currentCachedPhotoData.is_used) {
                console.log("Cached photo is unused. Not fetching new (Case 1).");
                return; // Exit without fetching
            }

            // Case 2: If is_used = True AND cached_time is younger than cacheDuration, don't send request.
            // (We know is_used is True because we passed Case 1)
            if (!photoIsStale) { // If photo is NOT stale (meaning it's younger)
                console.log(`Cached photo is used but still fresh (cached for ${Math.round((now - currentCachedPhotoData.cached_time)/1000/60)}/${cacheDurationMinutes} mins). Not fetching new (Case 2).`);
                return; // Exit without fetching
            }

            // If we reach here, it means:
            // currentCachedPhotoData.is_used is TRUE (passed Case 1)
            // photoIsStale is TRUE (passed Case 2)
            // This matches Case 3: is_used = True AND cached_time is OLDER
            console.log(`Cached photo is used AND stale (cached for ${Math.round((now - currentCachedPhotoData.cached_time)/1000/60)}/${cacheDurationMinutes} mins). Proceeding to fetch new (Case 3).`);
        }

        // --- Original Fetch Logic (only executed if `forceFetch` is true OR if all "don't fetch" conditions are false) ---
        let apiKey;
        try {
            const result = await chrome.storage.sync.get('unsplashApiKey');
            apiKey = result.unsplashApiKey;

            if (!apiKey) {
                console.error("Unsplash API Key not found in storage. Cannot pre-fetch.");
                currentCachedPhotoData = {
                    photo: null, // Clear photo data if API key is missing
                    highResArrayBuffer: null,
                    lowResArrayBuffer: null,
                    is_used: false,
                    cached_time: 0,
                    error: "API Key not set. Please set it in extension options."
                };
                savePhotoToLocalStorage(); // Save this error state
                return;
            }

            const preferences = await chrome.storage.sync.get(['photoQuery', 'photoOrientation']);
            const query = preferences.photoQuery || 'nature';
            const orientation = preferences.photoOrientation || 'landscape';

            // 1. Fetch photo metadata from Unsplash API
            const apiUrl = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=${orientation}`;
            const apiResponse = await fetch(apiUrl, {
                headers: {
                    'Authorization': `Client-ID ${apiKey}`,
                    'Accept-Version': 'v1'
                }
            });

            if (!apiResponse.ok) {
                const errorText = await apiResponse.text();
                console.error(`Unsplash API error during pre-fetch: ${apiResponse.status} - ${errorText}`);
                let errorMsg;
                if (apiResponse.status === 401) {
                    errorMsg = "Invalid Unsplash API Key. Please check your key in extension options.";
                } else if (apiResponse.status === 403) {
                    errorMsg = "Unsplash API Rate Limit Exceeded or permissions issue. Try again later.";
                } else {
                    errorMsg = `Failed to pre-fetch photo metadata: ${apiResponse.status} ${apiResponse.statusText}`;
                }
                currentCachedPhotoData = {
                    photo: null, // Clear photo data on error
                    highResArrayBuffer: null,
                    lowResArrayBuffer: null,
                    is_used: false,
                    cached_time: 0,
                    error: errorMsg
                };
                savePhotoToLocalStorage(); // Save this error state
                return;
            }

            const photoMetadata = await apiResponse.json();

            // 2. Determine image URLs for actual download (WebP format)
            const highResImageUrl = getWebpUrl(photoMetadata.urls.full || photoMetadata.urls.raw || photoMetadata.urls.regular);
            const lowResImageUrl = getWebpUrl(photoMetadata.urls.thumb || photoMetadata.urls.small || photoMetadata.urls.regular);

            let highResArrayBuffer = null;
            let lowResArrayBuffer = null;

            try {
                // Fetch both high-res and low-res image data concurrently as ArrayBuffers
                const [highResImageResponse, lowResImageResponse] = await Promise.all([
                    fetchWithRetry(highResImageUrl),
                    fetchWithRetry(lowResImageUrl)
                ]);

                // It's important to check if the responses are valid before attempting to get arrayBuffer
                // fetchWithRetry returns null on failure
                if (highResImageResponse && highResImageResponse.ok) {
                    highResArrayBuffer = await highResImageResponse.arrayBuffer();
                } else {
                    console.warn(`Failed to get high-res image ArrayBuffer: ${highResImageUrl}`);
                }

                if (lowResImageResponse && lowResImageResponse.ok) {
                    lowResArrayBuffer = await lowResImageResponse.arrayBuffer();
                } else {
                    console.warn(`Failed to get low-res image ArrayBuffer: ${lowResImageUrl}`);
                }

            } catch (imageFetchError) {
                console.error("Error fetching image ArrayBuffers:", imageFetchError);
            }

            // 3. Update the global cache with metadata and ArrayBuffers
            currentCachedPhotoData = {
                photo: photoMetadata,
                highResArrayBuffer: highResArrayBuffer,
                lowResArrayBuffer: lowResArrayBuffer,
                is_used: false,      // NEWLY FETCHED photo is marked as UNUSED
                cached_time: Date.now() // Record the time it was successfully cached
            };
            console.log("New photo metadata and ArrayBuffers pre-fetched and cached in-memory. Marked as UNUSED.");

            // 4. Save to chrome.storage.local for persistence (will use Base64 internally)
            savePhotoToLocalStorage();

        } catch (error) {
            console.error("General error during Unsplash photo pre-fetch process:", error);
            currentCachedPhotoData = {
                photo: null, // Clear photo data on general error
                highResArrayBuffer: null,
                highResArrayBuffer: null, // This was a typo - should be lowResArrayBuffer
                lowResArrayBuffer: null,
                is_used: false,
                cached_time: 0,
                error: `General error during pre-fetch: ${error.message}`
            };
            savePhotoToLocalStorage(); // Save this error state
        }
    } finally {
        // Ensure the flag is reset whether the fetch succeeded or failed
        isFetchingPhoto = false;
    }
}

// --- CHROME ALARMS FOR PROACTIVE CACHING ---
const CACHE_REFRESH_ALARM = 'cacheRefreshAlarm';

// Create or update the caching alarm
async function scheduleCacheRefreshAlarm() {
    // Retrieve the user-set cache duration from storage
    const preferences = await chrome.storage.sync.get('cacheDuration');
    // Use the user's value, default to 5 minutes if not set or invalid
    const interval = preferences.cacheDuration && typeof preferences.cacheDuration === 'number' && preferences.cacheDuration > 0
                             ? preferences.cacheDuration
                             : 5; // Default to 5 minutes if cacheDuration is not set or invalid

    // Clear any existing alarm first to prevent duplicates
    chrome.alarms.clear(CACHE_REFRESH_ALARM);

    // Schedule a new alarm for periodic fetching
    chrome.alarms.create(CACHE_REFRESH_ALARM, {
        periodInMinutes: interval
    });
    console.log(`Scheduled cache refresh alarm for every ${interval} minutes.`);
}

// Listener for alarms
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === CACHE_REFRESH_ALARM) {
        console.log("Cache refresh alarm triggered. Attempting to fetch new photo proactively if needed.");
        // Alarm-triggered fetch should respect the is_used/cached_time logic (forceFetch = false)
        fetchAndCacheNewPhoto(false);
    }
});


// Event Listeners for initial photo fetch and loading from storage
chrome.runtime.onStartup.addListener(async () => {
    console.log("Background script started (onStartup).");
    // Always try to load from storage first to populate in-memory cache immediately
    await loadPhotoFromLocalStorage();
    // Schedule the proactive refresh alarm
    await scheduleCacheRefreshAlarm();
    // If no photo was loaded from storage, or if there's an error state,
    // force a fetch for the very first display to ensure content is available.
    if (!currentCachedPhotoData.photo || currentCachedPhotoData.error) {
        console.log("No valid photo in cache on startup or in error state, forcing a new fetch for initial display.");
        fetchAndCacheNewPhoto(true); // FORCE FETCH for initial startup/display
    }
});

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log(`Extension installed/updated (onInstalled, reason: ${details.reason}).`);
    // Force fetch on install/update to ensure fresh data
    await fetchAndCacheNewPhoto(true); // FORCE FETCH on install/update
    // Schedule the proactive refresh alarm
    await scheduleCacheRefreshAlarm();
});


// Listen for messages from the newtab.js script
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === "getUnsplashPhoto") {
        let dataToSend = null;
        // NEW: Flag to indicate if a network fetch was needed for THIS tab's request
        let isInitialNetworkFetch = false;

        if (currentCachedPhotoData.photo || currentCachedPhotoData.error) {
            // Data is already in memory cache (Service Worker was active recently)
            dataToSend = { ...currentCachedPhotoData }; // Create a copy to send
            console.log("Serving photo from in-memory cache.");
        } else {
            // In-memory cache is empty (Service Worker might have just woken up).
            // Try loading from local storage to serve the current tab quickly.
            console.log("In-memory cache empty. Attempting to load from local storage for current tab...");
            const loadedFromStorage = await loadPhotoFromLocalStorage(); // This populates currentCachedPhotoData
            if (loadedFromStorage) {
                dataToSend = { ...currentCachedPhotoData };
                console.log("Serving photo from local storage cache.");
            } else {
                // No cache found anywhere (first run ever, or storage corrupted).
                // This means a network fetch is REQUIRED for the current tab.
                console.log("No photo found in any cache, forcing immediate fetch for current tab.");
                isInitialNetworkFetch = true; // Set flag to true
                // Note: fetchAndCacheNewPhoto already handles the `isFetchingPhoto` flag internally.
                await fetchAndCacheNewPhoto(true); // FORCE FETCH for the very first display
                dataToSend = { ...currentCachedPhotoData };
            }
        }

        // Attach the new flag to the response
        dataToSend.isInitialNetworkFetch = isInitialNetworkFetch;

        // Mark the served photo as USED in the background cache
        // This is done AFTER creating `dataToSend` so the sent object reflects the state
        // at the time of retrieval.
        if (dataToSend.photo) { // Only mark as used if a valid photo is present in the data being sent
            currentCachedPhotoData.is_used = true;
            savePhotoToLocalStorage(); // Persist the `is_used` status
            console.log("Served photo marked as used. is_used:", currentCachedPhotoData.is_used);
        } else {
            // If dataToSend.photo is null (e.g., due to an API key error),
            // ensure currentCachedPhotoData.is_used is also false to retry later.
            currentCachedPhotoData.is_used = false;
            savePhotoToLocalStorage();
        }

        // Before sending, ensure ArrayBuffers are correctly sliced for transfer if they exist
        // (ArrayBuffers are transferred/moved, not copied, by sendMessage. We need a copy.)
        if (dataToSend.highResArrayBuffer) {
            dataToSend.highResArrayBuffer = dataToSend.highResArrayBuffer.slice(0); // Create a new transferable copy
        }
        if (dataToSend.lowResArrayBuffer) {
            dataToSend.lowResArrayBuffer = dataToSend.lowResArrayBuffer.slice(0); // Create a new transferable copy
        }

        // Send the response for the current tab immediately
        sendResponse(dataToSend);

        // After serving the current tab, trigger a *new* pre-fetch for the *next* tab.
        // This runs asynchronously without blocking the current response.
        // This call will respect the is_used/cached_time logic (forceFetch = false)
        // And importantly, it will respect the `isFetchingPhoto` flag if another fetch is already happening
        // (e.g., from an alarm that just fired).
        console.log("Photo served. Triggering immediate pre-fetch for next tab (if needed)...");
        fetchAndCacheNewPhoto(false);

        // Also, reset the alarm to ensure the next periodic fetch happens relative
        // to this manual fetch, preventing unnecessary overlap.
        await scheduleCacheRefreshAlarm();

        return true; // Indicate that sendResponse will be called asynchronously
    }
});