// newtab.js

document.addEventListener('DOMContentLoaded', async () => {
    // Get references to all HTML elements
    const backgroundPhoto = document.getElementById('background-photo');
    const unsplashLogoLink = document.getElementById('unsplash-logo-link');
    const downloadLink = document.getElementById('download-link');

    const photographerProfileLink = document.getElementById('photographer-profile-link');
    const photographerAvatar = document.getElementById('photographer-avatar');
    const photographerNameLink = document.getElementById('photographer-name-link');
    const photographerName = document.getElementById('photographer-name');
    const photographerLocationLink = document.getElementById('photographer-location-link');
    const photographerLocation = document.getElementById('photographer-location');

    // References to section containers for hiding/showing during error and for fade-in
    const photoContainer = document.getElementById('photo-container'); // Used for error display
    const topSection = document.getElementById('top-section');
    const bottomSection = document.getElementById('bottom-section');

    // NEW references for the loading overlay elements
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingMainText = document.getElementById('loading-main-text');
    const loadingSubText = document.getElementById('loading-sub-text');

    // NEW references for EXIF elements
    const bottomRightExif = document.getElementById('bottom-right-exif');
    const exifCamera = document.getElementById('exif-camera');
    const exifShutter = document.getElementById('exif-shutter');
    const exifAperture = document.getElementById('exif-aperture');
    const exifIso = document.getElementById('exif-iso');
    const exifFocalLength = document.getElementById('exif-focal-length');


    // Store the currently active Blob URLs to revoke them when a new image loads
    let currentHighResBlobUrl = null;
    let currentLowResBlobUrl = null;

    // Create a global error overlay element once (your existing code)
    const errorOverlay = document.createElement('div');
    errorOverlay.id = 'error-overlay';
    errorOverlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.9);
        color: #fff;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        text-align: center;
        z-index: 1000;
        font-family: inherit; /* Inherit font from body */
        padding: 20px;
        box-sizing: border-box;
        opacity: 0; /* Hidden by default, will fade in */
        transition: opacity 0.5s ease-in-out;
        pointer-events: none; /* Allow clicks to pass through when hidden */
    `;
    errorOverlay.innerHTML = `
        <p style="font-size: 1.5em; font-weight: bold; margin-bottom: 20px;">Oops! Something went wrong.</p>
        <p style="font-size: 1.1em; line-height: 1.6;">Failed to load a new Unsplash photo.</p>
        <p style="font-size: 1.1em; line-height: 1.6; margin-top: 10px;">Please ensure your Unsplash API Key is correctly set in your <a href="chrome://extensions/?id=${chrome.runtime.id}" target="_blank" style="color: #007bff; text-decoration: underline;">extension options</a>.</p>
        <p style="font-size: 1.1em; line-height: 1.6; margin-top: 20px;">If the key is correct, try refreshing the page or check your internet connection.</p>
    `;
    document.body.appendChild(errorOverlay);

    // Function to show the loading overlay
    function showLoadingOverlay(mainText, subText = '') {
        if (loadingOverlay) {
            loadingMainText.textContent = mainText;
            loadingSubText.textContent = subText;
            loadingOverlay.classList.remove('hidden'); // Make it visible
            loadingOverlay.style.opacity = '1';
        }
    }

    // Function to hide the loading overlay
    function hideLoadingOverlay() {
        if (loadingOverlay) {
            loadingOverlay.style.opacity = '0';
            setTimeout(() => {
                loadingOverlay.classList.add('hidden'); // Hide after transition
            }, 500); // Matches CSS transition duration
        }
    }


    // Function to show the error overlay
    function showGlobalError(message = "Failed to load photo.") {
        // Hide loading overlay if it's still visible
        hideLoadingOverlay();

        if (backgroundPhoto) backgroundPhoto.style.opacity = '0'; // Fade out current photo
        if (topSection) topSection.classList.remove('loaded'); // Hide UI elements
        if (bottomSection) bottomSection.classList.remove('loaded');

        if (errorOverlay) {
            errorOverlay.querySelector('p:first-child').textContent = message;
            errorOverlay.style.display = 'flex'; // Make it visible
            errorOverlay.style.opacity = '1';
            errorOverlay.style.pointerEvents = 'auto'; // Enable clicks on links within
        }
    }

    // Function to hide the error overlay
    function hideGlobalError() {
        if (errorOverlay) {
            errorOverlay.style.opacity = '0';
            errorOverlay.style.pointerEvents = 'none';
            // Using a timeout to truly hide after transition completes
            setTimeout(() => {
                errorOverlay.style.display = 'none';
            }, 500); // Matches CSS transition duration
        }
    }

    // Helper function to create a Blob URL from an ArrayBuffer
    function createBlobUrlFromArrayBuffer(arrayBuffer, mimeType = 'image/webp') {
        if (!arrayBuffer) return null;
        const blob = new Blob([arrayBuffer], { type: mimeType });
        return URL.createObjectURL(blob);
    }

    // Helper function to reconstruct WebP URL for srcset (since Blob URLs aren't suitable for srcset)
    // This is primarily for the browser's internal resolution picking based on original URLs
    function getWebpUrl(originalUrl) {
        if (!originalUrl) return '';
        return `${originalUrl}&fm=webp`;
    }

    // Function to display the photo and attribution data
    // This now expects the full cached data object from background.js
    function displayPhoto(cachedPhotoData) {
        hideLoadingOverlay(); // Hide loading overlay when photo is ready to display
        hideGlobalError(); // Also hide any active error state

        const photo = cachedPhotoData.photo;
        const highResArrayBuffer = cachedPhotoData.highResArrayBuffer; // Now an ArrayBuffer
        const lowResArrayBuffer = cachedPhotoData.lowResArrayBuffer;   // Now an ArrayBuffer

        if (!photo || (!highResArrayBuffer && !lowResArrayBuffer)) {
            console.error("Invalid photo data or missing image data ArrayBuffers received:", cachedPhotoData);
            showGlobalError("Error: Image data not found or invalid.");
            return;
        }

        // Revoke previously created Blob URLs to prevent memory leaks
        if (currentHighResBlobUrl) {
            URL.revokeObjectURL(currentHighResBlobUrl);
            currentHighResBlobUrl = null;
        }
        if (currentLowResBlobUrl) {
            URL.revokeObjectURL(currentLowResBlobUrl);
            currentLowResBlobUrl = null;
        }

        // --- Photo itself ---
        if (backgroundPhoto) {
            // Create Blob URLs from the received ArrayBuffers
            const tempLowResBlobUrl = createBlobUrlFromArrayBuffer(lowResArrayBuffer);
            const tempHighResBlobUrl = createBlobUrlFromArrayBuffer(highResArrayBuffer);

            if (tempLowResBlobUrl) {
                backgroundPhoto.src = tempLowResBlobUrl;
                backgroundPhoto.classList.add('loading'); // Add class for blur
                backgroundPhoto.alt = `Photo by ${photo.user.name || 'Unknown'}`;
                currentLowResBlobUrl = tempLowResBlobUrl; // Store for revocation

                // After a tiny delay (to allow low-res to render), swap to high-res
                if (tempHighResBlobUrl) {
                    setTimeout(() => {
                        backgroundPhoto.src = tempHighResBlobUrl;
                        backgroundPhoto.classList.remove('loading'); // Remove blur
                        currentHighResBlobUrl = tempHighResBlobUrl; // Store for revocation
                    }, 100); // A small delay (e.g., 100ms) for perceived progressive load
                } else {
                    // If only low-res is available (e.g., high-res fetch failed)
                    backgroundPhoto.classList.remove('loading'); // Still unblur the low-res
                }
            } else if (tempHighResBlobUrl) {
                // Fallback: if somehow only high-res ArrayBuffer is available, use it directly
                backgroundPhoto.src = tempHighResBlobUrl;
                backgroundPhoto.classList.remove('loading');
                backgroundPhoto.alt = `Photo by ${photo.user.name || 'Unknown'}`;
                currentHighResBlobUrl = tempHighResBlobUrl; // Store for revocation
            } else {
                // Should not happen if previous checks pass, but for safety
                console.warn("No image ArrayBuffers found to display.");
                showGlobalError("Failed to display image from cache.");
                return;
            }

            // Build srcset using the *original* WebP URLs from Unsplash (not Blob URLs).
            // This is mostly for completeness or if browser heuristics ever try to use it,
            // though with src already set from Blob, it's less critical for performance.
            let srcset = '';
            if (photo.urls.raw) srcset += `${getWebpUrl(photo.urls.raw)} ${photo.width || 2000}w, `;
            if (photo.urls.full) srcset += `${getWebpUrl(photo.urls.full)} 1920w, `;
            if (photo.urls.regular) srcset += `${getWebpUrl(photo.urls.regular)} 1080w, `;
            if (photo.urls.small) srcset += `${getWebpUrl(photo.urls.small)} 400w`;
            backgroundPhoto.srcset = srcset.trim().endsWith(',') ? srcset.trim().slice(0, -1) : srcset.trim();

            // Fade in UI elements after image is set (even if blurred initially)
            if (topSection) topSection.classList.add('loaded');
            if (bottomSection) bottomSection.classList.add('loaded');
        }

        // --- Other UI Elements (set these regardless of image load phase) ---
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
                photographerLocationLink.href = userProfileUrl; // Link to photographer's profile for location
                photographerLocationLink.style.display = 'block'; // Show element
            } else {
                photographerLocationLink.style.display = 'none'; // Hide element if no location
            }
        }

        // --- Display EXIF information ---
        const exif = photo.exif;
        let hasExifData = false;

        // Clear previous values
        exifCamera.textContent = '';
        exifShutter.textContent = '';
        exifAperture.textContent = '';
        exifIso.textContent = '';
        exifFocalLength.textContent = '';
        
        if (exif) {
            if (exif.make || exif.model) {
                const cameraMake = exif.make || '';
                const cameraModel = exif.model || '';
                exifCamera.textContent = `${cameraMake} ${cameraModel}`.trim();
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
            if (hasExifData) {
                bottomRightExif.classList.remove('hidden');
                bottomRightExif.classList.add('loaded'); // For fade-in if you add CSS for .loaded
            } else {
                bottomRightExif.classList.add('hidden');
                bottomRightExif.classList.remove('loaded');
            }
        }
    }

    // NEW: Function to fetch photo with retry logic
    async function fetchPhotoWithRetry(retries = 3, initialDelay = 500) { // Try up to 3 times, with 0.5s delay
        for (let i = 0; i < retries; i++) {
            try {
                // Show a generic loading message initially or indicate retry
                if (i === 0) {
                    showLoadingOverlay('Loading photo...');
                } else {
                    showLoadingOverlay(`Retrying to load photo (${i+1}/${retries})...`, 'The background service might be waking up.');
                }

                // Wait a short delay before sending the message on retries
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, initialDelay * i)); // Exponential backoff for delay
                }

                const response = await chrome.runtime.sendMessage({ action: "getUnsplashPhoto" });
                
                if (response && (response.photo || response.error)) {
                    // Update loading message if it's the first network fetch (not from cache)
                    if (response.isInitialNetworkFetch) {
                        showLoadingOverlay(
                            'Downloading fresh image...',
                            'If this takes a while, please check your API key in extension options.'
                        );
                        // The loading overlay will be hidden by displayPhoto() or showGlobalError()
                    } else {
                        // Image came from cache, hide loading message immediately as it's fast
                        hideLoadingOverlay();
                    }

                    if (response.photo && (response.highResArrayBuffer || response.lowResArrayBuffer)) {
                        displayPhoto(response); // Pass the entire response object (which is cachedPhotoData)
                        return; // Success, exit the retry loop
                    } else if (response.error) {
                        showGlobalError(response.error);
                        return; // An error was explicitly returned, show it and stop retrying
                    } else {
                        // This case should ideally not happen if response.error isn't set,
                        // but indicates an incomplete or unexpected successful response.
                        console.error("Received incomplete or unexpected photo data from background script, attempting retry:", response);
                        throw new Error("Incomplete data received."); // Trigger a retry
                    }
                } else {
                    // This 'else' block means 'response' was null or undefined,
                    // which can happen if the background script is still initializing
                    // or if there's a deeper communication issue.
                    console.warn("No response or invalid structure from background script, attempting retry:", response);
                    throw new Error("No response from background script."); // Trigger a retry
                }
            } catch (error) {
                console.warn(`Attempt ${i + 1} failed to communicate with background script:`, error);
                if (i === retries - 1) {
                    // Last retry failed, show a final error message
                    showGlobalError("Could not retrieve photo data. The extension's background service might be unresponsive. Try refreshing manually if the problem persists.");
                }
                // If not the last retry, the loop will continue after the delay
            }
        }
    }

    // Initiate the photo fetch process with retries when the DOM is loaded
    fetchPhotoWithRetry();
});