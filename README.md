# Unsplash Instant Reborn Chrome Extension

**A reimplementation of "Unsplash Instant" with full Manifest V3 support.**

**Note:** This extension has been primarily written and guided by an AI.


"Unsplash Instant Reborn" is a Chrome New Tab extension that replaces your default new tab page with stunning, high-quality, random background photos from Unsplash. You can customize your experience by configuring your own Unsplash API key and setting the image caching duration directly within the extension's options.


## Features:

* **Beautiful New Tab Backgrounds:** Enjoy a fresh, random Unsplash photo every time you open a new tab (based on your caching settings).
* **Photographer Attribution:** Clearly displays the photographer's name and avatar, with clickable links to their Unsplash profile.
* **Location Information:** Shows the photographer's location if available.
* **Direct Photo Download:** Easily download the current background photo directly from the new tab page.
* **Configurable API Key:** Use your own Unsplash API key for fetching images, giving you control and flexibility.
* **Configurable Cache Duration:** Set how long an image should be cached before a new one is fetched, helping to manage API requests.
* **First-Time Setup Prompt:** Automatically opens the options page on first installation to guide you through API key configuration.

## Installation (Developer Mode):

To install this extension in Chrome:

1.  **Download the Extension:**
    * Download the entire project folder (e.g., as a ZIP file) or clone the repository to your local machine.
    * Extract the ZIP file if necessary.

2.  **Open Chrome Extensions Page:**
    * Open your Chrome browser.
    * Type `chrome://extensions` into the address bar and press Enter.

3.  **Enable Developer Mode:**
    * In the top-right corner of the Extensions page, toggle the **"Developer mode"** switch to **ON**.

4.  **Load the Extension:**
    * Click the **"Load unpacked"** button that appears.
    * Navigate to and select the root folder of the downloaded extension (the folder containing `manifest.json`, `newtab.html`, `background.js`, `icons`, etc.).
    * Click **"Select Folder"**.

The extension should now be loaded and active!

## Configuration:

Before the extension can fetch images, you need to configure your Unsplash API Key.

1.  **Access Options Page:**
    * **On First Install:** The options page should automatically open in a new tab immediately after installation.
    * **Anytime:** Go to `chrome://extensions`, find "Unsplash Instant Reborn," click **"Details,"** and then click **"Extension options."**

2.  **Obtain Unsplash API Key:**
    * On the options page, follow the instructions provided under "How to get your Unsplash API Key." This involves visiting the [Unsplash Developers website](https://unsplash.com/developers), creating an application, and copying your "Access Key."

3.  **Enter Settings:**
    * Paste your **Unsplash Access Key** into the "Unsplash API Key" field.
    * Enter your desired **Cache Duration** (in minutes) for how long an image should be displayed before a new one is fetched. (Recommended: 5 minutes or more to respect Unsplash API limits).

4.  **Save Settings:**
    * Click the **"Save Settings"** button.

5.  **Reload Chrome (Important!):**
    * After saving, it's recommended to reload any open new tab pages or restart your Chrome browser for the changes to fully take effect in the background service worker.

## Credits & Attribution:

* Images are provided by **Unsplash**. All photos are copyright their respective photographers.
* This extension utilizes the **Unsplash API**.

## License:

This project is open-source and available under the [MIT License](LICENSE).

## Troubleshooting:

* **Images not loading?**
    * Ensure you have configured your Unsplash API Key correctly in the extension options.
    * Check your internet connection.
    * Reload the new tab page or restart Chrome.
    * Check the browser's developer console (right-click on new tab, select "Inspect," go to "Console" tab) for any error messages.
* **API Key issues?**
    * Double-check that you copied the "Access Key" correctly from your Unsplash app.
    * Ensure your Unsplash app has not exceeded its API limits.