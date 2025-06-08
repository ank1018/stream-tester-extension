console.log("[V_Extension] Content script loaded on............", window.location.href);

const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function () {
  console.log("[V_Extension] Injected script loaded successfully...............");
  // @ts-ignore
  this.remove(); // Cleanup after the script is loaded
};
script.onerror = function (err) {
  console.error("Failed to load injected.js...............", err);
};
(document.head || document.documentElement).appendChild(script);

window.addEventListener('VideoPlayerEvent', function (e) {
  // @ts-ignore
  const { eventName, data, timestamp } = e.detail;
  let enhancedData = data;
  if (typeof data === 'string') {  // TODO: check if needed
    console.log(`Event ${eventName} has string data: ${data}`);
    enhancedData = { message: data };
  }

  try {
    chrome.runtime.sendMessage({
      type: 'METRIC_EVENT',
      event: eventName,
      data: enhancedData,
      timestamp
    });
  } catch (error) {
    console.error("Failed to send message:", error);
  }
});
