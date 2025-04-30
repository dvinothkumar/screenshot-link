# Project Brief: Screenshot Link

*   **Project Name:** Screenshot Link (Chrome Extension)
*   **Goal:** Provide a simple, secure way to capture full-screen or cropped screenshots and instantly upload them to Google Drive, generating a shareable link.
*   **Core Requirements:**
    *   Capture visible screen area (`view` mode).
    *   Allow users to crop a specific area (`crop` mode).
    *   Upload captured PNG image to Google Drive.
    *   Set uploaded file permissions to "anyone with link can view".
    *   Open the uploaded file in a new tab.
    *   Provide a configurable keyboard shortcut.
    *   Allow users to specify a target Google Drive folder via URL.
    *   Secure Google Drive authentication using OAuth2 (`chrome.identity`).
    *   Minimal permissions required (`drive.file` scope).
    *   Open Source (MIT License).
