console.log("drive-copy-button.js injected");

(function() {
  // Check if the container already exists
  if (document.getElementById('screenshot-link-button-container')) {
    console.log("Button container already exists.");
    return;
  }

  // --- Create Container ---
  const container = document.createElement('div');
  container.id = 'screenshot-link-button-container';
  Object.assign(container.style, {
    position: 'fixed',
    top: '60px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '999999',
    display: 'flex', // Use flexbox for layout
    gap: '10px' // Add space between buttons
  });

  // --- Create Copy Link Button ---
  const copyLinkButton = document.createElement('button');
  copyLinkButton.id = 'screenshot-link-copy-link-button';
  copyLinkButton.textContent = 'Copy Link';
  Object.assign(copyLinkButton.style, {
    padding: '12px 20px',
    backgroundColor: '#1a73e8',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
    transition: 'background-color 0.2s ease'
  });
  copyLinkButton.onmouseover = () => copyLinkButton.style.backgroundColor = '#1765cc';
  copyLinkButton.onmouseout = () => copyLinkButton.style.backgroundColor = '#1a73e8'; // Default blue

  copyLinkButton.addEventListener('click', () => {
    const urlToCopy = window.location.href;
    navigator.clipboard.writeText(urlToCopy).then(() => {
      console.log('Link copied to clipboard:', urlToCopy);
      copyLinkButton.textContent = 'Link Copied!';
      copyLinkButton.style.backgroundColor = '#0F9D58'; // Google green
      copyLinkButton.onmouseout = () => copyLinkButton.style.backgroundColor = '#0F9D58';
      setTimeout(() => {
        copyLinkButton.textContent = 'Copy Link';
        copyLinkButton.style.backgroundColor = '#1a73e8';
        copyLinkButton.onmouseout = () => copyLinkButton.style.backgroundColor = '#1a73e8';
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy link:', err);
      copyLinkButton.textContent = 'Copy Failed!';
      copyLinkButton.style.backgroundColor = '#DB4437'; // Google red
      copyLinkButton.onmouseout = () => copyLinkButton.style.backgroundColor = '#DB4437';
       setTimeout(() => {
        copyLinkButton.textContent = 'Copy Link';
        copyLinkButton.style.backgroundColor = '#1a73e8';
        copyLinkButton.onmouseout = () => copyLinkButton.style.backgroundColor = '#1a73e8';
      }, 2000);
    });
  });

  // --- Create Copy Image Button ---
  const copyImageButton = document.createElement('button');
  copyImageButton.id = 'screenshot-link-copy-image-button';
  copyImageButton.textContent = 'Copy Image';
   Object.assign(copyImageButton.style, {
    padding: '12px 20px',
    backgroundColor: '#1a73e8', // Same initial style as copy link
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
    transition: 'background-color 0.2s ease'
  });
  copyImageButton.onmouseover = () => copyImageButton.style.backgroundColor = '#1765cc';
  copyImageButton.onmouseout = () => copyImageButton.style.backgroundColor = '#1a73e8'; // Default blue

  copyImageButton.addEventListener('click', async () => {
    copyImageButton.textContent = 'Copying...';
    copyImageButton.disabled = true;
    copyImageButton.style.cursor = 'default';
    copyImageButton.style.backgroundColor = '#fbbc05'; // Google yellow for processing

    try {
      // Find the main image element (heuristic: largest visible image)
      const images = Array.from(document.querySelectorAll('img'));
      let targetImage = null;
      let maxArea = 0;

      images.forEach(img => {
        if (img.offsetParent !== null && img.naturalWidth > 100 && img.naturalHeight > 100) { // Basic visibility and size check
           const area = img.clientWidth * img.clientHeight;
           if (area > maxArea) {
               maxArea = area;
               targetImage = img;
           }
        }
      });

      if (!targetImage) {
        throw new Error("Could not find the main image on the page.");
      }
      console.log("Found target image:", targetImage.src);

      // Always use canvas to convert to PNG for clipboard compatibility
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = targetImage.naturalWidth;
      canvas.height = targetImage.naturalHeight;

      // Load image with crossOrigin attribute to handle potential CORS
      const imgToDraw = new Image();
      imgToDraw.crossOrigin = "Anonymous";
      imgToDraw.src = targetImage.src; // Use the src from the found image

      // Wait for the image to load
      await new Promise((resolve, reject) => {
          imgToDraw.onload = resolve;
          imgToDraw.onerror = (err) => reject(new Error(`Failed to load image for canvas drawing: ${err.type || 'Unknown error'}`));
      });

      // Draw the image onto the canvas
      ctx.drawImage(imgToDraw, 0, 0);

      // Get the canvas content as a PNG blob
      const pngBlob = await new Promise((resolve, reject) => {
          canvas.toBlob((blob) => {
              if (blob) {
                  resolve(blob);
              } else {
                  reject(new Error("Canvas toBlob returned null."));
              }
          }, 'image/png');
      });

      if (!pngBlob) {
          throw new Error("Could not convert canvas to PNG blob.");
      }

      // Copy the PNG blob to the clipboard
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': pngBlob // Explicitly use PNG type
        })
      ]);

      console.log('Image copied to clipboard successfully.');
      copyImageButton.textContent = 'Image Copied!';
      copyImageButton.style.backgroundColor = '#0F9D58'; // Google green
      copyImageButton.onmouseout = () => copyImageButton.style.backgroundColor = '#0F9D58';

    } catch (err) {
      console.error('Failed to copy image:', err);
      copyImageButton.textContent = 'Copy Failed!';
      copyImageButton.style.backgroundColor = '#DB4437'; // Google red
      copyImageButton.onmouseout = () => copyImageButton.style.backgroundColor = '#DB4437';
    } finally {
      // Reset button after a delay
      setTimeout(() => {
        copyImageButton.textContent = 'Copy Image';
        copyImageButton.disabled = false;
        copyImageButton.style.cursor = 'pointer';
        copyImageButton.style.backgroundColor = '#1a73e8';
        copyImageButton.onmouseout = () => copyImageButton.style.backgroundColor = '#1a73e8';
      }, 2000);
    }
  });

  // Append buttons to the container
  container.appendChild(copyLinkButton);
  container.appendChild(copyImageButton);

  // Append the container to the body
  requestAnimationFrame(() => {
     if (document.body) {
         document.body.appendChild(container);
         console.log("Button container added to the page.");
     } else {
         console.error("Could not find document.body to append the button container.");
     }
  });

})();
