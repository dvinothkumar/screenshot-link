var jcrop, selection;
let isWaitingForCapture = false; // State for 'wait' mode
let currentConfig = {}; // Store config for reuse

var overlay = ((active) => (state) => {
  active = typeof state === 'boolean' ? state : state === null ? active : !active;
  // Also consider the waiting state for showing the overlay
  const shouldShow = active || isWaitingForCapture;
  $('.jcrop-holder')[shouldShow ? 'show' : 'hide']();

  // Send message including waiting state if applicable
  chrome.runtime.sendMessage({
    message: 'active',
    active: shouldShow, // True if cropping OR waiting
    isWaiting: isWaitingForCapture // Specifically indicate waiting state
  });
})(false);

var image = (done) => {
  var image = new Image();
  image.id = 'fake-image';
  image.src = chrome.runtime.getURL('/content/pixel.png');
  image.onload = () => {
    // Ensure body exists before appending
    if (document.body) {
        document.body.appendChild(image);
    } else {
        // Fallback or wait for body
        document.addEventListener('DOMContentLoaded', () => document.body.appendChild(image));
    }
    done();
  };
  image.onerror = () => {
      console.error("Failed to load fake image.");
      // Handle error, maybe skip Jcrop initialization
  };
};

var init = (config, done) => {
  console.log("Content script: Initializing Jcrop...");
  currentConfig = config; // Store config

  // Ensure fake image exists
  if (!$('#fake-image').length) {
      console.error("Fake image not found for Jcrop initialization.");
      return; // Cannot initialize Jcrop
  }

  $('#fake-image').Jcrop({
    bgColor: 'none',
    onSelect: (e) => { // Fires when selection is complete (mouse up)
      console.log("Content script: Jcrop onSelect fired:", e);
      selection = e;
      if (currentConfig.method === 'crop') {
        console.log("Content script: Mode is 'crop', capturing immediately.");
        capture(); // Call capture directly for 'crop' mode
      } else if (currentConfig.method === 'wait') {
        console.log("Content script: Mode is 'wait', setting waiting state.");
        isWaitingForCapture = true;
        // Update overlay/icon state via background
        chrome.runtime.sendMessage({ message: 'active', active: true, isWaiting: true });
        // Don't capture yet, wait for trigger
      }
    },
    onChange: (e) => { // Fires while dragging
      selection = e;
    },
    onRelease: (e) => { // Fires when selection is clicked away or Esc
      console.log("Content script: Jcrop onRelease fired");
      selection = null;
      isWaitingForCapture = false; // No longer waiting if selection released
      // Update overlay/icon state via background
      chrome.runtime.sendMessage({ message: 'active', active: false, isWaiting: false });
      // Hide overlay manually if needed, though sendMessage should handle it
      overlay(false);
    }
  }, function ready () {
    console.log("Content script: Jcrop ready callback fired.");
    jcrop = this;

    // Set correct background image URL for Jcrop UI elements
    $('.jcrop-hline, .jcrop-vline').css({
      backgroundImage: `url(${chrome.runtime.getURL('/vendor/Jcrop.gif')})`
    });

    // Restore previous selection if it exists (useful for resize/re-init)
    if (selection) {
      jcrop.setSelect([
        selection.x, selection.y,
        selection.x2, selection.y2
      ]);
    }

    done && done(); // Call the completion callback if provided
  });
};

