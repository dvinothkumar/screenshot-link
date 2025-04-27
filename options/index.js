var state = {
  shortcut: {},
  method: [
    {id: 'crop', icon: '◩', title: 'Crop and Capture'},
    {id: 'view', icon: '⬒', title: 'Full Screen Capture'},
  ],
  save: [
    {id: 'drive', title: 'To Google Drive', checked: true},
  ],
  // icon array removed
  delay: 500,
  saveToDrive: true,
  driveFolderId: '',
  driveFolderName: 'My Drive', // Re-added to store the validated folder name
  driveFolderUrlInput: '', // Added for the URL input field
  driveAuthStatus: 'checking',
  driveFolderValidationStatus: 'idle', // 'idle', 'checking', 'valid', 'invalid'
  driveFolderValidationError: null // Holds error message if invalid
  // folderBrowser state removed
}

chrome.storage.sync.get((config) => {
  state.method.forEach((item) => item.checked = item.id === config.method);
  if (config.format !== 'png') {
      chrome.storage.sync.set({ format: 'png' });
  }
  if (config.save !== 'drive') {
      chrome.storage.sync.set({ save: 'drive' });
  }
  // Removed icon loading logic
  state.delay = config.delay || 500;
  state.driveFolderId = config.driveFolderId || '';
  // Load saved folder name if ID exists, otherwise default to 'My Drive'
  state.driveFolderName = config.driveFolderId ? (config.driveFolderName || `Folder ID: ${config.driveFolderId}`) : 'My Drive';
  state.saveToDrive = true; // Keep this? Seems redundant now. Let's keep for consistency for now.
  checkDriveAuthStatus();
});

chrome.commands.getAll((commands) => {
  var command = commands.find((command) => command.name === 'take-screenshot')
  state.shortcut = command.shortcut
  m.redraw()
})

var events = {
  option: (name, item) => (e) => {
    if (name === 'delay') {
      state[name] = parseInt(e.currentTarget.value);
      if (state[name] < 500 || state[name] > 3000) state[name] = 500;
      chrome.storage.sync.set({[name]: state[name]});
    }
    // Handle method radio buttons (icon removed)
    else if (name === 'method') {
      state[name].forEach((opt) => opt.checked = false);
      item.checked = true;
      chrome.storage.sync.set({[name]: item.id});
    }
    m.redraw();
  },
  driveFolderUrlChanged: (e) => {
    const url = e.target.value;
    state.driveFolderUrlInput = url;
    parseAndSaveFolderId(url);
  },
  button: (action) => () => {
    if (action === 'driveAuth') {
      handleDriveAuth();
    } else if (action === 'driveResetAuth') {
      handleDriveResetAuth();
    } else {
      chrome.tabs.create({url: {
        shortcut: 'chrome://extensions/shortcuts',
      }[action]})
    }
  }
  // folderBrowser event handlers removed
}

