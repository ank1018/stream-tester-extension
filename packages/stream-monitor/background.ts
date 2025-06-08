let popupPort = null;
let panelPort: chrome.runtime.Port | null = null;

chrome.runtime.onConnect.addListener((port) => {
  console.log("[V_Extension] Connected:.............", port.name);
  if (port.name === "popup") {
    popupPort = port;
    port.onDisconnect.addListener(() => {
      popupPort = null;
    });
  } else if (port.name === "panel") {
    panelPort = port;
    port.onDisconnect.addListener(() => {
      panelPort = null;
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[V_Extension] Background script received message:.............", message);

    if (message.type === "METRIC_EVENT") {
      console.log("[V_Extension] Processing METRIC_EVENT.............");

      if (panelPort) {
        console.log("[V_Extension] Forwarding to panel................");
        panelPort.postMessage(message);
      } else {
        console.log("[V_Extension] Panel port not connected!.............");
      }

      sendResponse({status: "received"});
    }

    return true;
  });
