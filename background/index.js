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
chrome.action.onClicked.addListener((tab) => {
  // Check if content script is active and waiting before injecting
  console.log(`Action clicked for tab ${tab.id}. Querying content script state.`);
  chrome.tabs.sendMessage(tab.id, { message: 'queryState' }, (response) => {
    if (chrome.runtime.lastError) {
      // Likely content script not injected or tab not ready
      console.log(`QueryState failed for tab ${tab.id}: ${chrome.runtime.lastError.message}. Injecting scripts.`);
      inject(tab);
    // Removed check for isWaiting and triggerCapture logic as 'wait' mode is gone.
    // else if (response && response.isActive && response.isWaiting) { ... }
    } else {
      // Content script exists but isn't in the expected state (or maybe just needs re-init) - inject/re-inject
      console.log(`Content script in tab ${tab.id} exists but state unknown or needs re-init. Injecting scripts.`);
      inject(tab);
    }
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'take-screenshot') {
    // This might need similar logic to onClicked if commands should also trigger waiting captures
    chrome.tabs.query({active: true, currentWindow: true}, (tab) => {
       console.log(`Command triggered for tab ${tab[0].id}. Querying content script state.`);
       chrome.tabs.sendMessage(tab[0].id, { message: 'queryState' }, (response) => {
         if (chrome.runtime.lastError) {
           console.log(`QueryState failed for tab ${tab[0].id}: ${chrome.runtime.lastError.message}. Injecting scripts.`);
           inject(tab[0]);
         // Removed check for isWaiting and triggerCapture logic as 'wait' mode is gone.
         // else if (response && response.isActive && response.isWaiting) { ... }
         } else {
           console.log(`Content script in tab ${tab[0].id} exists but state unknown or needs re-init. Injecting scripts.`);
           inject(tab[0]);
         }
       });
    })
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
    return result;
  } catch (error) {
    console.error('Drive Upload Fetch Error:', error);
    return null;
  }
}

async function listDriveFolders(token, parentId = null, pageToken = null) {
  console.log(`Listing folders for parentId: ${parentId}, pageToken: ${pageToken}`);
  try {
    let query = "mimeType='application/vnd.google-apps.folder' and trashed=false";
    if (parentId) {
      query += ` and '${parentId}' in parents`;
    } else {
      query += " and 'root' in parents";
    }

    let url = `https://www.googleapis.com/drive/v3/files?` +
              `q=${encodeURIComponent(query)}` +
              `&fields=nextPageToken,files(id,name,parents)` +
              `&orderBy=name` +
              `&pageSize=100`;

    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }

    console.log("Constructed Drive API URL:", url);

    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    const responseBody = await response.text();
    console.log(`Drive API Response Status: ${response.status}`);
    console.log("Drive API Raw Response Body:", responseBody);

    if (!response.ok) {
      let errorData;
      try {
        errorData = JSON.parse(responseBody);
      } catch (e) {
        console.error("Failed to parse error response JSON:", e);
        errorData = { error: { message: `HTTP error ${response.status}` } };
      }
      console.error('Drive API Error:', errorData);
      throw new Error(`Google Drive API Error: ${errorData.error?.message || response.statusText}`);
    }

    const result = JSON.parse(responseBody);
    console.log("Parsed Drive API Result:", JSON.stringify(result, null, 2));
    return result;

  } catch (error) {
    console.error('Error in listDriveFolders function:', error);
    throw error;
  }
}

// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // --- List Drive Folders ---
  if (request.action === 'listDriveFolders') {
    console.log('Received listDriveFolders message');
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        console.error('Drive Auth Error for folder listing:', chrome.runtime.lastError);
        sendResponse({ success: false, error: 'Authentication failed' });
      } else {
        listDriveFolders(token, request.parentId, request.pageToken)
          .then(data => sendResponse({ success: true, folders: data }))
          .catch(error => sendResponse({ success: false, error: error.message }));
      }
    });
    return true; // Indicate async response
  }
  // --- Upload to Drive ---
  else if (request.action === 'uploadToDrive') {
    console.log('Received uploadToDrive message');
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        console.error('Drive Auth Error for Upload:', chrome.runtime.lastError);
        sendResponse({ success: false, error: 'Authentication failed' });
      } else {
        chrome.storage.sync.get(['driveFolderId'], (config) => {
          const folderId = config.driveFolderId || null;

          uploadToDrive(request.imageDataUrl, request.filename, folderId, token)
            .then(fileData => {
              console.log("Upload successful, fileData:", JSON.stringify(fileData));
              if (fileData && fileData.webViewLink) {
                 // Open the file in a new tab immediately
                  chrome.tabs.create({ url: fileData.webViewLink }, (newTab) => {
                    console.log(`Opened uploaded file in new tab: ${fileData.webViewLink} (Tab ID: ${newTab.id})`);
                    // Inject the copy button script after the tab is created
                    if (newTab && newTab.id) {
                      setTimeout(() => {
                        console.log(`Injecting drive-copy-button script into tab ${newTab.id}`);
                        chrome.scripting.executeScript({
                          target: { tabId: newTab.id },
                          files: ['content/drive-copy-button.js']
                        }).then(() => {
                          console.log("Successfully injected drive-copy-button.js");
                        }).catch(err => {
                          console.error("Failed to inject drive-copy-button.js:", err);
                        });
                      }, 500);
                    } else {
                       console.error("Could not get new tab ID to inject copy button script.");
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
