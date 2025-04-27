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
  driveFolderName: 'My Drive',
  driveAuthStatus: 'checking',
  folderBrowser: {
    isOpen: false,
    loading: false,
    error: null,
    currentFolderId: null,
    parentStack: [],
    folders: [],
    breadcrumbs: [{ id: null, name: 'My Drive' }]
  }
}

chrome.storage.sync.get((config) => {
  state.method.forEach((item) => item.checked = item.id === config.method)
  if (config.format !== 'png') {
      chrome.storage.sync.set({ format: 'png' });
  }
  if (config.save !== 'drive') {
      chrome.storage.sync.set({ save: 'drive' });
  }
  // Removed icon loading logic
  state.delay = config.delay || 500
  state.driveFolderId = config.driveFolderId || ''
  state.driveFolderName = config.driveFolderId ? (config.driveFolderName || 'Selected Folder') : 'My Drive';
  state.saveToDrive = true;
  checkDriveAuthStatus();
})

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
  button: (action) => () => {
    if (action === 'driveAuth') {
      handleDriveAuth();
    } else if (action === 'browseFolders') {
      openFolderBrowser();
    } else if (action === 'driveResetAuth') {
      handleDriveResetAuth();
    } else {
      chrome.tabs.create({url: {
        shortcut: 'chrome://extensions/shortcuts',
      }[action]})
    }
  },
  folderBrowser: {
    close: () => {
      state.folderBrowser.isOpen = false;
      m.redraw();
    },
    open: (folderId = null) => {
      console.log(`Attempting to open folder: ${folderId === null ? 'My Drive' : folderId}`);
      state.folderBrowser.loading = true;
      state.folderBrowser.error = null;
      const previousFolderId = state.folderBrowser.currentFolderId;
      if (folderId !== null) {
        const folder = state.folderBrowser.folders.find(f => f.id === folderId);
        if (folder) {
          state.folderBrowser.parentStack.push(previousFolderId === null ? null : previousFolderId);
          console.log("Pushed to parent stack:", previousFolderId === null ? 'null (My Drive)' : previousFolderId);
          state.folderBrowser.breadcrumbs.push({ id: folderId, name: folder.name });
          console.log("Added breadcrumb:", folder.name);
        } else {
          console.warn("Folder details not found in current list when trying to open:", folderId);
          state.folderBrowser.error = "Could not find folder details to open it.";
          state.folderBrowser.loading = false;
          m.redraw();
          return;
        }
      } else {
        state.folderBrowser.breadcrumbs = [{ id: null, name: 'My Drive' }];
        state.folderBrowser.parentStack = [];
        console.log("Opening My Drive folder, reset stack and breadcrumbs");
      }
      state.folderBrowser.currentFolderId = folderId;
      console.log("Set currentFolderId to:", folderId);
      loadFolders(folderId);
    },
     back: () => {
      if (state.folderBrowser.parentStack.length > 0) {
        const parentId = state.folderBrowser.parentStack.pop();
        state.folderBrowser.breadcrumbs.pop();
        console.log("Navigating back to folder:", parentId === null ? 'My Drive' : parentId);
        state.folderBrowser.loading = true;
        state.folderBrowser.error = null;
        state.folderBrowser.currentFolderId = parentId;
        loadFolders(parentId);
      } else {
        console.warn("Back called with empty parent stack, going to My Drive.");
        state.folderBrowser.breadcrumbs = [{ id: null, name: 'My Drive' }];
        state.folderBrowser.parentStack = [];
        state.folderBrowser.loading = true;
        state.folderBrowser.error = null;
        state.folderBrowser.currentFolderId = null;
        loadFolders(null);
      }
    },
    select: (folderId, folderName) => {
      state.driveFolderId = folderId;
      state.driveFolderName = folderId === null ? 'My Drive' : (folderName || 'Selected Folder');
      chrome.storage.sync.set({
        driveFolderId: state.driveFolderId,
        driveFolderName: state.driveFolderName
      });
      state.folderBrowser.isOpen = false;
      m.redraw();
    }
  }
}

function openFolderBrowser() {
  if (state.driveAuthStatus !== 'logged_in') {
    console.error('Cannot open folder browser: not authenticated');
    return;
  }
  state.folderBrowser.isOpen = true;
  state.folderBrowser.loading = true;
  state.folderBrowser.error = null;
  state.folderBrowser.currentFolderId = null;
  state.folderBrowser.parentStack = [];
  state.folderBrowser.folders = [];
  state.folderBrowser.breadcrumbs = [{ id: null, name: 'My Drive' }];
  loadFolders();
  m.redraw();
}

function loadFolders(parentId = null) {
  chrome.runtime.sendMessage({
    action: 'listDriveFolders',
    parentId: parentId
  }, (response) => {
    console.log("Response received in options page from listDriveFolders:", JSON.stringify(response, null, 2));
    state.folderBrowser.loading = false;
    if (chrome.runtime.lastError) {
      console.error('Error receiving folder list from background:', chrome.runtime.lastError);
      state.folderBrowser.error = 'Error communicating with background script: ' + chrome.runtime.lastError.message;
    } else if (response && response.success) {
      if (response.folders && Array.isArray(response.folders.files)) {
        state.folderBrowser.folders = response.folders.files;
        state.folderBrowser.error = null;
        console.log('Successfully updated state.folderBrowser.folders:', state.folderBrowser.folders);
      } else {
        console.warn('listDriveFolders reported success, but response.folders.files is missing or not an array:', response.folders);
        state.folderBrowser.folders = [];
        state.folderBrowser.error = 'Received unexpected data structure for folders.';
      }
    } else {
      state.folderBrowser.error = response ? response.error : 'Unknown error fetching folders.';
      state.folderBrowser.folders = [];
      console.error('Background script reported failure loading folders:', state.folderBrowser.error);
    }
    m.redraw();
  });
}

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
      state.driveFolderId = '';
      state.driveFolderName = 'My Drive';
      chrome.storage.sync.remove(['driveFolderId', 'driveFolderName']);
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
        m('.bs-callout',
          m('.row',
            m('.col-sm-12', {style: 'display: flex; align-items: center; flex-wrap: wrap;'},
              m('span.s-text', {style: 'padding-left: 0; padding-right: 8px;'}, 'Save Folder:'),
              m('span.selected-folder', {style: 'margin-right: 10px;'}, state.driveFolderName || 'My Drive'),
              m('button.mdc-button mdc-button--raised s-button', {
                style: 'margin-left: auto;',
                oncreate: oncreate.ripple,
                onclick: events.button('browseFolders'),
                disabled: state.driveAuthStatus !== 'logged_in'
              }, 'Browse')
            )
          )
        ),
      ),
    ), // End of main .row

    // Folder browser modal (remains the same)
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
            onclick: () => events.folderBrowser.select(null, 'My Drive')
          }, 'Use My Drive'),
          m('button.mdc-button mdc-button--raised s-button', {
            oncreate: oncreate.ripple,
            onclick: events.folderBrowser.close
          }, 'Cancel')
        ])
      ])
    ])
  ]
})
