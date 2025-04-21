var state = {
  shortcut: {},
  method: [
    {id: 'crop', icon: '◩', title: 'Crop and Save'},
    {id: 'wait', icon: '◪', title: 'Crop and Wait'},
    {id: 'view', icon: '⬒', title: 'Capture Viewport'},
    // {id: 'page', icon: '◼', title: 'Capture Document'},
  ],
  format: [
    {id: 'png', title: 'PNG'},
    {id: 'jpeg', title: 'JPG'}
  ],
  save: [
    {id: 'file', title: 'To File'},
    {id: 'clipboard', title: 'To Clipboard'},
    {id: 'drive', title: 'To Google Drive'},
  ],
  clipboard: [
    {id: 'url', title: 'Data URL String'},
    {id: 'binary', title: 'Binary Image'}
  ],
  scaling: [
    {id: true, title: 'Preserve scaling'},
    {id: false, title: 'Downscale to actual size'}
  ],
  icon: [
    {id: 'default', title: 'Default Icon'},
    {id: 'light', title: 'Light Icon'},
    {id: 'dark', title: 'Dark Icon'}
  ],
  delay: 500,
  quality: 100,
  dialog: true,
  // Google Drive specific state
  saveToDrive: false, // Will be controlled by the 'drive' checkbox in the 'save' array
  driveFolderId: '', // Store the ID of the selected Drive folder
  driveFolderName: 'Root', // Display name of the selected folder
  driveAuthStatus: 'logged_out', // 'logged_out', 'logging_in', 'logged_in', 'error'
  driveCopyLink: false, // **NEW**: Option to copy link after upload
  // Folder browser state
  folderBrowser: {
    isOpen: false,
    loading: false,
    error: null,
    currentFolderId: null,
    parentStack: [], // Stack of parent folder IDs for navigation
    folders: [], // List of folders in the current directory
    breadcrumbs: [{ id: null, name: 'Root' }] // Breadcrumb navigation
  }
}

chrome.storage.sync.get((config) => {
  state.method.forEach((item) => item.checked = item.id === config.method)
  state.format.forEach((item) => item.checked = item.id === config.format)
  state.save.forEach((item) => item.checked = config.save.includes(item.id))
  state.clipboard.forEach((item) => item.checked = item.id === config.clipboard)
  state.scaling.forEach((item) => item.checked = item.id === config.scaling)
  state.icon.forEach((item) => item.checked = item.id === config.icon)
  state.delay = config.delay || 500
  state.quality = config.quality || 100
  state.dialog = config.dialog === undefined ? true : config.dialog
  // Load Drive settings
  state.driveFolderId = config.driveFolderId || ''
  state.driveCopyLink = config.driveCopyLink === undefined ? false : config.driveCopyLink; // **NEW**: Load copy link setting
  if (state.driveFolderId) {
    // If we have a folder ID, we should also have a folder name
    state.driveFolderName = config.driveFolderName || 'Selected Folder'
  } else {
    state.driveFolderName = 'Root'; // Default to Root if no ID
  }
  // Update the checked status for the 'drive' save option
  const driveSaveOption = state.save.find(item => item.id === 'drive');
  if (driveSaveOption) {
    driveSaveOption.checked = config.save && config.save.includes('drive');
    state.saveToDrive = driveSaveOption.checked; // Sync internal state
  }
  // Initial check for auth status (optional, could also do on demand)
  checkDriveAuthStatus(); // Check auth status on load
  // m.redraw() will be called inside checkDriveAuthStatus
})

chrome.commands.getAll((commands) => {
  var command = commands.find((command) => command.name === 'take-screenshot')
  state.shortcut = command.shortcut
  m.redraw()
})