// Capture function no longer needs 'force' parameter
var capture = () => {
  console.log(`Content script: capture() called. Current selection:`, selection ? JSON.stringify(selection) : 'null');

  // Use stored config
  const config = currentConfig;
  if (!config || !config.method) {
      console.error("Content script: Missing config for capture.");
      return;
  }
  console.log(`Content script: Capturing with method: ${config.method}, Selection:`, selection ? JSON.stringify(selection) : 'null');

  if (selection && (config.method === 'crop' || config.method === 'wait')) {
    console.log("Content script: Entering crop/wait capture logic.");
    const currentSelection = selection; // Store selection locally
    if (!currentSelection) {
        console.error("Content script: currentSelection is unexpectedly null/undefined inside if block.");
        isWaitingForCapture = false; // Reset state
        overlay(false);
        return; // Exit if selection was somehow cleared
    }

    // Send capture message immediately
    chrome.runtime.sendMessage({
      message: 'capture', format: config.format, quality: config.quality
    }, (res) => {
      // Reset waiting state regardless of success/failure after attempting capture
      isWaitingForCapture = false;

      if (chrome.runtime.lastError || !res || !res.image) {
        console.error("Failed to capture image:", chrome.runtime.lastError || "No image data received");
        overlay(false); // Hide overlay on error
        if (jcrop) {
          try { jcrop.release(); } catch (e) { console.error("Error releasing Jcrop:", e); }
        }
        selection = null; // Clear selection state
        // Update icon state via background
        chrome.runtime.sendMessage({ message: 'active', active: false, isWaiting: false });
        return;
      }

      // Process the valid response
      overlay(false); // Hide overlay first
      if (jcrop) {
        try { jcrop.release(); } catch (e) { console.error("Error releasing Jcrop:", e); }
      }
      crop(res.image, currentSelection, devicePixelRatio, config.scaling, config.format, (image) => {
        save(image, config.format, config.save, config.clipboard, config.dialog);
        selection = null; // Clear selection state after saving
        // Update icon state via background
        chrome.runtime.sendMessage({ message: 'active', active: false, isWaiting: false });
      });
    });
  }
  // Viewport and Page capture logic remains the same
  else if (config.method === 'view') {
    chrome.runtime.sendMessage({
      message: 'capture', format: config.format, quality: config.quality
    }, (res) => {
      overlay(false)
      if (chrome.runtime.lastError || !res || !res.image) {
          console.error("Failed to capture viewport:", chrome.runtime.lastError || "No image data received");
          return;
      }
      if (devicePixelRatio !== 1 && !config.scaling) {
        var area = {x: 0, y: 0, w: innerWidth, h: innerHeight}
        crop(res.image, area, devicePixelRatio, config.scaling, config.format, (image) => {
          save(image, config.format, config.save, config.clipboard, config.dialog)
        })
      }
      else {
        save(res.image, config.format, config.save, config.clipboard, config.dialog)
      }
    })
  }
  else if (config.method === 'page') {
    // Page capture logic... (remains unchanged)
    var container = ((html = document.querySelector('html')) => (
      html.scrollTop = 1,
      html.scrollTop ? (html.scrollTop = 0, html) : document.querySelector('body')
    ))()
    container.scrollTop = 0
    document.querySelector('html').style.overflow = 'hidden'
    document.querySelector('body').style.overflow = 'hidden'
    setTimeout(() => {
      var images = []
      var count = 0
      ;(function scroll (done) {
        chrome.runtime.sendMessage({
          message: 'capture', format: config.format, quality: config.quality
        }, (res) => {
          if (chrome.runtime.lastError || !res || !res.image) {
              console.error("Failed to capture page segment:", chrome.runtime.lastError || "No image data received");
              // Clean up and exit page capture
              overlay(false);
              document.querySelector('html').style.overflow = '';
              document.querySelector('body').style.overflow = '';
              return;
          }
          var height = innerHeight
          if (count * innerHeight > container.scrollTop) {
            height = container.scrollTop - (count - 1) * innerHeight
          }
          images.push({height, offset: container.scrollTop, image: res.image})

          if (
            (count * innerHeight === container.scrollTop &&
            (count - 1) * innerHeight === container.scrollTop) ||
            count * innerHeight > container.scrollTop
            ) {
            done()
            return
          }

          count += 1
          container.scrollTop = count * innerHeight
          setTimeout(() => {
            if (count * innerHeight !== container.scrollTop) {
              container.scrollTop = count * innerHeight
            }
            scroll(done)
          }, config.delay)
        })
      })(() => {
        overlay(false)
        var area = {x: 0, y: 0, w: innerWidth, h: images.reduce((all, {height}) => all += height, 0)}
        crop(images, area, devicePixelRatio, config.scaling, config.format, (image) => {
          document.querySelector('html').style.overflow = ''
          document.querySelector('body').style.overflow = ''
          save(image, config.format, config.save, config.clipboard, config.dialog)
        })
      })
    }, config.delay)
  }
};

