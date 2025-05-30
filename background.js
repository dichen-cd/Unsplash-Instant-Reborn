// background.js

const CACHE_KEY = 'unsplashPhotoData';

// Function to get current settings from storage or use defaults
async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(
            {
                unsplashApiKey: '', // Default empty
                cacheDuration: 5    // Default 5 minutes
            },
            (items) => {
                resolve({
                    unsplashApiKey: items.unsplashApiKey,
                    // Convert minutes to milliseconds for CACHE_DURATION
                    cacheDurationMs: items.cacheDuration * 60 * 1000
                });
            }
        );
    });
}

// Function to fetch and cache a new photo
async function fetchAndCacheNewPhoto() {
    const settings = await getSettings();
    const UNSPLASH_API_KEY = settings.unsplashApiKey; // Use the configured API key

    if (!UNSPLASH_API_KEY) {
        console.error("Unsplash API Key is not configured. Please set it in extension options.");
        // Optionally, you might want to open the options page here too
        // if a new tab is opened and the key is missing.
        // chrome.runtime.openOptionsPage();
        return null; // Cannot fetch without API key
    }

    const UNSPLASH_API_URL = `https://api.unsplash.com/photos/random?orientation=landscape&client_id=${UNSPLASH_API_KEY}`;

    try {
        console.log("Attempting to fetch a new photo from Unsplash...");
        const response = await fetch(UNSPLASH_API_URL);
        if (!response.ok) {
            // Check for specific error status codes from Unsplash
            if (response.status === 401 || response.status === 403) {
                 console.error("Unsplash API Key invalid or insufficient permissions. Please check your key in extension options.");
                 // Maybe open options page if API key is explicitly bad
                 // chrome.runtime.openOptionsPage();
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const photoData = {
            id: data.id,
            urls: {
                full: data.urls.full,
                regular: data.urls.regular,
                raw: data.urls.raw,
                small: data.urls.small,
                thumb: data.urls.thumb
            },
            user: {
                name: data.user.name,
                profile_image: {
                    small: data.user.profile_image.small,
                    medium: data.user.profile_image.medium,
                    large: data.user.profile_image.large
                },
                links: {
                    html: data.user.links.html
                },
                location: data.user.location
            },
            links: {
                html: data.links.html,
                download: data.links.download
            },
            timestamp: Date.now() // Store the timestamp when this photo was fetched
        };
        await chrome.storage.local.set({ [CACHE_KEY]: photoData });
        console.log("Fetched and cached new photo from Unsplash:", photoData.id);
        return photoData;
    } catch (error) {
        console.error("Error fetching photo from Unsplash:", error);
        return null;
    }
}

// --- Top-level execution and listener registration ---

// Listener for when the extension is installed or updated
chrome.runtime.onInstalled.addListener((details) => {
    // Check if the reason is 'install' (first time installation)
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        console.log("Extension installed for the first time. Opening options page.");
        chrome.runtime.openOptionsPage(); // Open the options page
    }
});


// Handle messages from newtab.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getUnsplashPhoto") {
        chrome.storage.local.get(CACHE_KEY, async (result) => {
            const settings = await getSettings(); // Get current settings
            const CACHE_DURATION_MS = settings.cacheDurationMs;

            let photoData = result[CACHE_KEY];
            // Fetch new if NO cached photo OR if cached photo is older than configured CACHE_DURATION
            if (!photoData || (Date.now() - photoData.timestamp > CACHE_DURATION_MS)) {
                console.log("Cached photo either old or not found, fetching new for new tab request...");
                photoData = await fetchAndCacheNewPhoto(); // Await here to ensure data is fresh before sending
            } else {
                console.log("Serving existing cached photo (still fresh) for new tab request.");
            }
            sendResponse({ photo: photoData });
        });
        return true; // Indicates an asynchronous response
    }
});

// Initial photo fetch on service worker startup (only if no photo is cached or if it's old based on settings)
(async () => {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const photoData = result[CACHE_KEY];
    const settings = await getSettings(); // Get current settings
    const CACHE_DURATION_MS = settings.cacheDurationMs;

    // Fetch new if NO cached photo OR if cached photo is older than configured CACHE_DURATION
    if (!photoData || (Date.now() - photoData.timestamp > CACHE_DURATION_MS)) {
        console.log("Initial fetch of photo on service worker startup (cache empty or old based on settings).");
        await fetchAndCacheNewPhoto();
    } else {
        console.log("Initial photo found in cache and is still fresh on startup.");
    }
})();