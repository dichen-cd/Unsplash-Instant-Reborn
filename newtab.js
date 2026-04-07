// newtab.js

document.addEventListener('DOMContentLoaded', async () => {
    // Save screen dimensions for the background pre-fetcher
    chrome.storage.local.set({
        screenWidth: window.screen.width,
        devicePixelRatio: window.devicePixelRatio
    });

    const backgroundPhoto = document.getElementById('background-photo');
    const photoAnchor = document.getElementById('photo-anchor');
    const unsplashLogoLink = document.getElementById('unsplash-logo-link');
    
    const historyButton = document.getElementById('history-button');
    const refreshButton = document.getElementById('refresh-button');
    const historyPanel = document.getElementById('history-panel');
    const closeHistory = document.getElementById('close-history');
    const historyItemsContainer = document.getElementById('history-items');

    const photographerProfileLink = document.getElementById('photographer-profile-link');
    const photographerAvatar = document.getElementById('photographer-avatar');
    const photographerNameLink = document.getElementById('photographer-name-link');
    const photographerName = document.getElementById('photographer-name');
    const photographerLocationLink = document.getElementById('photographer-location-link');
    const photographerLocation = document.getElementById('photographer-location');

    const topSection = document.getElementById('top-section');
    const bottomSection = document.getElementById('bottom-section');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingMainText = document.getElementById('loading-main-text');
    const loadingSubText = document.getElementById('loading-sub-text');
    const bottomRightExif = document.getElementById('bottom-right-exif');
    const exifCamera = document.getElementById('exif-camera');
    const exifShutter = document.getElementById('exif-shutter');
    const exifAperture = document.getElementById('exif-aperture');
    const exifIso = document.getElementById('exif-iso');
    const exifFocalLength = document.getElementById('exif-focal-length');

    const errorOverlay = document.createElement('div');
    errorOverlay.id = 'error-overlay';
    errorOverlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.9); color: #fff; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; z-index: 1000; font-family: inherit; padding: 20px; box-sizing: border-box; opacity: 0; transition: opacity 0.5s ease-in-out; pointer-events: none;`;
    errorOverlay.innerHTML = `<p style="font-size: 1.5em; font-weight: bold; margin-bottom: 20px;">Oops! Something went wrong.</p><p style="font-size: 1.1em; line-height: 1.6;">Failed to load a new Unsplash photo.</p><p style="font-size: 1.1em; line-height: 1.6; margin-top: 10px;">Please ensure your Unsplash API Key is correctly set in your <a href="chrome://extensions/?id=${chrome.runtime.id}" target="_blank" style="color: #007bff; text-decoration: underline;">extension options</a>.</p><p style="font-size: 1.1em; line-height: 1.6; margin-top: 20px;">If the key is correct, try refreshing the page or check your internet connection.</p>`;
    document.body.appendChild(errorOverlay);

    function showLoadingOverlay(mainText, subText = '') {
        if (loadingOverlay) {
            loadingMainText.textContent = mainText;
            loadingSubText.textContent = subText;
            loadingOverlay.classList.remove('hidden');
            loadingOverlay.style.opacity = '1';
        }
    }

    function hideLoadingOverlay() {
        if (loadingOverlay) {
            loadingOverlay.style.opacity = '0';
            setTimeout(() => { loadingOverlay.classList.add('hidden'); }, 500);
        }
    }

    function showGlobalError(message = "Failed to load photo.") {
        hideLoadingOverlay();
        if (backgroundPhoto) backgroundPhoto.style.opacity = '0';
        if (topSection) topSection.classList.remove('loaded');
        if (bottomSection) bottomSection.classList.remove('loaded');
        if (errorOverlay) {
            errorOverlay.querySelector('p:nth-child(2)').textContent = message;
            errorOverlay.style.display = 'flex';
            errorOverlay.style.opacity = '1';
            errorOverlay.style.pointerEvents = 'auto';
        }
    }

    function hideGlobalError() {
        if (errorOverlay) {
            errorOverlay.style.opacity = '0';
            errorOverlay.style.pointerEvents = 'none';
            setTimeout(() => { errorOverlay.style.display = 'none'; }, 500);
        }
    }

    function displayPhoto(cachedPhotoData, isForced = false) {
        hideGlobalError();

        const { photo, highResUrl, optimizedThumbUrl, thumbDataUri } = cachedPhotoData;

        if (!photo) {
            hideLoadingOverlay();
            return;
        }

        if (photoAnchor && backgroundPhoto) {
            // Define the behavior for when the image is ready
            const handleImageLoad = () => {
                backgroundPhoto.style.opacity = '1';
                if (topSection) topSection.classList.add('loaded');
                if (bottomSection) bottomSection.classList.add('loaded');
                hideLoadingOverlay();
            };

            // Prepare for the new image
            backgroundPhoto.onload = handleImageLoad;

            // If forced, clear classes to trigger re-animation
            if (isForced) {
                backgroundPhoto.style.opacity = '0';
                if (topSection) topSection.classList.remove('loaded');
                if (bottomSection) bottomSection.classList.remove('loaded');
            }

            // Set the sources
            const newSrc = thumbDataUri || optimizedThumbUrl || highResUrl;
            backgroundPhoto.src = newSrc;
            photoAnchor.href = highResUrl || optimizedThumbUrl;
            backgroundPhoto.alt = `Photo by ${photo.user.name || 'Unknown'}`;

            // Handle the case where the image is already cached and onload might not fire
            if (backgroundPhoto.complete) {
                handleImageLoad();
            }
        } else {
            hideLoadingOverlay();
        }

        // Notify background to cycle cache for NEXT tab
        if (!isForced) {
            chrome.runtime.sendMessage({ action: "getUnsplashPhoto" }).catch(() => {});
        }

        const userProfileUrl = `${photo.user.links.html}?utm_source=Unsplash%20Instant%20Reborn&utm_medium=referral`;
        const photoPageUrl = `${photo.links.html}?utm_source=Unsplash%20Instant%20Reborn&utm_medium=referral`;

        if (unsplashLogoLink) unsplashLogoLink.href = photoPageUrl;
        
        // Add to history
        addToHistory({
            id: photo.id,
            thumb: photo.urls.thumb,
            url: photoPageUrl,
            photographer: photo.user.name,
            timestamp: Date.now()
        });

        if (photographerProfileLink) photographerProfileLink.href = userProfileUrl;
        if (photographerAvatar) {
            photographerAvatar.src = photo.user.profile_image.medium;
            photographerAvatar.alt = photo.user.name || 'Photographer Avatar';
        }
        if (photographerNameLink) {
            photographerNameLink.href = userProfileUrl;
            if (photographerName) photographerName.textContent = photo.user.name || 'Unknown Photographer';
        }
        if (photographerLocationLink && photographerLocation) {
            if (photo.user.location) {
                photographerLocation.textContent = photo.user.location;
                photographerLocationLink.href = userProfileUrl;
                photographerLocationLink.style.display = 'block';
            } else {
                photographerLocationLink.style.display = 'none';
            }
        }

        const exif = photo.exif;
        let hasExifData = false;
        if (exif) {
            if (exif.make || exif.model) {
                exifCamera.textContent = `${exif.make || ''} ${exif.model || ''}`.trim();
                hasExifData = true;
            }
            if (exif.exposure_time) {
                exifShutter.textContent = `${exif.exposure_time}s`;
                hasExifData = true;
            }
            if (exif.aperture) {
                exifAperture.textContent = `ƒ/${exif.aperture}`;
                hasExifData = true;
            }
            if (exif.iso) {
                exifIso.textContent = `ISO ${exif.iso}`;
                hasExifData = true;
            }
            if (exif.focal_length) {
                exifFocalLength.textContent = `${exif.focal_length}mm`;
                hasExifData = true;
            }
        }

        if (bottomRightExif) {
            bottomRightExif.classList.toggle('hidden', !hasExifData);
            bottomRightExif.classList.toggle('loaded', hasExifData);
        }
    }

    async function addToHistory(photoMetadata) {
        try {
            const result = await chrome.storage.local.get('photoHistory');
            let history = result.photoHistory || [];
            
            // Remove if already exists (bring to top)
            history = history.filter(item => item.id !== photoMetadata.id);
            
            // Add to top
            history.unshift(photoMetadata);
            
            // Limit to 20
            history = history.slice(0, 20);
            
            await chrome.storage.local.set({ photoHistory: history });
        } catch (e) {
            console.error("Failed to update history", e);
        }
    }

    async function renderHistory() {
        if (!historyItemsContainer) return;
        
        try {
            const result = await chrome.storage.local.get('photoHistory');
            const history = result.photoHistory || [];
            
            if (history.length === 0) {
                historyItemsContainer.innerHTML = '<p style="grid-column: span 2; text-align: center; opacity: 0.5; padding: 20px;">No history yet.</p>';
                return;
            }
            
            historyItemsContainer.innerHTML = history.map(item => `
                <div class="history-item" data-url="${item.url}">
                    <img src="${item.thumb}" alt="Photo by ${item.photographer}">
                    <div class="history-info">${item.photographer}</div>
                </div>
            `).join('');
            
            // Add click listeners to history items
            historyItemsContainer.querySelectorAll('.history-item').forEach(item => {
                item.addEventListener('click', () => {
                    window.open(item.dataset.url, '_blank');
                });
            });
        } catch (e) {
            console.error("Failed to render history", e);
        }
    }

    function toggleHistoryPanel() {
        if (!historyPanel) return;
        const isHidden = historyPanel.classList.contains('hidden');
        if (isHidden) {
            renderHistory();
            historyPanel.classList.remove('hidden');
        } else {
            historyPanel.classList.add('hidden');
        }
    }

    if (historyButton) {
        historyButton.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleHistoryPanel();
        });
    }

    if (refreshButton) {
        refreshButton.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
                showLoadingOverlay('Fetching new photo...');
                if (historyPanel) historyPanel.classList.add('hidden');
                
                // Wait for background to fetch and CACHE the new photo
                const response = await chrome.runtime.sendMessage({ action: "forceRefreshPhoto" });
                
                if (response && response.photo) {
                    // Workaround: Reload the entire page to pull the now-cached fresh photo
                    window.location.reload();
                } else if (response && response.error) {
                    showGlobalError(response.error);
                }
            } catch (error) {
                showGlobalError("Refresh failed.");
            }
        });
    }

    if (closeHistory) {
        closeHistory.addEventListener('click', () => {
            historyPanel.classList.add('hidden');
        });
    }

    // Close panel when clicking outside
    document.addEventListener('click', (e) => {
        if (historyPanel && !historyPanel.classList.contains('hidden') && 
            !historyPanel.contains(e.target) && !historyButton.contains(e.target)) {
            historyPanel.classList.add('hidden');
        }
    });

    async function fetchPhotoWithRetry(retries = 3, force = false) {
        for (let i = 0; i < retries; i++) {
            try {
                showLoadingOverlay(force ? 'Fetching new photo...' : 'Loading photo...');
                const action = force ? "forceRefreshPhoto" : "getUnsplashPhoto";
                const response = await chrome.runtime.sendMessage({ action: action });
                if (response && response.photo) {
                    displayPhoto(response, force);
                    return;
                }
                if (response && response.error) {
                    showGlobalError(response.error);
                    return;
                }
            } catch (error) {
                if (i === retries - 1) showGlobalError("Connection failed.");
            }
        }
    }

    async function init() {
        try {
            // Priority 1: High-speed session storage (thumb pixels in RAM)
            const sessionResult = await chrome.storage.session.get('activePhoto');
            if (sessionResult.activePhoto && sessionResult.activePhoto.photo) {
                displayPhoto(sessionResult.activePhoto, false);
                return;
            }
            // Priority 2: Local storage (metadata persistent on disk)
            const localResult = await chrome.storage.local.get('activeMetadata');
            if (localResult.activeMetadata && localResult.activeMetadata.photo) {
                displayPhoto(localResult.activeMetadata, false);
                return;
            }
        } catch (e) {}
        fetchPhotoWithRetry();
    }

    init();
});
