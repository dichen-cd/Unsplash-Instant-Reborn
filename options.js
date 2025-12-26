// options.js

const ALL_TOPICS = [
    { id: 'Jpg6Kidl-Hk', name: 'Animals' },
    { id: 'M8jVbLbTRws', name: 'Architecture & Interiors' },
    { id: 'aeu6rL-j6ew', name: 'Business & Work' },
    { id: 'BJJMtteDJA4', name: 'Current Events' },
    { id: 'qPYsDzvJOYc', name: 'Experimental' },
    { id: 'hmenvQhUmxM', name: 'Film' },
    { id: 'xjPR4hlkBGA', name: 'Food & Drink' },
    { id: '_hb-dl4Q-4U', name: 'Health & Wellness' },
    { id: '6sMVjTLSkeQ', name: 'Nature' },
    { id: 'towJZFskpGg', name: 'People' },
    { id: '_8zFHuhRhyo', name: 'Spirituality' },
    { id: 'J9yrPaHXRQY', name: 'Technology' },
    { id: 'iUIsnVtjB0Y', name: 'Textures' },
    { id: 'Fzo3zuOHN6w', name: 'Travel' },
    { id: 'bo8jQKTaE0Y', name: 'Wallpapers' },
];

function populateTopics() {
    const container = document.getElementById('topicsContainer');
    if (!container) return;
    container.innerHTML = '';
    ALL_TOPICS.forEach(topic => {
        const div = document.createElement('div');
        div.className = 'topic-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `topic-${topic.id}`;
        checkbox.value = topic.id;
        checkbox.name = 'topics';

        const label = document.createElement('label');
        label.htmlFor = `topic-${topic.id}`;
        label.textContent = topic.name;

        div.appendChild(checkbox);
        div.appendChild(label);
        container.appendChild(div);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    populateTopics();
    restoreOptions();
});
document.getElementById('saveButton').addEventListener('click', saveOptions);

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
async function restoreOptions() {
    const defaultSettings = {
        unsplashApiKey: '',
        cacheDuration: 5, // Default value for cache duration
        topics: '6sMVjTLSkeQ,Fzo3zuOHN6w,bo8jQKTaE0Y' // Default topics
    };

    chrome.storage.sync.get(defaultSettings, (items) => {
        document.getElementById('unsplashApiKey').value = items.unsplashApiKey;
        document.getElementById('cacheDuration').value = items.cacheDuration;

        const selectedTopics = items.topics ? items.topics.split(',') : [];
        document.querySelectorAll('#topicsContainer input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = selectedTopics.includes(checkbox.value);
        });
    });
}

// Saves options to chrome.storage.
async function saveOptions() {
    const unsplashApiKey = document.getElementById('unsplashApiKey').value.trim();
    let cacheDuration = parseInt(document.getElementById('cacheDuration').value, 10);

    const selectedTopics = Array.from(document.querySelectorAll('#topicsContainer input:checked'))
                                .map(cb => cb.value);
    const topics = selectedTopics.join(',');

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
            cacheDuration: cacheDuration,
            topics: topics
        },
        () => {
            // Update status to let user know options were saved.
            let message = 'Settings saved!';
            if (!topics) {
                message += ' Using default topics.';
            }
            showStatus(message, 'success');
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