var events = {
  option: (name, item) => (e) => {
    if (name === 'save') {
      item.checked = !item.checked
      chrome.storage.sync.set({
        save: state.save
          .filter(({checked}) => checked)
          .map(({id}) => id)
      });
      // Update internal state for Drive checkbox if applicable
      if (item.id === 'drive') {
        state.saveToDrive = item.checked;
        // If disabling drive, maybe clear auth status or token? Optional.
        // if (!item.checked) { state.driveAuthStatus = 'logged_out'; }
      }
    }
    // Restore logic for delay/quality inputs
    else if (/delay|quality/.test(name)) {
      state[name] = parseInt(e.currentTarget.value);
      // Add validation/bounds checks if necessary
      if (name === 'delay' && (state[name] < 500 || state[name] > 3000)) state[name] = 500;
      if (name === 'quality' && (state[name] < 0 || state[name] > 100)) state[name] = 100;
      chrome.storage.sync.set({[name]: state[name]});
    }
    // Restore logic for dialog checkbox
    else if (name === 'dialog' || name === 'driveCopyLink') { // **MODIFIED**: Handle driveCopyLink checkbox
      state[name] = !state[name];
      chrome.storage.sync.set({[name]: state[name]});
    }
    // Restore default logic for radio button groups
    else {
      state[name].forEach((opt) => opt.checked = false);
      item.checked = true;
      chrome.storage.sync.set({[name]: item.id});
      // Special handling for icon change
      if (name === 'icon') {
        chrome.action.setIcon({
          path: [16, 19, 38, 48, 128].reduce((all, size) => (
            all[size] = `/icons/${item.id}/${size}x${size}.png`,
            all
          ), {})
        });
      }
    }
    // Trigger redraw after state change
    m.redraw();
  },
  button: (action) => () => {
    if (action === 'driveAuth') {
      handleDriveAuth(); // Define this function later
    } else if (action === 'browseFolders') {
      openFolderBrowser();
    } else {
      chrome.tabs.create({url: {
        shortcut: 'chrome://extensions/shortcuts',
        location: 'chrome://settings/downloads',
      }[action]})
    }
  },
  input: (name) => (e) => {
    if (name === 'driveFolderId') {
      state.driveFolderId = e.target.value;
      chrome.storage.sync.set({ driveFolderId: state.driveFolderId });
    }
  },
  folderBrowser: {
    close: () => {
      state.folderBrowser.isOpen = false;
      m.redraw();
    },
    open: (folderId = null) => {
      // Reset folder browser state
      state.folderBrowser.loading = true;
      state.folderBrowser.error = null;
      state.folderBrowser.currentFolderId = folderId;

      // If opening a subfolder, update breadcrumbs
      if (folderId !== null) {
        // Find the folder in the current list
        const folder = state.folderBrowser.folders.find(f => f.id === folderId);
        if (folder) {
          // Add current folder to parent stack (only if it's not already the top)
          if (state.folderBrowser.parentStack.length === 0 || state.folderBrowser.parentStack[state.folderBrowser.parentStack.length - 1] !== state.folderBrowser.currentFolderId) {
             state.folderBrowser.parentStack.push(state.folderBrowser.currentFolderId);
          }
          // Add folder to breadcrumbs
          state.folderBrowser.breadcrumbs.push({ id: folderId, name: folder.name });
        } else {
          // If folder not found in current list, maybe fetch its details?
          // For now, just log an error or handle gracefully
          console.warn("Folder not found in current list:", folderId);
          // Potentially reset breadcrumbs if navigation is broken
          state.folderBrowser.breadcrumbs = [{ id: null, name: 'Root' }, { id: folderId, name: 'Unknown Folder' }];
        }
      } else {
        // Opening root, reset breadcrumbs and stack
        state.folderBrowser.breadcrumbs = [{ id: null, name: 'Root' }];
        state.folderBrowser.parentStack = [];
      }

      // Load folders
      loadFolders(folderId);
    },
    back: () => {
      if (state.folderBrowser.parentStack.length > 0) {
        // Pop the last parent from the stack
        const parentId = state.folderBrowser.parentStack.pop();
        // Remove the last breadcrumb
        state.folderBrowser.breadcrumbs.pop();
        // Load the parent folder
        state.folderBrowser.loading = true;
        state.folderBrowser.error = null;
        state.folderBrowser.currentFolderId = parentId;
        loadFolders(parentId);
      } else {
        // If already at root, maybe just reload root?
        state.folderBrowser.breadcrumbs = [{ id: null, name: 'Root' }];
        state.folderBrowser.loading = true;
        state.folderBrowser.error = null;
        state.folderBrowser.currentFolderId = null;
        loadFolders(null);
      }
    },
    select: (folderId, folderName) => {
      // Save the selected folder
      state.driveFolderId = folderId;
      state.driveFolderName = folderName || (folderId === null ? 'Root' : 'Selected Folder'); // Use Root if ID is null
      chrome.storage.sync.set({
        driveFolderId: state.driveFolderId,
        driveFolderName: state.driveFolderName
      });
      // Close the folder browser
      state.folderBrowser.isOpen = false;
      m.redraw();
    }
  }
}

