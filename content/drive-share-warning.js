console.log("Drive Share Warning Script Injected");

(function() {
  // Check if banner already exists
  if (document.getElementById('screenshot-link-share-warning')) {
    console.log("Warning banner already exists.");
    return;
  }

  const banner = document.createElement('div');
  banner.id = 'screenshot-link-share-warning';
  banner.style.position = 'fixed';
  banner.style.top = '10px'; // Position near the top
  banner.style.left = '50%';
  banner.style.transform = 'translateX(-50%)';
  banner.style.backgroundColor = '#fff3cd'; // Light yellow background
  banner.style.color = '#664d03'; // Dark yellow text
  banner.style.border = '1px solid #ffecb5';
  banner.style.padding = '10px 20px';
  banner.style.borderRadius = '5px';
  banner.style.zIndex = '99999'; // Ensure it's on top
  banner.style.fontSize = '14px';
  banner.style.fontFamily = 'Roboto, Arial, sans-serif'; // Match Drive's font
  banner.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
  banner.style.textAlign = 'center';

  banner.innerHTML = `
    ⚠️ <strong>Caution:</strong> This file is viewable by anyone with the link.
    <button id="screenshot-link-dismiss-warning" style="margin-left: 15px; background: none; border: none; color: #664d03; cursor: pointer; font-size: 16px; font-weight: bold;">&times;</button>
  `;

  document.body.appendChild(banner);

  // Add dismiss functionality
  const dismissButton = document.getElementById('screenshot-link-dismiss-warning');
  if (dismissButton) {
    dismissButton.onclick = function() {
      banner.style.display = 'none';
    };
  }

  console.log("Warning banner added.");

})();
