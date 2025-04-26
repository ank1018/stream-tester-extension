console.log("[V_Extension] Panel script loaded");

let lastGraphQLOperation = null;
let isReloading = false;

class SimpleChart {
  constructor(svgId, pathId, areaId, maxPoints = 20, minY = 0, maxY = 100) {
    this.svg = document.getElementById(svgId);
    this.path = document.getElementById(pathId);
    this.area = document.getElementById(areaId);
    this.maxPoints = maxPoints;
    this.minY = minY;
    this.maxY = maxY;
    this.points = [];
    this.width = 400;
    this.height = 200;
    this.paddingLeft = 40;
    this.paddingRight = 20;
    this.paddingTop = 20;
    this.paddingBottom = 20;

    this.timeLabels = [];
  }

  addPoint(value, label) {
    console.log(`[V_Extension] Adding point to ${this.path.id}: ${value}`);
    this.points.push({ value, label });
    if (this.points.length > this.maxPoints) {
      this.points.shift();
    }

    if (value > this.maxY * 0.9) {
      this.maxY = Math.ceil(value * 1.2 / 100) * 100;
    }

    this.update();
  }

  update() {
    if (this.points.length < 2) return;

    const chartWidth = this.width - this.paddingLeft - this.paddingRight;
    const chartHeight = this.height - this.paddingTop - this.paddingBottom;
    const xInterval = chartWidth / (this.maxPoints - 1);

    let linePath = '';
    let areaPath = '';

    this.points.forEach((point, index) => {
      const x = this.paddingLeft + (index * xInterval);
      const y = this.height - this.paddingBottom -
        (((point.value - this.minY) / (this.maxY - this.minY)) * chartHeight);

      if (index === 0) {
        linePath = `M ${x} ${y}`;
        areaPath = `M ${x} ${this.height - this.paddingBottom} L ${x} ${y}`;
      } else {
        linePath += ` L ${x} ${y}`;
        areaPath += ` L ${x} ${y}`;
      }
    });

    const lastX = this.paddingLeft + ((this.points.length - 1) * xInterval);
    areaPath += ` L ${lastX} ${this.height - this.paddingBottom} Z`;

    this.path.setAttribute('d', linePath);
    this.area.setAttribute('d', areaPath);
    console.log(`[V_Extension] Updated chart path: ${linePath.substring(0, 50)}...`);
  }

  clear() {
    this.points = [];
    this.path.setAttribute('d', '');
    this.area.setAttribute('d', '');
  }
}

const bufferChart = new SimpleChart('bufferChart', 'bufferPath', 'bufferArea', 20, 0, 30);

const metrics = {
  startupTime: null,
  bitrates: [],
  bufferLevels: [],
  droppedFrames: 0,
  resolution: '--',
  frameRate: '--',
  qualityLevel: '--',
  graphqlData: {},
  lastGraphqlResponse: null,
  sessionInfo: {
    session: null,
    error: null,
    maxSessionLimit: null
  },
  streamInfo: {
    csai: null,
    ssai: null,
    drm: null,
    wm: null,
    title: null,
    url: null,
    contentType: null,
    contentId: null
  },
  scteEvents: [],
  activeAdBreak: null
};

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function logEvent(eventName, data, timestamp) {
  console.log("[V_Extension] logEvent.................", eventName)
  const eventLog = document.getElementById('eventLog');
  const time = formatTime(timestamp);
  const logEntry = document.createElement('div');
  logEntry.className = 'log-entry';
  logEntry.innerHTML = `
    <span class="log-time">[${time}]</span> 
    <span class="log-event">${eventName}</span>: 
    ${typeof data === 'object' ? JSON.stringify(data) : data}
  `;
  eventLog.prepend(logEntry);

  if (eventLog.children.length > 100) {
    eventLog.removeChild(eventLog.lastChild);
  }
}

metrics.allStreamSources = [];
metrics.selectedSourceIndex = 0;

