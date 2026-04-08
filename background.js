// background.js - Minimal lifecycle handler
chrome.runtime.onInstalled.addListener((details) => {
    // Open options page on install or manual reload
    chrome.runtime.openOptionsPage();
});
