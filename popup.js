// popup.js
const port = chrome.runtime.connect({ name: "popup" });
port.onMessage.addListener((msg) => {
  const metricsDiv = document.getElementById("metrics");
  // Append the event info to the popup
  metricsDiv.innerHTML += `<p>${msg.event}: ${JSON.stringify(msg.data)}</p>`;
});

// (Optional) If you want the button to trigger an action:
document.getElementById('testStreamBtn').addEventListener('click', () => {
  // This sends a message to the background (if needed)
  port.postMessage({ type: 'TEST_STREAM' });
});