// Add event listener for the source dropdown
document.addEventListener('DOMContentLoaded', function () {
  const headerActions = document.querySelector('.header-actions');
  const reloadButton = document.createElement('button');
  reloadButton.id = 'reloadMonitoring';
  reloadButton.className = 'reload-button';
  reloadButton.innerHTML = '↻ Reload';
  reloadButton.style.backgroundColor = '#3498db';
  reloadButton.style.color = 'white';
  reloadButton.style.border = 'none';
  reloadButton.style.borderRadius = '4px';
  reloadButton.style.padding = '8px 16px';
  reloadButton.style.fontSize = '14px';
  reloadButton.style.cursor = 'pointer';
  reloadButton.style.marginLeft = '10px';
  headerActions.appendChild(reloadButton);

  reloadButton.addEventListener('click', function () {
    console.log('[V_Extension] Reload button clicked');
    logEvent('System', 'Reload button clicked', Date.now());

    chrome.devtools.inspectedWindow.eval(
      'console.log("[V_Extension] Requesting video monitoring reload");' +
      'window.dispatchEvent(new CustomEvent("ReloadVideoMonitoring"));',
      function (result, isException) {
        if (isException) {
          console.error('[V_Extension] Error sending reload message:', isException);
        }
      }
    );

    logEvent('System', 'Reload requested', Date.now());
  });

  const sourceSelector = document.getElementById('sourceSelector');
  if (sourceSelector) {
    sourceSelector.addEventListener('change', function (e) {
      const selectedIndex = parseInt(e.target.value);
      if (!isNaN(selectedIndex) && metrics.allStreamSources[selectedIndex]) {
        metrics.selectedSourceIndex = selectedIndex;
        updateStreamDetails(getSelectedSourceInfo());
      }
    });
  }
});

function getSelectedSourceInfo() {
  if (metrics.allStreamSources.length > 0) {
    const source = metrics.allStreamSources[metrics.selectedSourceIndex];
    return {
      csai: source.csai,
      ssai: source.ssai,
      drm: source.drm,
      wm: source.wm,
      contentType: metrics.streamContentType,
      contentId: metrics.streamContentId,
      deliveryType: source.deliveryType,
      title: source.title,
      url: source.url,
      networkProtocol: source.networkProtocol
    };
  }
  return metrics.streamInfo;
}

function populateSourceSelector(sources) {
  const selector = document.getElementById('sourceSelector');
  if (!selector) return;

  selector.innerHTML = '';

  sources.forEach((source, index) => {
    const option = document.createElement('option');
    option.value = index;

    let sourceName = `Source ${index + 1}`;
    if (source.deliveryType) {
      sourceName += ` (${source.deliveryType})`;
    }
    if (source.networkProtocol) {
      sourceName += ` - ${source.networkProtocol}`;
    }

    option.textContent = sourceName;
    selector.appendChild(option);
  });

  if (sources.length > 0) {
    selector.value = metrics.selectedSourceIndex;
  }
}

