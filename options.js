// options.js

// Unsplash's own official editorial pool. 317099 is the "Unsplash Editorial"
// collection, owned by the `unsplash` account and hardcoded as
// `editorialCollectionId` in Unsplash's official iOS/Android photo-picker SDKs.
// Blended with the official "Wallpapers" topic, which is curated specifically
// for screen-sized backgrounds.
const EDITORIAL_ID = 'EDITORIAL';
// Legacy value for the same option, still present in existing users' synced settings.
const LEGACY_EDITORIAL_ID = 'EDITOR_CHOICE';

const ALL_TOPICS = [
    { id: EDITORIAL_ID, name: 'Editorial & Wallpapers' },
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

// Show the custom-width field only when the "custom" preset is selected.
function syncCustomWidthVisibility() {
    const select = document.getElementById('imageQuality');
    const group = document.getElementById('customWidthGroup');
    if (!select || !group) return;
    group.style.display = select.value === 'custom' ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
    populateTopics();
    restoreOptions();
    document.getElementById('imageQuality')?.addEventListener('change', syncCustomWidthVisibility);
});
document.getElementById('saveButton').addEventListener('click', saveOptions);

// Restores select box and checkbox state using the preferences
// stored in chrome.storage.
async function restoreOptions() {
    const defaultSettings = {
        unsplashApiKey: '',
        cacheDuration: 5, // Default value for cache duration
        topics: EDITORIAL_ID, // Default topics
        imageQuality: 'balanced',
        customWidth: 2560
    };

    chrome.storage.sync.get(defaultSettings, (items) => {
        document.getElementById('unsplashApiKey').value = items.unsplashApiKey;
        document.getElementById('cacheDuration').value = items.cacheDuration;
        document.getElementById('imageQuality').value = items.imageQuality;
        document.getElementById('customWidth').value = items.customWidth;
        syncCustomWidthVisibility();

        // Map the legacy EDITOR_CHOICE value onto its current id so existing
        // installs keep their selection after the rename.
        const selectedTopics = (items.topics ? items.topics.split(',') : [])
            .map(id => (id === LEGACY_EDITORIAL_ID ? EDITORIAL_ID : id));
        document.querySelectorAll('#topicsContainer input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = selectedTopics.includes(checkbox.value);
        });
    });
}

// Saves options to chrome.storage.
async function saveOptions() {
    const unsplashApiKey = document.getElementById('unsplashApiKey').value.trim();
    let cacheDuration = parseInt(document.getElementById('cacheDuration').value, 10);
    const imageQuality = document.getElementById('imageQuality').value;
    let customWidth = parseInt(document.getElementById('customWidth').value, 10);

    const selectedTopics = Array.from(document.querySelectorAll('#topicsContainer input:checked'))
                                .map(cb => cb.value);
    const topics = selectedTopics.join(',');

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

    if (isNaN(customWidth) || customWidth < 640 || customWidth > 7680) {
        customWidth = 2560;
        document.getElementById('customWidth').value = customWidth;
        if (imageQuality === 'custom') {
            showStatus('Invalid Custom Width. Defaulting to 2560px.', 'error');
        }
    }

    chrome.storage.sync.set(
        {
            unsplashApiKey: unsplashApiKey,
            cacheDuration: cacheDuration,
            topics: topics,
            imageQuality: imageQuality,
            customWidth: customWidth
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