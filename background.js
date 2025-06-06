// background.js

const CACHE_KEY = 'unsplashPhotoData';
const DEFAULT_CACHE_DURATION_MINUTES = 5; // Default if user hasn't set one

// Function to get current settings from storage or use defaults
async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(
            {
                unsplashApiKey: '', // Default empty
                cacheDuration: DEFAULT_CACHE_DURATION_MINUTES // Default 5 minutes
            },
            (items) => {
                resolve({
                    unsplashApiKey: items.unsplashApiKey,
                    cacheDuration: items.cacheDuration, // Keep in minutes for alarm setup
                    cacheDurationMs: items.cacheDuration * 60 * 1000 // Convert to milliseconds for time comparison
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
        return null; // Cannot fetch without API key
    }

    const UNSPLASH_API_URL = `https://api.unsplash.com/photos/random?orientation=landscape&client_id=${UNSPLASH_API_KEY}`;

    try {
        console.log("Attempting to fetch a new photo from Unsplash...");
        const response = await fetch(UNSPLASH_API_URL);
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                 console.error("Unsplash API Key invalid or insufficient permissions. Please check your key in extension options.");
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
            timestamp: Date.now(), // Store the timestamp WHEN this photo was fetched
            displayedOnce: false   // NEW: Flag to track if this photo has been displayed
        };
        await chrome.storage.local.set({ [CACHE_KEY]: photoData }); // Store in local storage
        console.log("Fetched and cached new photo from Unsplash:", photoData.id);
        return photoData;
    } catch (error) {
        console.error("Error fetching photo from Unsplash:", error);
        return null;
    }
}

// Function to determine if a new image needs to be fetched
async function needsNewPhoto(photoData, settings) {
    if (!photoData) {
        console.log("Needs new photo: No photo stored.");
        return true; // No photo stored at all
    }

    // Check if the current photo is "stale" (older than configured cache duration)
    const isStale = (Date.now() - photoData.timestamp) > settings.cacheDurationMs;

    // Logic:
    // If it's already displayed AND it's stale, we need a new one.
    if (photoData.displayedOnce && isStale) {
        console.log("Needs new photo: Photo was displayed and is now stale.");
        return true;
    }
    // If it was displayed but is NOT stale, we don't need a new one.
    if (photoData.displayedOnce && !isStale) {
        console.log("No new photo needed: Photo was displayed but is still fresh.");
        return false;
    }
    // If it was NOT displayed yet (displayedOnce is false), we don't need a new one.
    if (!photoData.displayedOnce) {
        console.log("No new photo needed: Photo is cached but not yet displayed.");
        return false;
    }

    // Fallback, should not be reached with clear logic above
    return false;
}

// Function to create or reschedule the alarm
async function createOrRescheduleAlarm() {
    const settings = await getSettings();
    const CACHE_DURATION_MINUTES = settings.cacheDuration;

    // Minimum periodInMinutes for alarms is 1 minute in Chrome, but we use the user's setting.
    // If the user sets it too low (e.g., 0), we might default to 1 min or handle it.
    // Let's ensure a minimum of 1 minute to avoid issues.
    const alarmPeriod = Math.max(1, CACHE_DURATION_MINUTES);

    chrome.alarms.clearAll(); // Clear any existing alarms
    chrome.alarms.create('unsplash-refresh-alarm', {
        periodInMinutes: alarmPeriod // Use user-configured duration
        // We don't use 'when' here for periodic alarms, 'periodInMinutes' means start immediately and repeat.
    });
    console.log('Alarm set to refresh every ', alarmPeriod, ' minutes');
}

// --- Top-level execution and listener registration ---

// Listener for when the extension is installed or updated
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        console.log("Extension installed for the first time. Opening options page.");
        chrome.runtime.openOptionsPage();
    }
    // Create or reschedule the alarm on install/update
    createOrRescheduleAlarm();
});

// Listener for when settings are changed by the user (to update alarm)
chrome.storage.sync.onChanged.addListener((changes) => {
    if (changes.cacheDuration) {
        console.log("Cache duration setting changed. Rescheduling alarm.");
        createOrRescheduleAlarm();
    }
});


// Alarm listener (fires periodically)
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'unsplash-refresh-alarm') {
        console.log('Alarm fired! Checking and potentially refreshing photo...');
        const result = await chrome.storage.local.get(CACHE_KEY);
        const photoData = result[CACHE_KEY];
        const settings = await getSettings();

        if (await needsNewPhoto(photoData, settings)) {
            console.log("Alarm: Needs new photo, fetching...");
            await fetchAndCacheNewPhoto();
        } else {
            console.log("Alarm: Cached photo does not need refresh (either new or not yet displayed).");
        }
    }
});


// Handle messages from newtab.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getUnsplashPhoto") {
        chrome.storage.local.get(CACHE_KEY, async (result) => {
            const settings = await getSettings();
            let photoData = result[CACHE_KEY];

            if (await needsNewPhoto(photoData, settings)) {
                console.log("New Tab Request: Needs new photo, fetching...");
                photoData = await fetchAndCacheNewPhoto();
            } else {
                console.log("New Tab Request: Serving existing cached photo.");
            }

            // Immediately mark the photo as displayed once it's sent to the new tab.
            if (photoData) {
                photoData.displayedOnce = true;
                await chrome.storage.local.set({ [CACHE_KEY]: photoData });
                console.log("New Tab Request: Photo marked as displayed.");
            }
            sendResponse({ photo: photoData });
        });
        return true; // Indicates an asynchronous response
    }
    // No longer need a separate "markPhotoAsDisplayed" action as it's handled within getUnsplashPhoto
});

// Initial photo fetch on service worker startup (ensures first new tab loads quickly)
(async () => {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const photoData = result[CACHE_KEY];
    const settings = await getSettings();

    if (await needsNewPhoto(photoData, settings)) {
        console.log("Startup: Needs new photo, fetching...");
        await fetchAndCacheNewPhoto();
    } else {
        console.log("Startup: Cached photo is fresh or not yet displayed.");
    }
})();