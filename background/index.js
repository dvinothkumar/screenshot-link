console.log("Background script starting..."); // Add log

// --- Default Settings ---
var defaults = {
  method: 'crop',
  format: 'png',
  quality: 100,
  scaling: true,
  save: ['file'],
  clipboard: 'url',
  dialog: true,
  icon: 'default',
  driveCopyLink: false // Default for the copy link setting
}

// --- Initialization ---
chrome.storage.sync.get((store) => {
  var config = {}
  // Ensure all defaults are present
  Object.assign(config, defaults, JSON.parse(JSON.stringify(store)))

  // v3.0 -> v3.1
  if (typeof config.save === 'string') {
    config.clipboard = /url|binary/.test(config.save) ? config.save : 'url'
    config.save = /url|binary/.test(config.save) ? ['clipboard'] : ['file']
  }
  if (config.dpr !== undefined) {
    config.scaling = config.dpr
    delete config.dpr
  }
  if (typeof config.icon === 'boolean') {
    config.icon = config.icon === false ? 'default' : 'light'
  }
  chrome.storage.sync.set(config)

  chrome.action.setIcon({
    path: [16, 19, 38, 48, 128].reduce((all, size) => (
      all[size] = `/icons/${config.icon}/${size}x${size}.png`,
      all
    ), {})
  })
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
    } else if (response && response.isActive && response.isWaiting) {
      // Content script is waiting, trigger capture
      console.log(`Content script in tab ${tab.id} is waiting. Sending triggerCapture.`);
      chrome.tabs.sendMessage(tab.id, { message: 'triggerCapture' });
    } else {
      // Content script exists but isn't waiting, or state is unknown - inject/re-inject
      console.log(`Content script in tab ${tab.id} not waiting or state unknown. Injecting scripts.`);
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
         } else if (response && response.isActive && response.isWaiting) {
           console.log(`Content script in tab ${tab[0].id} is waiting. Sending triggerCapture.`);
           chrome.tabs.sendMessage(tab[0].id, { message: 'triggerCapture' });
         } else {
           console.log(`Content script in tab ${tab[0].id} not waiting or state unknown. Injecting scripts.`);
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
    chrome.notifications.create({
      type: 'basic', iconUrl: '/icons/default/48x48.png',
      title: '❌ Upload Failed',
      message: `Failed to upload to Google Drive: ${error.message}`
    });
    return null;
  }
}

// Store notification IDs mapped to their Drive file URLs
const notificationFileLinks = {};

