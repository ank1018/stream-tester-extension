const port = chrome.runtime.connect({ name: "popup" });
port.onMessage.addListener((msg) => {
  const metricsDiv = document.getElementById("metrics");
  metricsDiv.innerHTML += `<p>${msg.event}: ${JSON.stringify(msg.data)}</p>`;
});

document.getElementById('testStreamBtn').addEventListener('click', () => {
  port.postMessage({ type: 'TEST_STREAM' });
});