function processMetrics(eventName, data, timestamp) {
  console.log(`[V_Extension] Processing metrics for ${eventName}:..............`, data);
  const timeLabel = formatTime(timestamp);

  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      console.log("[V_Extension] Data is not JSON:", data);
    }
  }

  switch (eventName) {
    case 'startup':
      if (data && data.startupTime) {
        metrics.startupTime = data.startupTime;
        document.getElementById('startupTime').textContent = data.startupTime;
      }
      break;

    case 'qualityChange':
      if (data && data.bitrate) {
        const bitrateKbps = Math.round(parseFloat(data.bitrate) / 1000);
        metrics.bitrates.push(bitrateKbps);
        document.getElementById('currentBitrate').textContent = bitrateKbps;
        bitrateChart.addPoint(bitrateKbps, timeLabel);
      }

      if (data && data.resolution) {
        metrics.resolution = data.resolution;
        document.getElementById('currentResolution').textContent = data.resolution;
      }

      if (data && data.qualityLevel) {
        metrics.qualityLevel = data.qualityLevel;
        document.getElementById('qualityLevel').textContent = data.qualityLevel;
      }
      break;

    case 'bufferUpdate':
      if (data && data.bufferLength) {
        const bufferValue = typeof data.bufferLength === 'number' ?
          data.bufferLength : parseFloat(data.bufferLength);
        if (!isNaN(bufferValue)) {
          metrics.bufferLevels.push(bufferValue);
          document.getElementById('bufferLevel').textContent = bufferValue.toFixed(1);
          bufferChart.addPoint(bufferValue, timeLabel);
        }
      }
      break;

    case 'frameRate':
      if (data && data.fps) {
        metrics.frameRate = data.fps;
        document.getElementById('frameRate').textContent = data.fps;
      }
      break;

    case 'error':
      logEvent(eventName, data, timestamp);
      break;

    case 'droppedFrames':
      if (data && data.count) {
        metrics.droppedFrames += parseInt(data.count);
        document.getElementById('droppedFrames').textContent = metrics.droppedFrames;
      }
      break;

    case 'progress':
      if (data) {
        if (data.currentTime !== undefined && data.buffered !== undefined) {
          const bufferValue = parseFloat(data.buffered) - parseFloat(data.currentTime);
          if (!isNaN(bufferValue) && bufferValue >= 0) {
            metrics.bufferLevels.push(bufferValue);
            document.getElementById('bufferLevel').textContent = bufferValue.toFixed(1);
            bufferChart.addPoint(bufferValue, timeLabel);
          }
        }

        if (data.bitrate) {
          const bitrateKbps = Math.round(parseFloat(data.bitrate) / 1000);
          if (!isNaN(bitrateKbps)) {
            metrics.bitrates.push(bitrateKbps);
            document.getElementById('currentBitrate').textContent = bitrateKbps;
            bitrateChart.addPoint(bitrateKbps, timeLabel);
          }
        }
      }
      break;

    case 'graphqlResponse':
      if (data && data.data) {
        metrics.lastGraphqlResponse = data;

        if (data.data.fanLiveStream) {
          const fanLiveStream = data.data.fanLiveStream;

          if (fanLiveStream.session) {
            metrics.sessionInfo = {
              session: fanLiveStream.session?.data,
              error: fanLiveStream.session?.error?.sessionError || null,
              maxSessionLimit: fanLiveStream.session?.error?.maxSessionLimit || null
            };
            updateStreamStatus('error', metrics.sessionInfo);
          } else {
            metrics.sessionInfo = { session: null, error: null, maxSessionLimit: null };
          }

          if (fanLiveStream.liveStreams?.sources?.length > 0) {
            metrics.allStreamSources = fanLiveStream.liveStreams.sources;
            metrics.streamContentType = fanLiveStream.liveStreams.contentType;
            metrics.streamContentId = fanLiveStream.liveStreams.contentId;

            populateSourceSelector(metrics.allStreamSources);

            updateStreamDetails(getSelectedSourceInfo());
          }

        }

        logEvent('GraphQL Response', {
          operation: data.operationName,
          path: data.path
        }, timestamp);
      }
      resetReloadState();
      break;


    case 'scteUpdate':
      if (data?.newMarkers) {
        metrics.scteEvents = data.allMarkers;

        updateSCTEDisplay(data.newMarkers, data.allMarkers);

        const lastMarker = data.newMarkers[data.newMarkers.length - 1];
        if (lastMarker) {
          if (lastMarker.type === 'CUE-OUT') {
            metrics.activeAdBreak = {
              startTime: lastMarker.time,
              duration: lastMarker.duration
            };
          } else if (lastMarker.type === 'CUE-IN') {
            metrics.activeAdBreak = null;
          }
        }
      }
      break;

    default:
      if (data) {
        if (data && data.networkType) {
          document.getElementById('networkType').textContent = data.networkType;
        }

        if (data && data.networkSpeed) {
          document.getElementById('networkSpeed').textContent = data.networkSpeed;
        }
        if (data.bitrate) {
          const bitrateKbps = Math.round(parseFloat(data.bitrate) / 1000);
          if (!isNaN(bitrateKbps)) {
            metrics.bitrates.push(bitrateKbps);
            document.getElementById('currentBitrate').textContent = bitrateKbps;
            bitrateChart.addPoint(bitrateKbps, timeLabel);
          }
        }

        if (data.bufferLength || (data.currentTime !== undefined && data.buffered !== undefined)) {
          let bufferValue;
          if (data.bufferLength) {
            bufferValue = parseFloat(data.bufferLength);
          } else {
            bufferValue = parseFloat(data.buffered) - parseFloat(data.currentTime);
          }

          if (!isNaN(bufferValue) && bufferValue >= 0) {
            metrics.bufferLevels.push(bufferValue);
            document.getElementById('bufferLevel').textContent = bufferValue.toFixed(1);
            bufferChart.addPoint(bufferValue, timeLabel);
          }
        }

        if (data.resolution) {
          metrics.resolution = data.resolution;
          document.getElementById('currentResolution').textContent = data.resolution;
        }

        if (data.fps) {
          metrics.frameRate = data.fps;
          document.getElementById('frameRate').textContent = data.fps;
        }
      }
      break;
  }
}

