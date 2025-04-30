console.log("Background script starting..."); // Add log

// --- Default Settings ---
var defaults = {
  method: 'view', // Changed default to full screen capture
  format: 'png', // Only option now
  // quality: 100, // Removed quality setting
  // scaling: true, // Removed
  save: 'drive', // Default to 'drive' as it's the only option
  // clipboard: 'url', // Removed - defaults to binary implicitly
  // dialog: true, // Removed
  // icon: 'default', // Removed icon setting
  driveCopyLink: false // Default for the copy link setting (though UI removed)
}

// --- Initialization ---
chrome.storage.sync.get((store) => {
  var config = {}
  // Ensure all defaults are present
  Object.assign(config, defaults, JSON.parse(JSON.stringify(store)))

  // Removed migration logic for 'save' as 'drive' is the only option
  config.save = 'drive'; // Ensure save is always 'drive'
  // Ensure format is always 'png'
  config.format = 'png';
  // Remove quality if it exists from old config (already done by delete below)
  delete config.quality; // Ensure quality is removed

  // Removed scaling migration
  // if (config.dpr !== undefined) {
  //   config.scaling = config.dpr
  //   delete config.dpr
  // }
  // Removed icon migration/setting logic
  delete config.icon; // Remove icon setting if it exists
  chrome.storage.sync.set(config) // Save cleaned config

  // Removed chrome.action.setIcon call (icons now set in manifest)
})

// --- Content Script Injection ---
function inject (tab) {
  console.log(`Injecting scripts into tab ${tab.id}`);
  // Inject CSS (safe to run multiple times)
  chrome.scripting.insertCSS({files: ['vendor/jquery.Jcrop.min.css'], target: {tabId: tab.id}})
    .catch(err => console.warn('Error injecting Jcrop CSS:', err));
  chrome.scripting.insertCSS({files: ['content/index.css'], target: {tabId: tab.id}})
     .catch(err => console.warn('Error injecting index CSS:', err));

  // Inject JS scripts sequentially
  chrome.scripting.executeScript({files: ['vendor/jquery.min.js'], target: {tabId: tab.id}})
    .then(() => chrome.scripting.executeScript({files: ['vendor/jquery.Jcrop.min.js'], target: {tabId: tab.id}}))
    .then(() => chrome.scripting.executeScript({files: ['content/crop.js'], target: {tabId: tab.id}}))
    .then(() => chrome.scripting.executeScript({files: ['content/index.js'], target: {tabId: tab.id}}))
    .then((injectionResults) => {
      if (!injectionResults || injectionResults.length === 0) {
          console.warn(`Injection of content/index.js might have failed for tab ${tab.id}. Cannot send init.`);
          return;
      }
      console.log('Final content script injection attempted.');
      // Repeatedly try sending 'init'
      let attempts = 0;
      const maxAttempts = 5;
      const intervalMs = 200;
      const intervalId = setInterval(() => {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(intervalId);
          console.warn(`Failed to get response from content script in tab ${tab.id} after ${maxAttempts} attempts.`);
          return;
        }
        console.log(`Attempt ${attempts} to send init message to tab ${tab.id}.`);
        chrome.tabs.sendMessage(tab.id, {message: 'init'}, (response) => {
          if (chrome.runtime.lastError) {
             // Ignore "Could not establish connection" errors, as the interval will retry
             if (!chrome.runtime.lastError.message.includes("Could not establish connection")) {
                 clearInterval(intervalId);
                 console.error(`Unexpected error sending init message to tab ${tab.id}:`, chrome.runtime.lastError.message);
             } else {
                 console.log(`Attempt ${attempts}: Receiving end not ready yet.`);
             }
          } else {
            clearInterval(intervalId);
            console.log(`Init message acknowledged by tab ${tab.id} on attempt ${attempts}.`);
          }
        });
      }, intervalMs);
    })
    .catch(err => {
      console.warn(`Error injecting scripts into tab ${tab.id}:`, err);
    });
}

