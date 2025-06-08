import Port = chrome.runtime.Port;

const popupPortC: Port = chrome.runtime.connect({ name: "popup" });
popupPortC.onMessage.addListener((msg) => {
  const metricsDiv = document.getElementById("metrics");
  if (metricsDiv) {
      metricsDiv.innerHTML += `<p>${msg.event}: ${JSON.stringify(msg.data)}</p>`;
  }
});

document.getElementById('testStreamBtn')?.addEventListener('click', () => {
  popupPortC.postMessage({ type: 'TEST_STREAM' });
});
