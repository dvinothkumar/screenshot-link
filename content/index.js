var jcrop, selection;
// let isWaitingForCapture = false; // State for 'wait' mode - REMOVED
let currentConfig = {}; // Store config for reuse

var overlay = ((active) => (state) => {
  active = typeof state === 'boolean' ? state : state === null ? active : !active;
  // const shouldShow = active || isWaitingForCapture; // Simplified - wait mode removed
  const shouldShow = active;
  $('.jcrop-holder')[shouldShow ? 'show' : 'hide']();

  // Send message - wait state removed
  chrome.runtime.sendMessage({
    message: 'active',
    active: shouldShow // True if cropping
    // isWaiting: isWaitingForCapture // Specifically indicate waiting state - REMOVED
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
      // Only 'crop' method remains for selection-based capture
      if (currentConfig.method === 'crop') {
        console.log("Content script: Mode is 'crop', capturing immediately.");
        capture(); // Call capture directly for 'crop' mode
      }
      // 'wait' mode logic removed
    },
    onChange: (e) => { // Fires while dragging
      selection = e;
    },
    onRelease: (e) => { // Fires when selection is clicked away or Esc
      console.log("Content script: Jcrop onRelease fired");
      selection = null;
      // isWaitingForCapture = false; // No longer waiting if selection released - REMOVED
      // Update overlay/icon state via background - wait state removed
      chrome.runtime.sendMessage({ message: 'active', active: false });
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

  // Simplified: Only 'crop' method uses selection now
  if (selection && config.method === 'crop') {
    console.log("Content script: Entering crop capture logic.");
    const currentSelection = selection; // Store selection locally
    if (!currentSelection) {
        console.error("Content script: currentSelection is unexpectedly null/undefined inside if block.");
        // isWaitingForCapture = false; // Reset state - REMOVED
        overlay(false);
        return; // Exit if selection was somehow cleared
    }

    // Send capture message immediately (quality removed)
    chrome.runtime.sendMessage({
      message: 'capture', format: config.format /* quality: config.quality */
    }, (res) => {
      // Reset waiting state regardless of success/failure after attempting capture - REMOVED
      // isWaitingForCapture = false;

      if (chrome.runtime.lastError || !res || !res.image) {
        console.error("Failed to capture image:", chrome.runtime.lastError || "No image data received");
        overlay(false); // Hide overlay on error
        if (jcrop) {
          try { jcrop.release(); } catch (e) { console.error("Error releasing Jcrop:", e); }
        }
        selection = null; // Clear selection state
        // Update icon state via background - wait state removed
        chrome.runtime.sendMessage({ message: 'active', active: false });
        return;
      }

      // Process the valid response
      overlay(false); // Hide overlay first
      if (jcrop) {
        try { jcrop.release(); } catch (e) { console.error("Error releasing Jcrop:", e); }
      }
      // Removed config.scaling from crop call
      crop(res.image, currentSelection, devicePixelRatio, /* config.scaling */ true, config.format, (image) => {
        // Removed config.clipboard and config.dialog from save call
        save(image, config.format, config.save /*, config.clipboard, config.dialog */);
        selection = null; // Clear selection state after saving
        // Update icon state via background - wait state removed
        chrome.runtime.sendMessage({ message: 'active', active: false });
      });
    });
  }
  // Viewport and Page capture logic remains the same
  else if (config.method === 'view') {
    chrome.runtime.sendMessage({
      message: 'capture', format: config.format /* quality: config.quality */
    }, (res) => {
      overlay(false)
      if (chrome.runtime.lastError || !res || !res.image) {
          console.error("Failed to capture viewport:", chrome.runtime.lastError || "No image data received");
          return;
      }
      // Removed scaling check and associated crop/save calls
      // if (devicePixelRatio !== 1 && !config.scaling) {
      //   var area = {x: 0, y: 0, w: innerWidth, h: innerHeight}
      //   crop(res.image, area, devicePixelRatio, /* config.scaling */ true, config.format, (image) => {
      //     save(image, config.format, config.save /*, config.clipboard, config.dialog */)
      //   })
      // }
      // else {
        // Removed config.clipboard and config.dialog from save call
        save(res.image, config.format, config.save /*, config.clipboard, config.dialog */)
      // }
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
          message: 'capture', format: config.format /* quality: config.quality */
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
        // Removed config.scaling from crop call
        crop(images, area, devicePixelRatio, /* config.scaling */ true, config.format, (image) => {
          document.querySelector('html').style.overflow = ''
          document.querySelector('body').style.overflow = ''
          // Removed config.clipboard and config.dialog from save call
          save(image, config.format, config.save /*, config.clipboard, config.dialog */)
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
  return `Screenshot Link - ${timestamp(new Date())}.${ext(format)}` // Updated name
}

// Simplified save function as only 'drive' is possible
var save = (image, format, save /*, clipboard, dialog */) => {
  // Only 'drive' save logic remains
  if (save === 'drive') {
    // Removed setTimeout wrapper
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
          // Removed dialog check
          // if (dialog && !save.includes('clipboard')) {
          //    alert('Screenshot sent for Google Drive upload.');
          // }
        }
      });
    // Removed setTimeout wrapper closing parts
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
        // isWaitingForCapture = false; // Reset waiting state - REMOVED
        // Remove Jcrop UI elements explicitly
        $('.jcrop-holder').remove();
        $('.jcrop-tracker').remove();
        $('#fake-image').remove();
        // Update icon state via background - wait state removed
        chrome.runtime.sendMessage({ message: 'active', active: false });
      }
    }
    // Reinitialize only if needed (e.g., if user clicks icon again)
    // image(() => init(() => overlay(null))) // Avoid auto-reinit on resize
  }, 100)
})())

// --- New Message Listener ---
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  console.log("Content script received message:", req.message); // Log received messages

  // Removed driveUploadComplete message handler
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
                // isWaitingForCapture = false; // REMOVED
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
            // isWaitingForCapture = false; // REMOVED
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
    // console.log("Content script: Responding to queryState:", { isActive: !!jcrop, isWaiting: isWaitingForCapture }); // Simplified log
    console.log("Content script: Responding to queryState:", { isActive: !!jcrop });
    // sendResponse({ isActive: !!jcrop, isWaiting: isWaitingForCapture }); // Simplified response
    sendResponse({ isActive: !!jcrop });
    return false; // Synchronous response
  }
  // Removed triggerCapture listener as it was only for 'wait' mode
  // else if (req.message === 'triggerCapture') { ... }

  // Keep the return true for the original 'init' message if needed elsewhere,
  // but specific handlers should return false if synchronous.
  // If adding more async handlers, ensure they return true.
});