// --- Updated Function to Parse, Validate, and Save Folder ID ---
function parseAndSaveFolderId(url) {
  state.driveFolderUrlInput = url; // Keep input value updated
  let extractedFolderId = '';

  if (url) {
    const match = url.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      extractedFolderId = match[1];
      console.log('Extracted Folder ID:', extractedFolderId);
    } else {
      console.log('Could not extract Folder ID from URL:', url);
      // Treat invalid URL format as reverting to My Drive, but show a specific error
      state.driveFolderValidationStatus = 'invalid';
      state.driveFolderValidationError = 'Invalid Google Drive folder URL format.';
      state.driveFolderId = ''; // Revert to My Drive
      state.driveFolderName = 'My Drive'; // Reset name
      chrome.storage.sync.set({ driveFolderId: '', driveFolderName: 'My Drive' }); // Save My Drive default
      m.redraw();
      return; // Stop processing
    }
  }

  // Clear previous error/status if starting validation or using My Drive
  state.driveFolderValidationError = null;

  if (extractedFolderId) {
    // --- Validate the extracted ID ---
    state.driveFolderValidationStatus = 'checking';
    m.redraw(); // Show loading state

    chrome.runtime.sendMessage({
      action: 'checkFolderExists',
      folderId: extractedFolderId
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Error communicating with background for folder check:', chrome.runtime.lastError);
        state.driveFolderValidationStatus = 'invalid';
        state.driveFolderValidationError = 'Error checking folder: ' + chrome.runtime.lastError.message;
        state.driveFolderId = ''; // Revert to My Drive on error
        state.driveFolderName = 'My Drive'; // Reset name
        chrome.storage.sync.set({ driveFolderId: '', driveFolderName: 'My Drive' });
      } else if (response && response.success) {
        console.log('Folder validation successful for ID:', extractedFolderId, 'Name:', response.name);
        state.driveFolderValidationStatus = 'valid';
        state.driveFolderValidationError = null;
        state.driveFolderId = extractedFolderId; // Set the valid ID
        state.driveFolderName = response.name || extractedFolderId; // Use name, fallback to ID if name missing
        // Save both ID and Name
        chrome.storage.sync.set({ driveFolderId: extractedFolderId, driveFolderName: state.driveFolderName });
      } else {
        console.warn('Folder validation failed:', response ? response.error : 'Unknown error');
        state.driveFolderValidationStatus = 'invalid';
        state.driveFolderValidationError = response ? response.error : 'Folder not found or access denied.';
        state.driveFolderId = ''; // Revert to My Drive
        state.driveFolderName = 'My Drive'; // Reset name
        chrome.storage.sync.set({ driveFolderId: '', driveFolderName: 'My Drive' }); // Save My Drive default
      }
      m.redraw(); // Update UI with validation result
    });
  } else {
    // --- No URL or no ID extracted: Default to My Drive ---
    console.log('No folder URL provided or ID not extracted, defaulting to My Drive.');
    state.driveFolderValidationStatus = 'valid'; // My Drive is always considered valid
    state.driveFolderValidationError = null;
    state.driveFolderId = ''; // Ensure state reflects My Drive
    state.driveFolderName = 'My Drive'; // Set name for My Drive
    chrome.storage.sync.set({ driveFolderId: '', driveFolderName: 'My Drive' }, () => { // Save My Drive default
       if (chrome.runtime.lastError) {
           console.error('Error saving default driveFolderId/Name:', chrome.runtime.lastError);
       }
       m.redraw();
    });
  }
}
// --- End Updated Function ---


var currentAuthToken = null;

function handleDriveAuth() {
  console.log('Requesting Drive authentication from background script...');
  const isReauth = state.driveAuthStatus === 'logged_in';
  console.log(`Initiating ${isReauth ? 're-authentication' : 'initial authentication'}`);
  state.driveAuthStatus = 'logging_in';
  m.redraw();
  chrome.runtime.sendMessage({
    action: 'initiateDriveAuth',
    reauth: isReauth,
    currentToken: currentAuthToken
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error sending initiateDriveAuth message:', chrome.runtime.lastError);
      state.driveAuthStatus = 'error';
    } else if (response && response.success) {
      console.log('Drive Auth Success reported by background script.');
      state.driveAuthStatus = 'logged_in';
      if (response.token) {
        currentAuthToken = response.token;
        console.log('Received and stored new auth token (first 5 chars):', currentAuthToken.substring(0, 5) + '...');
      }
    } else {
      console.error('Drive Auth Failed reported by background script:', response ? response.error : 'No response');
      state.driveAuthStatus = 'error';
    }
    m.redraw();
  });
}

function handleDriveResetAuth() {
  console.log('Requesting Drive authentication reset from background script...');
  chrome.runtime.sendMessage({ action: 'revokeDriveAuth' }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error sending revokeDriveAuth message:', chrome.runtime.lastError);
      state.driveAuthStatus = 'error';
    } else if (response && response.success) {
      console.log('Drive Auth Reset Success reported by background script.');
      state.driveAuthStatus = 'logged_out';
      currentAuthToken = null;
      state.driveFolderId = ''; // Reset to My Drive
      state.driveFolderName = 'My Drive'; // Reset name
      state.driveFolderUrlInput = ''; // Clear the input field
      chrome.storage.sync.remove(['driveFolderId', 'driveFolderName']); // Remove both from storage
    } else {
      console.error('Drive Auth Reset Failed reported by background script:', response ? response.error : 'No response');
      state.driveAuthStatus = 'error';
    }
    m.redraw();
  });
}

