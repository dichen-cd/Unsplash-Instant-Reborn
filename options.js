// options.js

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveButton').addEventListener('click', saveOptions);

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
async function restoreOptions() {
    const defaultSettings = {
        unsplashApiKey: '',
        cacheDuration: 5 // Default value for cache duration
    };

    chrome.storage.sync.get(defaultSettings, (items) => {
        document.getElementById('unsplashApiKey').value = items.unsplashApiKey;
        document.getElementById('cacheDuration').value = items.cacheDuration;
    });
}

// Saves options to chrome.storage.
async function saveOptions() {
    const unsplashApiKey = document.getElementById('unsplashApiKey').value.trim();
    let cacheDuration = parseInt(document.getElementById('cacheDuration').value, 10);

    const statusElement = document.getElementById('status');

    // Basic validation
    if (!unsplashApiKey) {
        showStatus('Unsplash API Key is required!', 'error');
        return;
    }

    if (isNaN(cacheDuration) || cacheDuration < 1) {
        cacheDuration = 5; // Default to 5 minutes if invalid
        document.getElementById('cacheDuration').value = cacheDuration; // Update input field
        showStatus('Invalid Cache Duration. Defaulting to 5 minutes.', 'error');
    }

    chrome.storage.sync.set(
        {
            unsplashApiKey: unsplashApiKey,
            cacheDuration: cacheDuration
        },
        () => {
            // Update status to let user know options were saved.
            showStatus('Settings saved!', 'success');
        }
    );
}

// Helper function to show status messages
function showStatus(message, type) {
    const statusElement = document.getElementById('status');
    statusElement.textContent = message;
    statusElement.className = ''; // Clear existing classes
    statusElement.classList.add('status-' + type);
    statusElement.style.display = 'block';

    setTimeout(() => {
        statusElement.style.display = 'none';
        statusElement.textContent = '';
    }, 3000); // Hide after 3 seconds
}