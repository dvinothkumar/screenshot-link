# Technical Context: Screenshot Link

*   **Languages:** JavaScript
*   **Platform:** Chrome Extension API (Manifest V3)
*   **Key APIs:** `chrome.storage.sync`, `chrome.scripting`, `chrome.action`, `chrome.commands`, `chrome.tabs`, `chrome.runtime`, `chrome.identity`, Google Drive API v3 (`fetch`).
*   **Libraries/Frameworks:** jQuery, Jcrop, Mithril.js, Material Design Components Web, Bootstrap Grid (all vendored).
*   **Build Process:** Simple shell scripts (`build/package.sh`, library-specific build scripts).
*   **Constraints:** Chrome Extension security limitations, requires user Drive permission (`drive.file` scope), dependency on Google Drive API, Manifest V3 lifecycle.
