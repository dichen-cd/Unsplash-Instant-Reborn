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

    // References to section containers for hiding/showing during error
    const topSection = document.getElementById('top-section');
    const bottomSection = document.getElementById('bottom-section');

    // Create a global error overlay element once
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

    // Function to show the error overlay
    function showGlobalError(message = "Failed to load photo.") {
        if (backgroundPhoto) backgroundPhoto.style.opacity = '0'; // Fade out current photo
        if (topSection) topSection.style.display = 'none'; // Hide UI elements
        if (bottomSection) bottomSection.style.display = 'none';

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


    // Function to display the photo and attribution data
    function displayPhoto(photo) {
        if (!photo || !photo.urls || !photo.user) {
            console.error("Invalid photo data received:", photo);
            showGlobalError("Error: Invalid photo data received.");
            return;
        }

        // Hide any active error state
        hideGlobalError();

        // --- Photo itself ---
        if (backgroundPhoto) {
            // PRIORITIZE HIGHER RESOLUTION FOR SRC:
            // Use 'full' first, then fallback to 'raw', then 'regular'
            backgroundPhoto.src = photo.urls.full || photo.urls.raw || photo.urls.regular;

            // Construct srcset for responsiveness, prioritizing higher resolutions
            let srcset = '';
            // It's good to provide a `w` descriptor if available for raw/full
            if (photo.urls.raw) srcset += `${photo.urls.raw} ${photo.width || 2000}w, `; // Use photo.width if available
            if (photo.urls.full) srcset += `${photo.urls.full} 1920w, `; // Common assumption for 'full'
            if (photo.urls.regular) srcset += `${photo.urls.regular} 1080w, `;
            if (photo.urls.small) srcset += `${photo.urls.small} 400w`; // Last one, no comma

            // Remove trailing comma if any and set srcset
            backgroundPhoto.srcset = srcset.trim().endsWith(',') ? srcset.trim().slice(0, -1) : srcset.trim();
            backgroundPhoto.alt = `Photo by ${photo.user.name || 'Unknown'}`;
            backgroundPhoto.style.opacity = '1'; // Make photo visible (CSS transition handles fade-in)
        }

        // --- Top-Left Button (Unsplash Logo) ---
        if (unsplashLogoLink) {
            unsplashLogoLink.href = `${photo.links.html}?utm_source=Unsplash%20Instant%20Reborn&utm_medium=referral`;
            unsplashLogoLink.style.display = 'flex'; // Ensure visible (CSS handles animation)
        }

        // --- Top-Right Button (Download) ---
        if (downloadLink) {
            downloadLink.href = `${photo.links.download}?utm_source=Unsplash%20Instant%20Reborn&utm_medium=referral`;
            downloadLink.style.display = 'flex'; // Ensure visible (CSS handles animation)
        }

        // --- Bottom-Left Info (Photographer & Location) ---
        const userProfileUrl = `${photo.user.links.html}?utm_source=Unsplash%20Instant%20Reborn&utm_medium=referral`;

        if (photographerProfileLink) {
            photographerProfileLink.href = userProfileUrl;
        }
        if (photographerAvatar) {
            photographerAvatar.src = photo.user.profile_image.medium;
            photographerAvatar.alt = photo.user.name || 'Photographer Avatar';
        }
        if (photographerNameLink) {
            photographerNameLink.href = userProfileUrl;
        }
        if (photographerName) {
            photographerName.textContent = photo.user.name || 'Unknown Photographer';
        }

        if (photographerLocationLink && photographerLocation) {
            if (photo.user.location) {
                photographerLocation.textContent = photo.user.location;
                // It's common to link the location to the photographer's profile on Unsplash
                photographerLocationLink.href = userProfileUrl;
                photographerLocationLink.style.display = 'block'; // Show element
            } else {
                photographerLocationLink.style.display = 'none'; // Hide element if no location
            }
        }

        // Ensure top and bottom sections are visible
        if (topSection) topSection.style.display = 'flex';
        if (bottomSection) bottomSection.style.display = 'flex';
    }

    // Request photo from background script
    try {
        const response = await chrome.runtime.sendMessage({ action: "getUnsplashPhoto" });
        if (response && response.photo) {
            displayPhoto(response.photo);
        } else {
            console.error("Failed to get photo from background script or invalid response:", response);
            showGlobalError("Couldn't fetch photo data.");
        }
    } catch (error) {
        console.error("Error communicating with background script:", error);
        showGlobalError("Extension communication error. Ensure background script is running and your API key is valid.");
    }
});