// Function to open the folder browser
function openFolderBrowser() {
  // Only open if authenticated
  if (state.driveAuthStatus !== 'logged_in') {
    console.error('Cannot open folder browser: not authenticated');
    return;
  }

  // Reset folder browser state
  state.folderBrowser.isOpen = true;
  state.folderBrowser.loading = true;
  state.folderBrowser.error = null;
  state.folderBrowser.currentFolderId = null;
  state.folderBrowser.parentStack = [];
  state.folderBrowser.folders = [];
  state.folderBrowser.breadcrumbs = [{ id: null, name: 'Root' }];

  // Load root folders
  loadFolders();

  m.redraw();
}

// Function to load folders from Google Drive
function loadFolders(parentId = null) {
  chrome.runtime.sendMessage({
    action: 'listDriveFolders',
    parentId: parentId
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error listing folders:', chrome.runtime.lastError);
      state.folderBrowser.loading = false;
      state.folderBrowser.error = 'Failed to load folders: ' + chrome.runtime.lastError.message;
    } else if (response && response.success) {
      state.folderBrowser.loading = false;
      state.folderBrowser.folders = response.folders.files || [];
      console.log('Loaded folders:', state.folderBrowser.folders);
    } else {
      state.folderBrowser.loading = false;
      state.folderBrowser.error = response ? response.error : 'Unknown error';
      console.error('Failed to load folders:', state.folderBrowser.error);
    }
    m.redraw();
  });
}

// Store the current auth token
var currentAuthToken = null;

// Function to initiate Drive Auth via background script
function handleDriveAuth() {
  console.log('Requesting Drive authentication from background script...');

  // Check if this is a re-authentication by looking at the button text
  // We need to check this BEFORE changing the state to 'logging_in'
  const isReauth = state.driveAuthStatus === 'logged_in';
  console.log(`Initiating ${isReauth ? 're-authentication' : 'initial authentication'}`);

  // Now update the state
  state.driveAuthStatus = 'logging_in';
  m.redraw();

  chrome.runtime.sendMessage({
    action: 'initiateDriveAuth',
    reauth: isReauth, // This will be true if we were previously logged in
    currentToken: currentAuthToken
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Error sending initiateDriveAuth message:', chrome.runtime.lastError);
      state.driveAuthStatus = 'error';
    } else if (response && response.success) {
      console.log('Drive Auth Success reported by background script.');
      state.driveAuthStatus = 'logged_in';

      // Store the token for potential re-authentication
      if (response.token) {
        currentAuthToken = response.token;
        console.log('Received and stored new auth token (first 5 chars):',
                   currentAuthToken.substring(0, 5) + '...');
      }
    } else {
      console.error('Drive Auth Failed reported by background script:', response ? response.error : 'No response');
      state.driveAuthStatus = 'error';
    }
    m.redraw();
  });
}

// Function to check current auth status via background script
function checkDriveAuthStatus() {
   console.log('Requesting Drive auth status check from background script...');
   chrome.runtime.sendMessage({ action: 'checkDriveAuthStatus' }, (response) => {
     console.log('Received response for checkDriveAuthStatus:', response); // Log response
     if (chrome.runtime.lastError) {
       console.error('Error sending checkDriveAuthStatus message:', chrome.runtime.lastError);
       state.driveAuthStatus = 'error'; // Or maybe 'logged_out' is safer?
     } else if (response && response.isAuthenticated) {
       console.log('Setting driveAuthStatus to logged_in'); // Log state change
       state.driveAuthStatus = 'logged_in';

       // Get a fresh token to store for potential re-authentication
       chrome.identity.getAuthToken({ interactive: false }, (token) => {
         if (!chrome.runtime.lastError && token) {
           currentAuthToken = token;
           console.log('Retrieved and stored current auth token (first 5 chars):',
                      currentAuthToken.substring(0, 5) + '...');
         }
       });
     } else {
       console.log('Setting driveAuthStatus to logged_out'); // Log state change
       state.driveAuthStatus = 'logged_out';
       currentAuthToken = null; // Clear stored token
     }
     m.redraw();
   });
}
// Call it initially after loading config
// checkDriveAuthStatus(); // Call moved inside config loading callback above

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