// --- Event Listeners ---
// Helper function to handle processing for both event triggers
function processTabAction(tab) {
  console.log(`Processing action for tab ${tab.id}. Querying content script state.`);
  chrome.tabs.sendMessage(tab.id, { message: 'queryState' }, (response) => {
    if (chrome.runtime.lastError) {
      // Content script is not loaded or not responding
      console.log(`QueryState failed for tab ${tab.id}: ${chrome.runtime.lastError.message}. Injecting scripts.`);
      inject(tab);
    // Removed check for isWaiting and triggerCapture logic as 'wait' mode is gone.
    // else if (response && response.isActive && response.isWaiting) { ... }
    } else {
      // Content script exists but we always reinject for consistency
      console.log(`Content script detected in tab ${tab.id}. Re-injecting for fresh initialization.`);
      inject(tab);
    }
  });
}

chrome.action.onClicked.addListener((tab) => {
  // When the extension icon is clicked, use the common handler
  processTabAction(tab);
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'take-screenshot') {
    // When keyboard shortcut is used, get the active tab first, then use common handler
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs && tabs.length > 0) {
        processTabAction(tabs[0]);
      } else {
        console.warn('No active tab found when keyboard shortcut was used');
      }
    });
  }
});

// --- Google Drive Logic ---
function dataURLtoBlob(dataurl) {
  var arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
      bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
  while(n--){
      u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], {type:mime});
}

async function uploadToDrive(imageDataUrl, filename, folderId, token) {
  console.log('Uploading to Drive. Folder ID:', folderId);
  const blob = dataURLtoBlob(imageDataUrl);
  const fileMetadata = {
    name: filename,
    ...(folderId && { parents: [folderId] })
  };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(fileMetadata)], { type: 'application/json' }));
  form.append('file', blob);
  const uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink';

  try {
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: form
    });
    const result = await response.json();
    if (!response.ok) {
      console.error('Drive Upload Error Response:', result);
      throw new Error(`Google Drive API Error: ${result.error?.message || response.statusText}`);
    }
    console.log('Drive Upload Success:', result);

    // --- Set Permissions ---
    if (result && result.id) {
      const fileId = result.id;
      const permissionsUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`;
      const permissionsBody = {
        role: 'reader',
        type: 'anyone'
      };
      try {
        const permResponse = await fetch(permissionsUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(permissionsBody)
        });
        const permResult = await permResponse.json();
        if (!permResponse.ok) {
          console.error('Drive Permissions Error Response:', permResult);
          // Don't throw an error here, just log it, as the upload itself succeeded.
          // The user can still access the file, just not shared as intended.
        } else {
          console.log('Drive Permissions Set Success:', permResult);
        }
      } catch (permError) {
        console.error('Drive Permissions Fetch Error:', permError);
        // Log error but don't fail the overall upload return
      }
    }
    // --- End Set Permissions ---

    return result;
  } catch (error) {
    console.error('Drive Upload Fetch Error:', error);
    return null;
  }
}

// listDriveFolders function removed as it's no longer needed

async function checkDriveFolderExists(folderId, token) {
  console.log(`Checking existence and name of Drive folder ID: ${folderId}`);
  // Request 'name' field along with 'id'
  const url = `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      const result = await response.json();
      console.log('Folder exists:', result);
      // Return name along with existence status
      return { exists: true, name: result.name };
    } else {
      console.warn(`Folder check failed: ${response.status} ${response.statusText}`);
      // Attempt to parse error for more details, but don't fail if parsing fails
      let errorMsg = `Folder not found or access denied (Status: ${response.status})`;
      try {
          const errorResult = await response.json();
          if (errorResult.error && errorResult.error.message) {
              errorMsg = errorResult.error.message;
          }
      } catch (e) { /* Ignore parsing error */ }
      return { exists: false, error: errorMsg };
    }
  } catch (error) {
    console.error('Error during folder existence check fetch:', error);
    return { exists: false, error: 'Network error during folder check.' };
  }
}


// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // --- List Drive Folders --- message handler removed
  // --- Upload to Drive ---
  if (request.action === 'uploadToDrive') { // Adjusted 'else if' to 'if'
    console.log('Received uploadToDrive message');
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        console.error('Drive Auth Error for Upload:', chrome.runtime.lastError);
        sendResponse({ success: false, error: 'Authentication failed' });
      } else {
        chrome.storage.sync.get(['driveFolderId'], (config) => {
          // Ensure folderId is null if it's an empty string, otherwise use the ID
          const folderId = config.driveFolderId ? config.driveFolderId : null;
          console.log(`Using Drive Folder ID from storage: ${folderId === null ? 'null (My Drive)' : folderId}`);

          uploadToDrive(request.imageDataUrl, request.filename, folderId, token)
            .then(fileData => {
              console.log("Upload successful, fileData:", JSON.stringify(fileData));
              if (fileData && fileData.webViewLink) {
                 // Open the file in a new tab immediately
                  chrome.tabs.create({ url: fileData.webViewLink }, (newTab) => {
                    console.log(`Opened uploaded file in new tab: ${fileData.webViewLink} (Tab ID: ${newTab.id})`);
                    // Inject the copy button script after the tab is created
                    if (newTab && newTab.id) {
                      // Inject both scripts after a short delay to allow the page to load
                      setTimeout(() => {
                        console.log(`Injecting scripts into new Drive tab ${newTab.id}`);
                        // Inject warning banner script first
                        chrome.scripting.executeScript({
                          target: { tabId: newTab.id },
                          files: ['content/drive-share-warning.js'] // New script for the banner
                        }).then(() => {
                          console.log("Successfully injected drive-share-warning.js");
                          // Then inject the copy button script
                          return chrome.scripting.executeScript({
                            target: { tabId: newTab.id },
                            files: ['content/drive-copy-button.js']
                          });
                        }).then(() => {
                          console.log("Successfully injected drive-copy-button.js");
                        }).catch(err => {
                          console.error(`Failed to inject scripts into tab ${newTab.id}:`, err);
                        });
                      }, 1000); // Increased delay slightly
                    } else {
                       console.error("Could not get new tab ID to inject scripts.");
                    }
                  });
                sendResponse({ success: true });
              } else if (fileData) {
                 console.warn('Upload successful but no webViewLink received.');
                 sendResponse({ success: true, warning: 'No view link available.' });
              } else {
                sendResponse({ success: false, error: 'Upload failed (see console for details)' });
              }
            })
            .catch(error => sendResponse({ success: false, error: error.message }));
        });
      }
    });
    return true; // Indicate async response
  }
  // --- Check Drive Folder Exists ---
  else if (request.action === 'checkFolderExists') {
    console.log('Received checkFolderExists message for ID:', request.folderId);
    if (!request.folderId) {
      sendResponse({ success: false, error: 'No Folder ID provided.' });
      return false; // No async response needed
    }
    chrome.identity.getAuthToken({ interactive: false }, (token) => { // Use non-interactive check first
      if (chrome.runtime.lastError || !token) {
        console.error('Drive Auth Error for folder check:', chrome.runtime.lastError);
        // Don't trigger interactive auth here, just report failure. User needs to auth first.
        sendResponse({ success: false, error: 'Not authenticated with Google Drive.' });
      } else {
        checkDriveFolderExists(request.folderId, token)
          .then(result => {
            if (result.exists) {
              // Send back the folder name on success
              sendResponse({ success: true, name: result.name });
            } else {
              sendResponse({ success: false, error: result.error || 'Folder check failed.' });
            }
          })
          .catch(error => { // Catch errors from checkDriveFolderExists itself
            console.error("Caught error calling checkDriveFolderExists:", error);
            sendResponse({ success: false, error: error.message || 'Error checking folder existence.' });
          });
      }
    });
    return true; // Indicate async response
  }
  // --- Initiate Drive Auth ---
  else if (request.action === 'initiateDriveAuth') {
    console.log('Received initiateDriveAuth message');
    if (request.reauth) {
      console.log('Re-authentication requested, revoking existing token');
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (token) {
          chrome.identity.removeCachedAuthToken({ 'token': token }, () => {
            console.log('Token removed from cache');
            fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
              .then(response => {
                console.log('Token revocation response:', response.status);
                performAuth(true);
              })
              .catch(error => {
                console.error('Error revoking token:', error);
                performAuth(true);
              });
          });
        } else {
          performAuth(true);
        }
      });
    } else {
      performAuth(false);
    }

    function performAuth(forceAuth) {
      console.log(`Performing auth...`);
      const authOptions = { interactive: true };
      chrome.identity.getAuthToken(authOptions, (token) => {
        if (chrome.runtime.lastError || !token) {
          console.error('Drive Auth Error during initiation:', chrome.runtime.lastError);
          sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'Authentication failed or cancelled.' });
        } else {
          console.log('Drive Auth Success during initiation. Token:', token.substring(0, 5) + '...');
          (async () => {
            try {
              const response = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { 'Authorization': `Bearer ${token}` } });
              const data = await response.json();
              console.log('Token verification successful:', data);
              sendResponse({ success: true, token: token });
            } catch (error) {
              console.error('Token verification failed:', error);
              sendResponse({ success: false, error: 'Token verification failed' });
            }
          })();
        }
      });
    }
    return true; // Indicate async response
  }
  // --- Check Drive Auth Status ---
  else if (request.action === 'checkDriveAuthStatus') {
     console.log('Received checkDriveAuthStatus message');
     chrome.identity.getAuthToken({ interactive: false }, (token) => {
       sendResponse({ isAuthenticated: !(chrome.runtime.lastError || !token) });
     });
     return true; // Indicate async response
  }
  // --- Capture Message ---
  else if (request.message === 'capture') {
    // Format is always PNG, quality is irrelevant
    chrome.tabs.query({active: true, currentWindow: true}, (tab) => {
      chrome.tabs.captureVisibleTab(tab.windowId, {format: 'png'}, (image) => { // Hardcode format: 'png'
        sendResponse({message: 'image', image})
      })
    });
    return true; // Indicate async response
  }
  // --- Active Message ---
  else if (request.message === 'active') {
    if (request.active) {
      chrome.storage.sync.get((config) => {
        const method = config.method || defaults.method; // Use default if not set
        let title = 'Screenshot Link'; // Use new extension name as default
        let badgeText = '';
        if (method === 'crop') { title = 'Crop and Capture'; badgeText = '◩'; } // Updated capitalization
        else if (method === 'view') { title = 'Full Screen Capture'; badgeText = '⬒'; } // Updated capitalization
        else if (method === 'page') { title = 'Capture Document'; badgeText = '◼'; } // Keep page title if re-enabled later
        chrome.action.setTitle({tabId: sender.tab.id, title: title});
        chrome.action.setBadgeText({tabId: sender.tab.id, text: badgeText});
      });
    } else {
      chrome.action.setTitle({tabId: sender.tab.id, title: 'Screenshot Link'}); // Use new extension name
      chrome.action.setBadgeText({tabId: sender.tab.id, text: ''});
    }
  }
  // --- Revoke Drive Auth ---
  else if (request.action === 'revokeDriveAuth') {
    console.log('Received revokeDriveAuth message');
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) {
        console.warn('Revoke requested, but no token found or error:', chrome.runtime.lastError?.message);
        sendResponse({ success: true, message: 'No active token to revoke.' });
      } else {
        chrome.identity.removeCachedAuthToken({ token: token }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error removing cached token:', chrome.runtime.lastError);
          } else {
            console.log('Token removed from cache.');
          }
          fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`)
            .then(response => {
              console.log('Google token revocation response status:', response.status);
              if (response.ok) {
                console.log('Token successfully revoked with Google.');
                sendResponse({ success: true });
              } else {
                console.error('Failed to revoke token with Google, status:', response.status);
                response.text().then(text => console.error('Revocation response body:', text));
                sendResponse({ success: true, warning: 'Could not revoke token with Google, but removed locally.' });
              }
            })
            .catch(error => {
              console.error('Error sending revocation request to Google:', error);
              sendResponse({ success: false, error: 'Failed to send revocation request to Google.' });
            });
        });
      }
    });
    return true;
  }
});

console.log("Background script initialization complete."); // Add log
