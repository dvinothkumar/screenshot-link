
# Screenshot Link / Chrome Extension

**Install: [Chrome]**

# Features

- Secure by design
- Full screen capture
- Crop and capture
- Configurable Keyboard Shortcut
- Save screenshot as PNG image file to Google Drive
- Copy screenshot link or image from Google Drive page
- Unique screenshot date/time file name
- No special permissions required (beyond Google Drive access)
- Free and Open Source

# Options

1. Pin the extension to your browser toolbar
2. Click on the extension button using your **Right** Mouse Button
3. Select `Options` from the context menu

# Table of Contents

- **[Capture Method](#capture-method)**
- **[Google Drive Setup](#google-drive-setup)**
- **[Keyboard Shortcut](#keyboard-shortcut)**
- **[Save Location](#save-location)**
- **[Caveats](#caveats)**

# Capture Method

#### **`Crop and Capture`**

1. Activate the extension by using the [keyboard shortcut](#keyboard-shortcut) or by clicking on the extension button
    2. Hold down your left mouse button anywhere on the page and drag your mouse in any direction
    3. Release the mouse button when you are ready, the selected area will be captured

#### **`Full Screen Capture`**

1. Activate the extension by using the [keyboard shortcut](#keyboard-shortcut) or by clicking on the extension button
2. The visible area of the screen will be captured

# Google Drive Setup

Screenshots are saved directly to your Google Drive.

1. Go to the extension options page.
2. Under "Google Drive Authentication", click "Authenticate" and follow the prompts to grant the extension permission to access your Google Drive. The extension only requires permission create files (to save the screenshots).
3. Optionally, under "Google Drive Folder", paste the URL of a specific folder within your Drive where screenshots should be saved. By default, they are saved in the root "My Drive" folder.

**Important Note:** When screenshots are saved to Google Drive, they are automatically set to be **viewable by anyone with the link**. Exercise caution when sharing these links.

# Keyboard Shortcut

1. Navigate to `chrome://extensions/shortcuts`
2. Find the Screenshot Link extension and set key combination for the `Take Screenshot` action

# Caveats

The extension won't work on the following origins:

- chrome and extension settings pages - `chrome://` and `chrome-extension://`
- the official chrome web store - `https://chromewebstore.google.com/`
- your home page

To enable the extension on local `file:///` URLs:

1. Navigate to `chrome://extensions`
2. Locate the Screenshot Link extension and click on the `Details` button
3. Make sure that the `Allow access to file URLs` switch is turned on

- `Full Screen Capture` won't work on PDF documents, use `Crop and Capture` instead and select the entire screen area

# Manual Install

Note that you won't receive any future updates automatically!

## Load packed .crx

1. Go to [releases] and pick a release that you want to install
2. Download the `screenshot-link.crx` file
3. Navigate to `chrome://extensions`
4. Drag and drop the `markdown-viewer.crx` file into the `chrome://extensions` page

## Load unpacked .zip

1. Go to [releases] and pick a release that you want to install
2. Download the `screenshot-link.zip` file and extract it
3. Navigate to `chrome://extensions`
4. Make sure that the `Developer mode` switch is enabled
5. Click on the `Load unpacked` button and select the extracted directory

## Build

1. Clone this repository
2. Execute `sh build/package.sh chrome` # Note: build script now produces screenshot-link named files
3. Navigate to `chrome://extensions`
4. Make sure that the `Developer mode` switch is enabled
5. Click on the `Load unpacked` button and select the cloned directory

## Manifest v2

1. Clone the [mv2] branch (Screenshot Link v2.0) # Assuming branch name might change too
2. Navigate to `chrome://extensions`
3. Make sure that the `Developer mode` switch is enabled
4. Click on the `Load unpacked` button and select the cloned directory

# License

The MIT License (MIT)

Copyright (c) 2014-present Simeon Velichkov <simeonvelichkov@gmail.com> (https://github.com/simov/screenshot-capture) # Keep original repo link unless changed

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


  [chrome]: https://chromewebstore.google.com/detail/screenshot-capture/giabbpobpebjfegnpcclkocepcgockkc

  [releases]: https://github.com/simov/screenshot-capture/releases
  [mv2]: https://github.com/simov/screenshot-capture/tree/mv2