function checkDriveAuthStatus() {
   console.log('Checking Drive auth status...');
   state.driveAuthStatus = 'checking';
   m.redraw();
   chrome.identity.getAuthToken({ interactive: false }, (token) => {
     if (chrome.runtime.lastError || !token) {
       console.log('Auth check: No token found or error. Setting status to logged_out.', chrome.runtime.lastError?.message);
       state.driveAuthStatus = 'logged_out';
       currentAuthToken = null;
     } else {
       console.log('Auth check: Token found. Setting status to logged_in.');
       state.driveAuthStatus = 'logged_in';
       currentAuthToken = token;
     }
     m.redraw();
   });
}

var oncreate = {
  ripple: (vnode) => {
    mdc.ripple.MDCRipple.attachTo(vnode.dom)
  },
  textfield: (vnode) => {
    mdc.textfield.MDCTextField.attachTo(vnode.dom)
  }
}

var onupdate = (item) => (vnode) => {
  if (vnode.dom.classList.contains('active') !== (typeof item === 'boolean' ? item : item.checked)) {
    vnode.dom.classList.toggle('active')
  }
}

// Helper function to get status text for the indicator
function getIndicatorText(status) {
    switch (status) {
        case 'logged_in': return 'AUTHENTICATED';
        case 'logged_out': return 'NOT AUTHENTICATED';
        case 'error': return 'ERROR';
        case 'checking': return 'CHECKING...';
        case 'logging_in': return 'AUTHENTICATING...';
        default: return 'UNKNOWN';
    }
}

