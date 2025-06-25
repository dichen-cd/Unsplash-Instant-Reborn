// newtab.js

document.addEventListener('DOMContentLoaded', async () => {
    // Get references to all HTML elements
    const backgroundPhoto = document.getElementById('background-photo');
    // ADDED: Get a reference to the new anchor tag
    const photoAnchor = document.getElementById('photo-anchor');
    const unsplashLogoLink = document.getElementById('unsplash-logo-link');
    const downloadLink = document.getElementById('download-link');

    const photographerProfileLink = document.getElementById('photographer-profile-link');
    const photographerAvatar = document.getElementById('photographer-avatar');
    const photographerNameLink = document.getElementById('photographer-name-link');
    const photographerName = document.getElementById('photographer-name');
    const photographerLocationLink = document.getElementById('photographer-location-link');
    const photographerLocation = document.getElementById('photographer-location');

    // References to section containers
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

    // Store the currently active Blob URLs to revoke them when a new image loads
    let currentHighResUrl = null;
    let currentLowResUrl = null;

    // Create a global error overlay element (code unchanged)
    const errorOverlay = document.createElement('div');
    errorOverlay.id = 'error-overlay';
    errorOverlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.9); color: #fff; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; z-index: 1000; font-family: inherit; padding: 20px; box-sizing: border-box; opacity: 0; transition: opacity 0.5s ease-in-out; pointer-events: none;`;
    errorOverlay.innerHTML = `<p style="font-size: 1.5em; font-weight: bold; margin-bottom: 20px;">Oops! Something went wrong.</p><p style="font-size: 1.1em; line-height: 1.6;">Failed to load a new Unsplash photo.</p><p style="font-size: 1.1em; line-height: 1.6; margin-top: 10px;">Please ensure your Unsplash API Key is correctly set in your <a href="chrome://extensions/?id=${chrome.runtime.id}" target="_blank" style="color: #007bff; text-decoration: underline;">extension options</a>.</p><p style="font-size: 1.1em; line-height: 1.6; margin-top: 20px;">If the key is correct, try refreshing the page or check your internet connection.</p>`;
    document.body.appendChild(errorOverlay);

    // --- All functions for showing/hiding overlays remain the same ---
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
            setTimeout(() => {
                loadingOverlay.classList.add('hidden');
            }, 500);
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
            setTimeout(() => {
                errorOverlay.style.display = 'none';
            }, 500);
        }
    }

    // FIXED: Updated helper function to use correct MIME type
    function createBlobUrlFromArrayBuffer(arrayBuffer, mimeType = 'image/webp') {
        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
            console.error("ArrayBuffer is empty or null");
            return null;
        }
        try {
            const blob = new Blob([arrayBuffer], { type: mimeType });
            const url = URL.createObjectURL(blob);
            console.log(`Created blob URL with MIME type: ${mimeType}, size: ${arrayBuffer.byteLength} bytes`);
            return url;
        } catch (e) {
            console.error("Error creating Blob URL from ArrayBuffer:", e);
            return null;
        }
    }

    // Helper for srcset remains the same
    function getWebpUrl(originalUrl) {
        if (!originalUrl) return '';
        return `${originalUrl}&fm=webp`;
    }

    // ====================================================================
    // MODIFIED: displayPhoto function simplified for progressive-image.js
    // ====================================================================
    function displayPhoto(cachedPhotoData) {
        hideLoadingOverlay();
        hideGlobalError();

        const photo = cachedPhotoData.photo;
        const highResArrayBuffer = cachedPhotoData.highResArrayBuffer;
        const lowResArrayBuffer = cachedPhotoData.lowResArrayBuffer;
        const highResMimeType = cachedPhotoData.highResMimeType || 'image/webp';
        const lowResMimeType = cachedPhotoData.lowResMimeType || 'image/webp';

        console.log("Received photo data with MIME types:", { highResMimeType, lowResMimeType });

        if (!photo || (!highResArrayBuffer && !lowResArrayBuffer)) {
            console.error("Invalid photo data or missing image ArrayBuffers received:", cachedPhotoData);
            showGlobalError("Error: Image data not found or invalid.");
            return;
        }

        // Revoke previous blob URLs to prevent memory leaks
        if (currentHighResUrl) URL.revokeObjectURL(currentHighResUrl);
        if (currentLowResUrl) URL.revokeObjectURL(currentLowResUrl);

        if (photoAnchor && backgroundPhoto) {
            // Create new blob URLs from the array buffers
            const tempLowResUrl = lowResArrayBuffer ? createBlobUrlFromArrayBuffer(lowResArrayBuffer, lowResMimeType) : null;
            const tempHighResUrl = highResArrayBuffer ? createBlobUrlFromArrayBuffer(highResArrayBuffer, highResMimeType) : null;

            // Ensure we have URLs to work with
            if (!tempLowResUrl && !tempHighResUrl) {
                showGlobalError("Failed to create image URLs from data.");
                return;
            }
            
            // The library uses the anchor's href for the high-res image
            // and the image's src for the low-res preview.
            // Fallback to whichever is available if one is missing.
            photoAnchor.href = tempHighResUrl || tempLowResUrl;
            backgroundPhoto.src = tempLowResUrl || tempHighResUrl;

            // Store the new blob URLs so they can be revoked on the next load
            currentLowResUrl = tempLowResUrl;
            currentHighResUrl = tempHighResUrl;

            // The library will now handle the progressive loading.
            // We can continue to set other attributes as before.

            backgroundPhoto.alt = `Photo by ${photo.user.name || 'Unknown'}`;

            let srcset = '';
            if (photo.urls.raw) srcset += `${getWebpUrl(photo.urls.raw)} ${photo.width || 2000}w, `;
            if (photo.urls.full) srcset += `${getWebpUrl(photo.urls.full)} 1920w, `;
            if (photo.urls.regular) srcset += `${getWebpUrl(photo.urls.regular)} 1080w, `;
            if (photo.urls.small) srcset += `${getWebpUrl(photo.urls.small)} 400w`;
            backgroundPhoto.srcset = srcset.trim().endsWith(',') ? srcset.trim().slice(0, -1) : srcset.trim();

            if (topSection) topSection.classList.add('loaded');
            if (bottomSection) bottomSection.classList.add('loaded');
        }

        // --- All other UI element updates remain the same ---
        const userProfileUrl = `${photo.user.links.html}?utm_source=Unsplash%20Instant%20Reborn&utm_medium=referral`;
        const photoPageUrl = `${photo.links.html}?utm_source=Unsplash%20Instant%20Reborn&utm_medium=referral`;
        const downloadPhotoUrl = `${photo.links.download}?utm_source=Unsplash%20Instant%20Reborn&utm_medium=referral`;

        if (unsplashLogoLink) unsplashLogoLink.href = photoPageUrl;
        if (downloadLink) downloadLink.href = downloadPhotoUrl;
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
        if (exifCamera) exifCamera.textContent = '';
        if (exifShutter) exifShutter.textContent = '';
        if (exifAperture) exifAperture.textContent = '';
        if (exifIso) exifIso.textContent = '';
        if (exifFocalLength) exifFocalLength.textContent = '';

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

    // Updated fetch logic to log more information about the response
    async function fetchPhotoWithRetry(retries = 3, initialDelay = 500) {
        for (let i = 0; i < retries; i++) {
            try {
                if (i === 0) {
                    showLoadingOverlay('Loading photo...');
                } else {
                    showLoadingOverlay(`Retrying to load photo (${i + 1}/${retries})...`, 'The background service might be waking up.');
                }
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, initialDelay * i));
                }

                const response = await chrome.runtime.sendMessage({ action: "getUnsplashPhoto" });

                console.log("Received response from background:", {
                    hasPhoto: !!response?.photo,
                    hasHighRes: !!response?.highResArrayBuffer,
                    highResSize: response?.highResArrayBuffer?.byteLength || 0,
                    hasLowRes: !!response?.lowResArrayBuffer,
                    lowResSize: response?.lowResArrayBuffer?.byteLength || 0,
                    highResMimeType: response?.highResMimeType,
                    lowResMimeType: response?.lowResMimeType
                });

                if (response && response.photo && (response.highResArrayBuffer || response.lowResArrayBuffer)) {
                    displayPhoto(response);
                    return;
                }

                if (response && response.error) {
                    showGlobalError(response.error);
                    return;
                }

                throw new Error("Invalid or empty response from background script.");

            } catch (error) {
                console.warn(`Attempt ${i + 1} failed:`, error.message);
                if (i === retries - 1) {
                    showGlobalError("Could not connect to the extension's background service. Please try refreshing the page.");
                }
            }
        }
    }

    fetchPhotoWithRetry();

});