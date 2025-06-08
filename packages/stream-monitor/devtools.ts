console.log("[V_Extension] devtools.js script is running.............");

function onPanelCreated(panel: any) {
  console.log("[V_Extension] Video Metrics panel created in DevTools...........", panel);
}

chrome.devtools.panels.create(
  "FC Video Metrics",
  "",
  "panel.html",
  onPanelCreated
);
