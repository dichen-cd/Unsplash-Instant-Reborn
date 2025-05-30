// options.js

document.addEventListener('DOMContentLoaded', loadOptions);
document.getElementById('saveButton').addEventListener('click', saveOptions);

const statusMessage = document.getElementById('status-message');

function showStatus(message, isSuccess = true) {
    statusMessage.textContent = message;
    statusMessage.style.display = 'block';
    statusMessage.className = isSuccess ? 'status-success' : 'status-error';

    // Fade out after 3 seconds
    setTimeout(() => {
        statusMessage.style.display = 'none';
    }, 3000);
}

function saveOptions() {
    const unsplashApiKey = document.getElementById('unsplashApiKey').value.trim();
    let cacheDuration = parseInt(document.getElementById('cacheDuration').value, 10);

    if (!unsplashApiKey) {
        showStatus('Unsplash API Key cannot be empty!', false);
        return;
    }
    if (isNaN(cacheDuration) || cacheDuration < 1 || cacheDuration > 1440) {
        showStatus('Cache duration must be a number between 1 and 1440 minutes.', false);
        return;
    }

    // Store in chrome.storage.sync to sync across browsers
    chrome.storage.sync.set(
        {
            unsplashApiKey: unsplashApiKey,
            cacheDuration: cacheDuration
        },
        () => {
            if (chrome.runtime.lastError) {
                console.error("Error saving options:", chrome.runtime.lastError);
                showStatus(`Error saving settings: ${chrome.runtime.lastError.message}`, false);
            } else {
                showStatus('Settings saved!', true);
                console.log("Settings saved:", { unsplashApiKey, cacheDuration });
            }
        }
    );
}

function loadOptions() {
    // Load from chrome.storage.sync
    chrome.storage.sync.get(
        {
            unsplashApiKey: '', // Default empty string
            cacheDuration: 5    // Default 5 minutes
        },
        (items) => {
            document.getElementById('unsplashApiKey').value = items.unsplashApiKey;
            document.getElementById('cacheDuration').value = items.cacheDuration;
            console.log("Settings loaded:", items);
        }
    );
}