function updateMetric(key, value) {
  console.log(`[V_Extension] Direct update: ${key} = ${value}`);
  switch (key) {
    case 'bitrate':
      const bitrateKbps = Math.round(parseFloat(value) / 1000);
      document.getElementById('currentBitrate').textContent = bitrateKbps;
      bitrateChart.addPoint(bitrateKbps, formatTime(Date.now()));
      break;
    case 'buffer':
      const bufferValue = parseFloat(value);
      document.getElementById('bufferLevel').textContent = bufferValue.toFixed(1);
      bufferChart.addPoint(bufferValue, formatTime(Date.now()));
      break;
    case 'startup':
      document.getElementById('startupTime').textContent = value;
      break;
    case 'resolution':
      document.getElementById('currentResolution').textContent = value;
      break;
    case 'fps':
      document.getElementById('frameRate').textContent = value;
      break;
    case 'quality':
      document.getElementById('qualityLevel').textContent = value;
      break;
    case 'dropped':
      metrics.droppedFrames += parseInt(value);
      document.getElementById('droppedFrames').textContent = metrics.droppedFrames;
      break;
  }
}

let port;
try {
  port = chrome.runtime.connect({ name: "panel" });
  console.log("[V_Extension] Panel connected successfully:", port);

  port.onMessage.addListener((msg) => {
    console.log("[V_Extension] Panel received message:", msg);


    try {
      if (msg.event === 'VideoPlayerEvent' && msg.data) {

        if (msg.data.detail) {
          const { eventName, data, timestamp } = msg.data.detail;
          console.log(`[V_Extension] Processing CustomEvent: ${eventName}`);
          logEvent(eventName, data, timestamp || Date.now());
          processMetrics(eventName, data, timestamp || Date.now());
        }
        else {
          console.log(`[V_Extension] Processing direct VideoPlayerEvent data`);
          logEvent('VideoPlayerEvent', msg.data, Date.now());
          processMetrics('VideoPlayerEvent', msg.data, Date.now());
        }
      }
      else if (msg.event && msg.data !== undefined) {
        console.log(`[V_Extension] Processing simple event: ${msg.event}`);
        logEvent(msg.event, msg.data, Date.now());
        processMetrics(msg.event, msg.data, Date.now());
      }
      else {
        console.log("[V_Extension] Unrecognized message format:", msg);
        logEvent('raw', JSON.stringify(msg), Date.now());

        if (typeof msg === 'object') {
          for (const key in msg) {
            if (typeof msg[key] === 'object' && msg[key] !== null) {
              processMetrics(key, msg[key], Date.now());
            }
          }
        }
      }
    } catch (error) {
      console.error("Error processing message:", error);
      logEvent('error', `Error processing message: ${error.message}`, Date.now());
    }
  });

  port.onDisconnect.addListener((error) => {
    console.log("[V_Extension] Panel disconnected:", error);
    if (chrome.runtime.lastError) {
      console.error("Disconnect error:", chrome.runtime.lastError);
    }
  });
} catch (error) {
  console.error("Failed to connect panel:", error);
}

console.log("[V_Extension] Panel port created", port);

document.getElementById('clearLog').addEventListener('click', () => {
  document.getElementById('eventLog').innerHTML = '';
  bitrateChart.clear();
  bufferChart.clear();
});

window.addEventListener('message', (event) => {
  console.log('[V_Extension] Received metric via postMessage:................', event.data);
  if (event.data && event.data.type === 'videoMetric') {
    updateMetric(event.data.key, event.data.value);
  }
});

console.log("[V_Extension] Video metrics panel ready!");

function updateStreamStatus(type, data, isNull = false) {
  const statusDiv = document.getElementById('streamStatus');
  statusDiv.innerHTML = `
    <div>
      <div class="stream-status">
        <div class="status-title">Stream Status</div>
        <div class="status-details">
        <div>Base Url: ${data.session.baseUrl}</div>
        <div>Session Id: ${data.session.sessionId}</div>
        <div>TTL: ${data.session.ttl}</div>
      </div>
      ${type === 'error' ? `<div class="error-status">
        <div class="error-title">Session Error</div>
        <div class="error-details">
          <div>Type: ${data.error || 'None'}</div>
          <div>Max Sessions: ${data.maxSessionLimit || 'N/A'}</div>
        </div>
      </div>` : ''}
      </div>
  `;
}

