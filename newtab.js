// newtab.js

document.addEventListener('DOMContentLoaded', () => {
    const backgroundPhoto = document.getElementById('background-photo');
    const photographerName = document.getElementById('photographer-name');
    // const unsplashLink = document.getElementById('unsplash-link'); // This one might not be needed anymore if using new links
    const photoContainer = document.getElementById('photo-container');
    const photographerAvatar = document.getElementById('photographer-avatar');
    const unsplashLogoLink = document.getElementById('unsplash-logo-link');
    const downloadLink = document.getElementById('download-link');
    const photographerProfileLink = document.getElementById('photographer-profile-link'); // Link for avatar wrapper
    const photographerNameLink = document.getElementById('photographer-name-link'); // Link for photographer name text
    const photographerLocation = document.getElementById('photographer-location');

    // Show a loading state or placeholder initially
    backgroundPhoto.style.opacity = '0'; // Hide until loaded

    // Request photo from service worker
    chrome.runtime.sendMessage({ action: "getUnsplashPhoto" }, (response) => {
        if (response && response.photo) {
            const photo = response.photo;
            console.log("Displaying photo:", photo);

            // Construct srcset from various URLs
            const srcset = `
                ${photo.urls.thumb} 200w,
                ${photo.urls.small} 400w,
                ${photo.urls.regular} 1080w,
                ${photo.urls.full} 1920w,
                ${photo.urls.raw} 2400w
            `.trim().replace(/\s+/g, ' '); // Clean up whitespace

            // Preload the image
            const img = new Image();
            img.onload = () => {
                backgroundPhoto.src = photo.urls.regular; // Use regular as a base src for initial load
                backgroundPhoto.srcset = srcset;
                backgroundPhoto.sizes = '100vw'; // Image will take 100% of viewport width
                backgroundPhoto.alt = `Photo by ${photo.user.name} on Unsplash`;

                // Set photographer details
                photographerName.textContent = photo.user.name;
                // Correct: Set avatar image source
                photographerAvatar.src = photo.user.profile_image.medium;
                photographerAvatar.alt = `${photo.user.name}'s avatar`;

                // Set links
                unsplashLogoLink.href = photo.links.html; // Link logo to current photo page
                downloadLink.href = photo.links.download; // Use the specific download link

                // Correct: Set the href for the photographer's profile link (both avatar and name)
                photographerProfileLink.href = photo.user.links.html;
                photographerNameLink.href = photo.user.links.html;

                if (photo.user.location) {
                    photographerLocation.textContent = photo.user.location;
                    // It's common for location text not to be a direct link unless it's a specific map query
                    // For now, keeping it as just text. If you want a Google Maps link:
                    // photographerLocation.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(photo.user.location)}`;
                    // Don't set href if you don't want it to be a link.
                } else {
                    photographerLocation.textContent = ''; // Hide if no location
                    photographerLocation.style.display = 'none'; // Ensure element is hidden
                }

                backgroundPhoto.style.opacity = '1'; // Fade in the image
                photoContainer.style.backgroundColor = 'transparent'; // Remove fallback background
            };
            img.onerror = () => {
                console.error("Failed to load image:", photo.urls.raw);
                // Fallback to a solid color or default image
                backgroundPhoto.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQwIiBoZWlnaHQ9IjM2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjM2MCIgZmlsbD0iIzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMjRweCIgZmlsbD0iI2ZmZiI+RXJyb3IgTG9hZGluZyBQGhvdG88L2h0ZXh0Pjwvc3ZnPg=='; // Placeholder SVG
                backgroundPhoto.style.opacity = '1';
                // Also hide buttons if no image loads
                unsplashLogoLink.style.display = 'none';
                downloadLink.style.display = 'none';
                photographerProfileLink.style.display = 'none';
                photographerNameLink.style.display = 'none';
                photographerLocation.style.display = 'none';
            };
            img.src = photo.urls.raw; // Start loading the image (or regular for faster initial display)
        } else {
            console.error("No photo data received from service worker.");
            // Display an error message or a default image
            backgroundPhoto.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQwIiBoZWlnaHQ9IjM2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjM2MCIgZmlsbD0iIzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMjRweCIgZmlsbD0iI2ZmZiI+RXJyb3IgTG9hZGluZyBQGhvdG88L2h0ZXh0Pjwvc3ZnPg=='; // Placeholder SVG
            backgroundPhoto.style.opacity = '1';
            // Hide control elements if no photo loads
            unsplashLogoLink.style.display = 'none';
            downloadLink.style.display = 'none';
            photographerProfileLink.style.display = 'none';
            photographerNameLink.style.display = 'none';
            photographerLocation.style.display = 'none';
        }
    });
});