var filename = (format) => {
  var pad = (n) => (n = n + '', n.length >= 2 ? n : `0${n}`)
  var ext = (format) => format === 'jpeg' ? 'jpg' : format === 'png' ? 'png' : 'png'
  var timestamp = (now) =>
    [pad(now.getFullYear()), pad(now.getMonth() + 1), pad(now.getDate())].join('-')
    + ' - ' +
    [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('-')
  return `Screenshot Capture - ${timestamp(new Date())}.${ext(format)}`
}

var save = (image, format, save, clipboard, dialog) => {
  if (save.includes('file')) {
    var link = document.createElement('a')
    link.download = filename(format)
    link.href = image
    link.click()
  }
  if (save.includes('clipboard')) {
    if (clipboard === 'url') {
      navigator.clipboard.writeText(image).then(() => {
        if (dialog) {
          alert([
            'Screenshot Capture:',
            'Data URL String',
            'Saved to Clipboard!'
          ].join('\n'))
        }
      })
    }
    else if (clipboard === 'binary') {
      var [header, base64] = image.split(',')
      var [_, type] = /data:(.*);base64/.exec(header)
      var binary = atob(base64)
      var array = Array.from({length: binary.length})
        .map((_, index) => binary.charCodeAt(index))
      navigator.clipboard.write([
        new ClipboardItem({
          'image/png': new Blob([new Uint8Array(array)], {type: 'image/png'})
        })
      ]).then(() => {
        if (dialog) {
          alert([
            'Screenshot Capture:',
            'Binary Image',
            'Saved to Clipboard!'
          ].join('\n'))
        }
      })
    }
  }
  // Add Google Drive upload trigger
  if (save.includes('drive')) {
    setTimeout(() => {
      console.log('Sending uploadToDrive message to background script.');
      chrome.runtime.sendMessage({
        action: 'uploadToDrive',
        imageDataUrl: image,
        filename: filename(format)
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Error sending uploadToDrive message:', chrome.runtime.lastError);
          alert('Error initiating Google Drive upload. Please check console.');
        } else if (response && !response.success) {
          console.error('Background script reported upload failure:', response.error);
          alert(`Google Drive upload failed: ${response.error || 'Unknown error'}`);
        } else {
          console.log('Background script acknowledged uploadToDrive message.');
          if (dialog && !save.includes('clipboard')) {
             alert('Screenshot sent for Google Drive upload.');
          }
        }
      });
    }, 100);
  }
}

window.addEventListener('resize', ((timeout) => () => {
  clearTimeout(timeout)
  timeout = setTimeout(() => {
    if (jcrop) {
      try {
        console.log("Content script: Destroying Jcrop on resize");
        jcrop.destroy();
      } catch (e) {
        console.error("Content script: Error destroying Jcrop on resize:", e);
      } finally {
        jcrop = null; // Ensure jcrop is nullified
        selection = null; // Clear selection on resize
        isWaitingForCapture = false; // Reset waiting state
        // Remove Jcrop UI elements explicitly
        $('.jcrop-holder').remove();
        $('.jcrop-tracker').remove();
        $('#fake-image').remove();
        // Update icon state via background
        chrome.runtime.sendMessage({ message: 'active', active: false, isWaiting: false });
      }
    }
    // Reinitialize only if needed (e.g., if user clicks icon again)
    // image(() => init(() => overlay(null))) // Avoid auto-reinit on resize
  }, 100)
})())

// --- New Message Listener ---
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  console.log("Content script received message:", req.message); // Log received messages

  if (req.message === 'init') {
    // Acknowledge the message immediately
    sendResponse({});

    // Get current config first
    chrome.storage.sync.get((config) => {
        currentConfig = config; // Store config

        // Always clean up existing Jcrop if present
        if (jcrop) {
            try {
                console.log("Content script: Cleaning up existing Jcrop instance for init");
                jcrop.destroy();
            } catch (e) {
                console.error("Content script: Error destroying Jcrop:", e);
            } finally {
                jcrop = null;
                selection = null;
                isWaitingForCapture = false;
                $('.jcrop-holder').remove();
                $('.jcrop-tracker').remove();
                $('#fake-image').remove();
            }
        } else {
            // Ensure any lingering UI is removed even if jcrop instance is null
            $('.jcrop-holder').remove();
            $('.jcrop-tracker').remove();
            $('#fake-image').remove();
            selection = null;
            isWaitingForCapture = false;
        }

        // Initialize image and Jcrop
        image(() => init(config, () => { // Pass config to init
            overlay(true); // Show overlay for selection/view/page modes
            // Only capture immediately for 'view' and 'page' modes
            if (config.method === 'view' || config.method === 'page') {
                console.log(`Content script: Mode is '${config.method}', capturing immediately.`);
                capture();
            } else {
                console.log(`Content script: Mode is '${config.method}', waiting for selection or trigger.`);
            }
        }));
    });
    return true; // Keep channel open for async response from storage.sync.get
  }
  else if (req.message === 'queryState') {
    console.log("Content script: Responding to queryState:", { isActive: !!jcrop, isWaiting: isWaitingForCapture });
    sendResponse({ isActive: !!jcrop, isWaiting: isWaitingForCapture });
    return false; // Synchronous response
  }
  else if (req.message === 'triggerCapture') {
    console.log("Content script: Received triggerCapture.");
    if (isWaitingForCapture && selection) {
      console.log("Content script: Triggering capture for waiting selection.");
      capture(); // Call capture now
    } else {
      console.warn("Content script: Received triggerCapture but not waiting or no selection.");
      // Optionally send back a failure or just ignore
    }
    return false; // Synchronous processing
  }
  // Keep the return true for the original 'init' message if needed elsewhere,
  // but specific handlers should return false if synchronous.
  // If adding more async handlers, ensure they return true.
});