function updateStreamDetails(streamInfo) {
  const detailsDiv = document.getElementById('streamDetails');

  const csaiDetails = streamInfo.csai?.enabled ?
    `<div class="detail-section">
          <h3>CSAI Configuration</h3>
          <div>Provider: ${streamInfo.csai.provider}</div>
          <div>Pre-roll Enabled: ${streamInfo.csai.extraData?.preRollEnabled}</div>
          <div>Pre-roll Timeout: ${streamInfo.csai.extraData?.preRollTimeOut}s</div>
          <div>Pre-roll Max Duration: ${streamInfo.csai.extraData?.preRollMaxDuration}s</div>
          <div>Mid-roll Max Duration: ${streamInfo.csai.extraData?.midRollMaxDuration}s</div>
          ${renderVastTags(streamInfo.csai.extraData)}
      </div>` : `<div class="detail-section">
          <h3>CSAI Configuration</h3>
          <div>CSAI: Not Enabled</div>
      </div>`;

  const ssaiDetails = streamInfo.ssai ?
    `<div class="detail-section">
          <h3>SSAI Configuration</h3>
          <div>Provider: ${streamInfo.ssai.provider || 'N/A'}</div>
          ${renderSsaiDetails(streamInfo.ssai)}
      </div>` :
    `<div class="detail-section">
          <h3>SSAI Configuration</h3>
          <div>SSAI: Not Enabled</div>
      </div>`;

  const drmDetails = streamInfo.drm ?
    `<div class="detail-section">
          <h3>DRM Configuration</h3>
          <div>Provider: ${streamInfo.drm.provider}</div>
          <div>Key ID: ${streamInfo.drm.kID}</div>
          <div>License URL: ${truncateUrl(streamInfo.drm.licenceUrl)}</div>
          <div>Certificate URL: ${truncateUrl(streamInfo.drm.certificateUrl)}</div>
      </div>` : `<div class="detail-section">
          <h3>DRM Configuration</h3>
          <div>DRM: Not Enabled</div>
      </div>`;

  const wmDetails = streamInfo.wm?.enabled ?
    `<div class="detail-section">
          <h3>Watermark Configuration</h3>
          <div>Enabled: ${streamInfo.wm.enabled}</div>
          <div>WM URL: ${truncateUrl(streamInfo.wm.wmUrl)}</div>
      </div>` : `<div class="detail-section">
          <h3>Watermark Configuration</h3>
          <div>Watermark: Not Enabled</div>
      </div>`;

  const streamTypeInfo = `
      <div class="detail-section">
          <h3>Stream Information</h3>
          <div>Title: ${streamInfo.title}</div>
          <div>Url: ${streamInfo.url}</div>
          <div>Content Type: ${streamInfo.contentType}</div>
          <div>Content ID: ${streamInfo.contentId}</div>
          <div>Delivery Type: ${streamInfo.deliveryType || 'N/A'}</div>
          <div>Network Protocol: ${streamInfo.networkProtocol || 'N/A'}</div>
      </div>
  `;

  detailsDiv.innerHTML = `
      <div class="stream-info">
          ${streamTypeInfo}
          ${csaiDetails}
          ${ssaiDetails}
          ${drmDetails}
          ${wmDetails}
      </div>
  `;
}

function renderVastTags(extraData) {
  if (!extraData) return '';

  let vastTagsHtml = '';

  if (extraData.preRollVastTagIds?.length > 0) {
    vastTagsHtml += '<div class="vast-tags"><strong>Pre-roll VAST Tags:</strong><ul>';
    extraData.preRollVastTagIds.forEach(tag => {
      vastTagsHtml += `<li>ID: ${tag.vastTagId} (${tag.vastTagType})</li>`;
    });
    vastTagsHtml += '</ul></div>';
  }

  if (extraData.midRollVastTagIds?.length > 0) {
    vastTagsHtml += '<div class="vast-tags"><strong>Mid-roll VAST Tags:</strong><ul>';
    extraData.midRollVastTagIds.forEach(tag => {
      vastTagsHtml += `<li>ID: ${tag.vastTagId} (${tag.vastTagType})</li>`;
    });
    vastTagsHtml += '</ul></div>';
  }

  if (extraData.adTagParams) {
    vastTagsHtml += `
            <div class="ad-tag-params">
                <strong>Ad Tag Parameters:</strong>
                <div class="params-details">
                    <pre class="json-data">${formatJSON(extraData.adTagParams)}</pre>
                </div>
            </div>
        `;
  }

  vastTagsHtml += `
    <div class="extra-data">
      <strong>Extra Data:</strong>
      <div class="extra-data-details">
        <pre class="json-data">${formatJSON(extraData)}</pre>
      </div>
    </div>
  `;

  return vastTagsHtml;
}