async function listDriveFolders(token, parentId = null, pageToken = null) {
  try {
    let query = "mimeType='application/vnd.google-apps.folder' and trashed=false";
    if (parentId) {
      query += ` and '${parentId}' in parents`;
    } else {
      query += " and ('root' in parents or sharedWithMe)";
    }
    let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=nextPageToken,files(id,name,parents)&orderBy=name`;
    if (pageToken) url += `&pageToken=${pageToken}`;
    const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Google Drive API Error: ${errorData.error?.message || response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error listing Drive folders:', error);
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
        chrome.notifications.create({
          type: 'basic', iconUrl: '/icons/default/48x48.png',
          title: 'Google Drive Authentication Needed',
          message: 'Could not authenticate with Google Drive. Please check options.'
        });
        sendResponse({ success: false, error: 'Authentication failed' });
      } else {
        // Only need folderId here, copyLink setting is checked in onClicked listener
        chrome.storage.sync.get(['driveFolderId'], (config) => {
          const folderId = config.driveFolderId || null;

          uploadToDrive(request.imageDataUrl, request.filename, folderId, token)
            .then(fileData => {
              if (fileData && fileData.webViewLink) {
                const notificationId = `drive-upload-${fileData.id}`;
                // Store link for onClicked listener
                notificationFileLinks[notificationId] = fileData.webViewLink;
                console.log(`Stored link for notification ${notificationId}: ${fileData.webViewLink}`);

                // Create notification (copy happens onClicked now)
                chrome.notifications.create(notificationId, {
                  type: 'basic', iconUrl: '/icons/default/48x48.png',
                  title: '✅ Screenshot Saved',
                  message: `Uploaded "${request.filename}". 👆 CLICK TO VIEW in Google Drive.`
                });
                sendResponse({ success: true });

              } else if (fileData) {
                 console.warn('Upload successful but no webViewLink received.');
                 chrome.notifications.create({
                    type: 'basic', iconUrl: '/icons/default/48x48.png',
                    title: '✅ Screenshot Saved (No Link)',
                    message: `Successfully uploaded "${request.filename}" to Google Drive.`
                  });
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

    function performAuth(forceAuth) { // forceAuth is not directly used now but kept for clarity
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
    chrome.tabs.query({active: true, currentWindow: true}, (tab) => {
      chrome.tabs.captureVisibleTab(tab.windowId, {format: request.format, quality: request.quality}, (image) => {
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
        let title = 'Screenshot Capture';
        let badgeText = '';
        if (method === 'crop') { title = 'Crop and Save'; badgeText = '◩'; }
        else if (method === 'wait') { title = 'Crop and Wait'; badgeText = '◪'; }
        else if (method === 'view') { title = 'Capture Viewport'; badgeText = '⬒'; }
        else if (method === 'page') { title = 'Capture Document'; badgeText = '◼'; }
        chrome.action.setTitle({tabId: sender.tab.id, title: title});
        chrome.action.setBadgeText({tabId: sender.tab.id, text: badgeText});
      });
    } else {
      chrome.action.setTitle({tabId: sender.tab.id, title: 'Screenshot Capture'});
      chrome.action.setBadgeText({tabId: sender.tab.id, text: ''});
    }
    // No async response needed
  }
  // Return false if not sending an async response (or nothing)
});

// --- Notification Click Listener ---
chrome.notifications.onClicked.addListener((notificationId) => {
  console.log(`Notification clicked: ${notificationId}`);
  // Check if this notification ID corresponds to a Drive upload
  if (notificationFileLinks[notificationId]) {
    const urlToOpen = notificationFileLinks[notificationId];
    const linkToCopy = notificationFileLinks[notificationId]; // Keep link for clipboard

    // Clear the original notification first
    chrome.notifications.clear(notificationId);
    // Remove the link from our map immediately
    delete notificationFileLinks[notificationId];

    // Check if the copy link option is enabled
    chrome.storage.sync.get(['driveCopyLink'], (config) => {
      const shouldCopyLink = config.driveCopyLink === true;

      // Open the file link in a new tab
      chrome.tabs.create({ url: urlToOpen }, (newTab) => {
        // If copy is enabled, inject script into the *new* tab to copy the link
        if (shouldCopyLink && newTab && newTab.id) {
          // Wait a short moment for the tab to potentially load basic structure
          // This might increase the chances of the clipboard API being ready
          setTimeout(() => {
            console.log(`Attempting to copy link to clipboard in tab ${newTab.id}`);
            chrome.scripting.executeScript({
              target: { tabId: newTab.id },
              func: copyTextToClipboard,
              args: [linkToCopy]
            }).then(() => {
              console.log("Clipboard write script executed successfully.");
              // Show copy success notification *after* script execution attempt
              chrome.notifications.create({
                type: 'basic', iconUrl: '/icons/default/48x48.png',
                title: '✅ Link Copied',
                message: 'Google Drive link copied to clipboard.'
              });
            }).catch(err => {
              console.error("Failed to execute clipboard script:", err);
              // Show copy failure notification
              chrome.notifications.create({
                type: 'basic', iconUrl: '/icons/default/48x48.png',
                title: '❌ Copy Failed',
                message: `Could not copy link: ${err.message}` // Include error message
              });
            });
          }, 100); // 100ms delay, adjust if needed
        } else if (shouldCopyLink) {
            console.error("Could not get new tab ID to inject clipboard script.");
             chrome.notifications.create({
              type: 'basic', iconUrl: '/icons/default/48x48.png',
              title: '❌ Copy Failed',
              message: 'Could not copy link (failed to access new tab).'
            });
        }
      });
    });
  } else {
    console.log('Notification click did not match a stored Drive link.');
  }
});

// Function to be injected into the tab to copy text
function copyTextToClipboard(text) {
  navigator.clipboard.writeText(text)
    .then(() => {
      console.log('Link successfully copied to clipboard by injected script.');
    })
    .catch(err => {
      console.error('Injected script failed to copy link:', err);
      // Note: Cannot easily send message back to background from injected func
      // Error handling relies on the .catch() in the background script's executeScript call
    });
}


console.log("Background script initialization complete."); // Add log
