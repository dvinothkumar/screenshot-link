# System Patterns: Screenshot Link

*   **Architecture:** Chrome Extension (Manifest V3)
    *   **Background:** Service Worker (`background/index.js`) - Core logic, events, Drive API, communication.
    *   **Content Scripts:** (`content/index.js`, etc.) - Injected for in-page UI (Jcrop) & capture.
    *   **Options Page:** (`options/index.html/js`) - Configuration UI (Mithril.js, MDC Web).
    *   **Google Drive Integration:** `chrome.identity` (OAuth2), Google Drive REST API v3 (`fetch`).
*   **Key Technical Decisions:**
    *   Manifest V3.
    *   Google Drive as the sole storage/sharing backend.
    *   `chrome.identity` for OAuth2.
    *   Content scripts for page interaction.
    *   Jcrop for cropping UI.
    *   Mithril.js for options UI.
    *   Background script validation for Drive folder ID.
    *   Post-upload script injection into Drive tab.