m.mount(document.querySelector('main'), {
  view: () => [
    m('.row',
      m('.col-xxl-4.col-xl-4.col-lg-6.col-md-6.col-sm-12.s-col',
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
                m('.mdc-text-field s-textfield', {
                  oncreate: oncreate.textfield,
                  },
                  m('input.mdc-text-field__input', {
                    type: 'number',
                    value: state.delay,
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
      m('.col-xxl-4.col-xl-4.col-lg-6.col-md-6.col-sm-12',
        m('h3', 'Image Format'),
        m('.bs-callout',
          state.format.map((item) =>
            m('.row',
              m('.col-sm-12',
                m('label.s-label', {onupdate: onupdate(item)},
                  m('.mdc-radio',
                    m('input.mdc-radio__native-control', {
                      type: 'radio', name: 'format',
                      checked: item.checked && 'checked',
                      onchange: events.option('format', item)
                    }),
                    m('.mdc-radio__background',
                      m('.mdc-radio__outer-circle'),
                      m('.mdc-radio__inner-circle'),
                    ),
                  ),
                  m('span', item.title)
                ),
              ),
              item.id === 'jpeg' &&
              m('.col-sm-12', {class: !item.checked && 'disabled'},
                m('span.s-text', 'Quality'),
                m('.mdc-text-field s-textfield', {
                  oncreate: oncreate.textfield,
                  },
                  m('input.mdc-text-field__input', {
                    type: 'number',
                    value: state.quality,
                    onchange: events.option('quality', item),
                    disabled: !item.checked && 'disabled',
                    placeholder: '0-100', min: 0, max: 100
                  }),
                  m('.mdc-line-ripple')
                ),
              )
            )
          )
        ),

        m('h3', 'Screenshot Scaling'),
        m('.bs-callout.s-last',
          state.scaling.map((item) =>
            m('.row',
              m('.col-sm-12',
                m('label.s-label', {onupdate: onupdate(item)},
                  m('.mdc-radio',
                    m('input.mdc-radio__native-control', {
                      type: 'radio', name: 'scaling',
                      checked: item.checked && 'checked',
                      onchange: events.option('scaling', item)
                    }),
                    m('.mdc-radio__background',
                      m('.mdc-radio__outer-circle'),
                      m('.mdc-radio__inner-circle'),
                    ),
                  ),
                  m('span', item.title)
                )
              )
            )
          )
        ),
      ),
      m('.col-xxl-4.col-xl-4.col-lg-6.col-md-6.col-sm-12.s-col',
        m('h3', 'Save Format'),
        m('.bs-callout', {class: state.save.every(({checked}) => !checked) && 's-box-error'},
          state.save.map((item) =>
            m('.row',
              m('.col-sm-12',
                m('label.s-label.s-checkbox', {onupdate: onupdate(item)},
                  m('.mdc-checkbox',
                    m('input.mdc-checkbox__native-control', {
                      type: 'checkbox', name: 'save',
                      checked: item.checked && 'checked',
                      onchange: events.option('save', item)
                    }),
                    m('.mdc-checkbox__background',
                      m('svg.mdc-checkbox__checkmark', {viewBox: '0 0 24 24'},
                        m('path.mdc-checkbox__checkmark-path', {
                          fill: 'none', d: 'M1.73,12.91 8.1,19.28 22.79,4.59'
                        })
                      ),
                    ),
                  ),
                  m('span', item.title)
                ),
              ),
              item.id === 'file' &&
              m('.col-sm-12', {class: !item.checked && 'disabled'},
                m('span.s-text', 'Save Location'),
                m('button.mdc-button mdc-button--raised s-button', {
                  oncreate: oncreate.ripple,
                  onclick: events.button('location'),
                  disabled: !state.save.find(({id, checked}) => id === 'file' && checked) && 'disabled',
                  },
                  'Update'
                )
              ),
              item.id === 'clipboard' && [
                state.clipboard.map((item) =>
                  m('.col-sm-12', {class: !state.save.find(({id, checked}) => id === 'clipboard' && checked) && 'disabled'},
                    m('label.s-label', {onupdate: onupdate(item)},
                      m('.mdc-radio',
                        m('input.mdc-radio__native-control', {
                          type: 'radio', name: 'save', // Note: This should likely be 'clipboard' to be a separate group
                          checked: item.checked && 'checked',
                          disabled: !state.save.find(({id, checked}) => id === 'clipboard' && checked) && 'disabled',
                          onchange: events.option('clipboard', item)
                        }),
                        m('.mdc-radio__background',
                          m('.mdc-radio__outer-circle'),
                          m('.mdc-radio__inner-circle'),
                        ),
                      ),
                      m('span', item.title)
                    )
                  )
                ),
                m('.col-sm-12', {class: !state.save.find(({id, checked}) => id === 'clipboard' && checked) && 'disabled'},
                  m('label.s-label.s-checkbox', {onupdate: onupdate(state.dialog)},
                    m('.mdc-checkbox',
                      m('input.mdc-checkbox__native-control', {
                        type: 'checkbox', name: 'dialog',
                        checked: state.dialog && 'checked',
                        disabled: !state.save.find(({id, checked}) => id === 'clipboard' && checked) && 'disabled',
                        onchange: events.option('dialog')
                      }),
                      m('.mdc-checkbox__background',
                        m('svg.mdc-checkbox__checkmark', {viewBox: '0 0 24 24'},
                          m('path.mdc-checkbox__checkmark-path', {
                            fill: 'none', d: 'M1.73,12.91 8.1,19.28 22.79,4.59'
                          })
                        ),
                      ),
                    ),
                    m('span', 'Confirmation Dialog')
                  ),
                ),
              ],
              // Google Drive specific options
              item.id === 'drive' && [
                m('.col-sm-12', {class: !item.checked && 'disabled'},
                  m('span.s-text', 'Save Folder'),
                  m('.drive-folder-selector', [
                    m('span.selected-folder', state.driveFolderName || 'Root'),
                    m('button.mdc-button mdc-button--raised s-button', {
                      oncreate: oncreate.ripple,
                      onclick: events.button('browseFolders'),
                      disabled: !item.checked || state.driveAuthStatus !== 'logged_in'
                    }, 'Browse')
                  ])
                ),
                // **NEW**: Copy Link Checkbox
                m('.col-sm-12', {class: !item.checked && 'disabled'},
                  m('label.s-label.s-checkbox', {onupdate: onupdate(state.driveCopyLink)},
                    m('.mdc-checkbox',
                      m('input.mdc-checkbox__native-control', {
                        type: 'checkbox', name: 'driveCopyLink',
                        checked: state.driveCopyLink && 'checked',
                        disabled: !item.checked || state.driveAuthStatus !== 'logged_in',
                        onchange: events.option('driveCopyLink') // Use generic handler
                      }),
                      m('.mdc-checkbox__background',
                        m('svg.mdc-checkbox__checkmark', {viewBox: '0 0 24 24'},
                          m('path.mdc-checkbox__checkmark-path', {
                            fill: 'none', d: 'M1.73,12.91 8.1,19.28 22.79,4.59'
                          })
                        ),
                      ),
                    ),
                    m('span', 'Copy link after upload')
                  ),
                ),
                m('.col-sm-12', {class: !item.checked && 'disabled'},
                  m('span.s-text', 'Authentication'),
                  m('button.mdc-button mdc-button--raised s-button', {
                    oncreate: oncreate.ripple,
                    onclick: events.button('driveAuth'),
                    disabled: !item.checked || state.driveAuthStatus === 'logging_in'
                  },
                    state.driveAuthStatus === 'logged_in' ? 'Re-authenticate' :
                    state.driveAuthStatus === 'logging_in' ? 'Authenticating...' :
                    state.driveAuthStatus === 'error' ? 'Auth Error - Retry' :
                    'Authenticate'
                  ),
                  state.driveAuthStatus === 'logged_in' && m('span.s-text.s-auth-status.s-success', ' (Authenticated)'),
                  state.driveAuthStatus === 'error' && m('span.s-text.s-auth-status.s-error', ' (Error)')
                )
              ]
            )
          )
        ),
        m('h3', 'Extension Icon'),
        m('.bs-callout.s-last',
          state.icon.map((item) =>
            m('.row',
              m('.col-sm-12',
                m('label.s-label', {onupdate: onupdate(item)},
                  m('.mdc-radio',
                    m('input.mdc-radio__native-control', {
                      type: 'radio', name: 'icon',
                      checked: item.checked && 'checked',
                      onchange: events.option('icon', item)
                    }),
                    m('.mdc-radio__background',
                      m('.mdc-radio__outer-circle'),
                      m('.mdc-radio__inner-circle'),
                    ),
                  ),
                  m('span', item.title)
                )
              )
            )
          )
        ),
      ),
    ),
    // Render the folder browser modal
    state.folderBrowser.isOpen && m('.folder-browser-modal', [
      m('.folder-browser-overlay', { onclick: events.folderBrowser.close }),
      m('.folder-browser-content', [
        m('.folder-browser-header', [
          m('h3', 'Select Google Drive Folder'),
          m('button.folder-browser-close', { onclick: events.folderBrowser.close }, '×')
        ]),
        m('.folder-browser-breadcrumbs', [
          state.folderBrowser.breadcrumbs.map((crumb, index) => {
            const isLast = index === state.folderBrowser.breadcrumbs.length - 1;
            return [
              index > 0 && m('span.breadcrumb-separator', ' > '),
              isLast
                ? m('span.breadcrumb-current', crumb.name)
                : m('a.breadcrumb-link', {
                    onclick: () => {
                      // Navigate to this breadcrumb
                      state.folderBrowser.parentStack = state.folderBrowser.parentStack.slice(0, index);
                      state.folderBrowser.breadcrumbs = state.folderBrowser.breadcrumbs.slice(0, index + 1);
                      state.folderBrowser.loading = true;
                      state.folderBrowser.error = null;
                      state.folderBrowser.currentFolderId = crumb.id;
                      loadFolders(crumb.id);
                    }
                  }, crumb.name)
            ];
          })
        ]),
        m('.folder-browser-body', [
          state.folderBrowser.loading
            ? m('.folder-browser-loading', 'Loading folders...')
            : state.folderBrowser.error
              ? m('.folder-browser-error', state.folderBrowser.error)
              : state.folderBrowser.folders.length === 0
                ? m('.folder-browser-empty', 'No folders found in this location')
                : m('.folder-browser-folders',
                    state.folderBrowser.folders.map(folder =>
                      m('.folder-item', [
                        m('span.folder-icon', '📁'),
                        m('span.folder-name', folder.name),
                        m('.folder-actions', [
                          m('button.folder-select', {
                            onclick: () => events.folderBrowser.select(folder.id, folder.name)
                          }, 'Select'),
                          m('button.folder-open', {
                            onclick: () => events.folderBrowser.open(folder.id)
                          }, 'Open')
                        ])
                      ])
                    )
                  )
        ]),
        m('.folder-browser-footer', [
          state.folderBrowser.parentStack.length > 0 &&
            m('button.mdc-button mdc-button--raised s-button', {
              oncreate: oncreate.ripple,
              onclick: events.folderBrowser.back
            }, 'Back'),
          m('button.mdc-button mdc-button--raised s-button', {
            oncreate: oncreate.ripple,
            onclick: () => events.folderBrowser.select(null, 'Root')
          }, 'Use Root Folder'),
          m('button.mdc-button mdc-button--raised s-button', {
            oncreate: oncreate.ripple,
            onclick: events.folderBrowser.close
          }, 'Cancel')
        ])
      ])
    ])
  ]
})