function formatJSON(obj) {
  const jsonString = JSON.stringify(obj, null, 2);

  return jsonString
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
      let cls = 'number';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'key';
          match = match.replace(/:$/, '');
        } else {
          cls = 'string';
        }
      } else if (/true|false/.test(match)) {
        cls = 'boolean';
      } else if (/null/.test(match)) {
        cls = 'null';
      }
      return '<span class="' + cls + '">' + match + '</span>' + (/:$/.test(match) ? ':' : '');
    });
}

function renderSsaiDetails(ssai) {
  if (!ssai) return '';

  let ssaiHtml = '';

  Object.entries(ssai).forEach(([key, value]) => {
    if (value && key !== 'provider') {
      if (typeof value === 'object') {
        ssaiHtml += `<div><strong>${formatKey(key)}:</strong> <pre class="json-data">${JSON.stringify(value, null, 2)}</pre></div>`;
      } else {
        ssaiHtml += `<div><strong>${formatKey(key)}:</strong> ${value}</div>`;
      }
    }
  });

  return ssaiHtml;
}

function formatKey(key) {
  return key
    .split(/(?=[A-Z])/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function truncateUrl(url) {
  if (!url) return 'N/A';
  return url.length > 50 ? url.substring(0, 47) + '...' : url;
}

function resetReloadState() {
  isReloading = false;
  const reloadIcon = document.querySelector('.reload-icon');
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (reloadIcon) reloadIcon.classList.remove('spinning');
  if (loadingOverlay) loadingOverlay.classList.remove('active');
}

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('reloadData').addEventListener('click', reloadData);
});

function updateSCTEDisplay(newMarkers, allMarkers) {
  const scteContainer = document.getElementById('scteContainer');
  if (!scteContainer) return;

  updateAdBreakStatus(metrics.activeAdBreak);

  const scteLog = document.getElementById('scteLog');
  newMarkers.forEach(marker => {
    const markerElement = createSCTEMarkerElement(marker);
    scteLog.insertBefore(markerElement, scteLog.firstChild);
  });

  while (scteLog.children.length > 50) {
    scteLog.removeChild(scteLog.lastChild);
  }
}

function createSCTEMarkerElement(marker) {
  const element = document.createElement('div');
  element.className = `scte-marker ${marker.type.toLowerCase()}`;

  const time = new Date(marker.timestamp).toLocaleTimeString();
  const duration = marker.duration ? ` (Duration: ${marker.duration}s)` : '';
  const elapsed = marker.elapsedTime ? ` (Elapsed: ${marker.elapsedTime}s)` : '';

  let details = '';
  if (marker.dateRange) {
    details = `
      <div class="scte-daterange">
        <div>ID: ${marker.dateRange.ID || 'N/A'}</div>
        <div>Start: ${marker.dateRange['START-DATE'] || 'N/A'}</div>
        <div>Duration: ${marker.dateRange['PLANNED-DURATION'] || 'N/A'}</div>
      </div>
    `;
  }

  element.innerHTML = `
    <div class="scte-time">${time}</div>
    <div class="scte-type">${marker.type}${duration}${elapsed}</div>
    <div class="scte-position">Position: ${marker.time.toFixed(2)}s</div>
    ${details}
    <div class="scte-raw">${marker.rawData}</div>
    ${marker.scte35Data ? `<div class="scte-data">SCTE35: ${marker.scte35Data}</div>` : ''}
  `;

  return element;
}

function updateAdBreakStatus(activeBreak) {
  const statusElement = document.getElementById('adBreakStatus');
  if (!statusElement) return;

  if (activeBreak) {
    const elapsed = ((Date.now() - activeBreak.timestamp) / 1000).toFixed(1);
    const remaining = Math.max(0, activeBreak.duration - elapsed).toFixed(1);

    statusElement.innerHTML = `
      <div class="active-break">
        <div class="break-title">Active Ad Break</div>
        <div class="break-details">
          <div>Duration: ${activeBreak.duration}s</div>
          <div>Remaining: ${remaining}s</div>
        </div>
      </div>
    `;
  }
}