m.mount(document.querySelector('main'), {
  view: () => [
    m('.row',
      // --- Column 1: Capture Method & Shortcut ---
      m('.col-xxl-6.col-xl-6.col-lg-6.col-md-12.col-sm-12.s-col', // Adjusted column width
        m('h3', 'Capture Method'),
        m('.bs-callout',
          state.method.map((item) =>
            m('.row',
              m('.col-sm-12',
                m('label.s-label', {onupdate: onupdate(item)},
                  m('.mdc-radio',
                    m('input.mdc-radio__native-control', {
                      type: 'radio', name: 'method',
                      checked: item.checked && 'checked',
                      onchange: events.option('method', item)
                    }),
                    m('.mdc-radio__background',
                      m('.mdc-radio__outer-circle'),
                      m('.mdc-radio__inner-circle'),
                    ),
                  ),
                  m('span', m('em', item.icon), item.title)
                )
              ),
              item.id === 'page' &&
              m('.col-sm-12', {class: !item.checked && 'disabled'},
                m('span.s-text', 'Screenshot Delay'),
                m('.mdc-text-field s-textfield', {oncreate: oncreate.textfield},
                  m('input.mdc-text-field__input', {
                    type: 'number', value: state.delay,
                    onchange: events.option('delay', item),
                    disabled: !item.checked && 'disabled',
                    placeholder: '500-3k', min: 500, max: 3000
                  }),
                  m('.mdc-line-ripple')
                ),
                m('span.s-text', 'ms'),
              )
            )
          )
        ),

        m('h3', 'Keyboard Shortcut'),
        m('.bs-callout',
          m('.row',
            m('.col-sm-12',
              state.shortcut &&
              m('span.s-text', 'Press ', m('code', state.shortcut)),
              !state.shortcut &&
              m('span.s-text', 'Not set'),
              m('button.mdc-button mdc-button--raised s-button', {
                oncreate: oncreate.ripple,
                onclick: events.button('shortcut')
                },
                'Update'
              )
            )
          )
        ),
      ),

      // --- Column 2: Google Drive Auth & Folder ---
      m('.col-xxl-6.col-xl-6.col-lg-6.col-md-12.col-sm-12.s-col', // Adjusted column width
        // Extension Icon section removed

        m('h3', 'Google Drive Authentication'),
        m('.bs-callout', // Removed s-last
          m('.row',
            m('.col-sm-12', {style: 'display: flex; align-items: center; flex-wrap: wrap; gap: 10px;'},
              m('div.status-display',
                m('span.status-dot', {class: `status-${state.driveAuthStatus}`}),
                m('span.status-text', getIndicatorText(state.driveAuthStatus))
              ),
              m('button.mdc-button mdc-button--raised s-button', {
                class: state.driveAuthStatus === 'logged_in' ? 's-button-logout' : '',
                style: 'margin-left: auto;',
                oncreate: oncreate.ripple,
                onclick: state.driveAuthStatus === 'logged_in' ? events.button('driveResetAuth') : events.button('driveAuth'),
                disabled: state.driveAuthStatus === 'logging_in' || state.driveAuthStatus === 'checking'
              },
                state.driveAuthStatus === 'logged_in' ? 'Log Out' : 'Authenticate'
              )
            )
          )
        ),

        m('h3', 'Google Drive Folder'),
        // Removed duplicate H3 title
        m('.bs-callout', [
          m('.row',
            m('.col-sm-12',
              m('label.s-label', { for: 'drive-folder-url-input' }, 'Paste Google Drive Folder URL (leave blank for My Drive):'),
              m('.mdc-text-field.mdc-text-field--fullwidth', {
                  class: state.driveFolderValidationStatus === 'invalid' ? 'mdc-text-field--invalid' : '',
                  oncreate: oncreate.textfield,
                  style: 'margin-bottom: 5px;' // Reduced margin
                },
                m('input.mdc-text-field__input#drive-folder-url-input', {
                  type: 'url',
                  placeholder: 'e.g., https://drive.google.com/drive/folders/YOUR_FOLDER_ID',
                  value: state.driveFolderUrlInput,
                  oninput: events.driveFolderUrlChanged, // Changed from onchange
                  disabled: state.driveAuthStatus !== 'logged_in',
                  'aria-controls': 'folder-helper-text',
                  'aria-describedby': 'folder-helper-text'
                }),
                // Optional: Add trailing icon for status
                state.driveFolderValidationStatus === 'checking' && m('i.material-icons mdc-text-field__icon mdc-text-field__icon--trailing', { tabindex: "0", role: "button" }, 'hourglass_top'),
                state.driveFolderValidationStatus === 'valid' && state.driveFolderUrlInput && m('i.material-icons mdc-text-field__icon mdc-text-field__icon--trailing', { tabindex: "0", role: "button", style: 'color: green;' }, 'check_circle'),
                state.driveFolderValidationStatus === 'invalid' && m('i.material-icons mdc-text-field__icon mdc-text-field__icon--trailing', { tabindex: "0", role: "button" }, 'error'),
                m('.mdc-line-ripple')
              ),
              // Helper text for validation status/errors
              m('.mdc-text-field-helper-line#folder-helper-text',
                m('.mdc-text-field-helper-text', {
                  class: state.driveFolderValidationStatus === 'invalid' ? 'mdc-text-field-helper-text--persistent mdc-text-field-helper-text--validation-msg' : '',
                  'aria-hidden': 'true'
                }, state.driveFolderValidationError || (state.driveFolderValidationStatus === 'checking' ? 'Checking folder...' : '') )
              ),
              // Display current setting
              // Display current setting using folder name
              m('p.s-text', {style: 'margin-top: 10px;'},
                'Currently saving to: ',
                m('strong', state.driveFolderName || 'My Drive') // Display name, default to My Drive
              )
            )
          )
        ]),
        // Add warning about sharing permissions
        m('.bs-callout.bs-callout-warning', {style: 'margin-top: 15px;'},
          m('h4', {style: 'margin-bottom: 5px;'}, m('i.material-icons', {style: 'vertical-align: middle; margin-right: 5px; color: orange;'}, 'warning'), 'Sharing Permissions'),
          m('p', {style: 'margin-bottom: 0;'},
            'Please be aware that screenshots uploaded to Google Drive using this extension are automatically set to be ',
            m('strong', 'viewable by anyone with the link'),
            '. Exercise caution when sharing these links.'
          )
        )
      ),
    ), // End of main .row

    // Folder browser modal removed
  ]
})
