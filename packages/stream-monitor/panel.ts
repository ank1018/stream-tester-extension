console.log("[V_Extension] Panel script loaded");

let lastGraphQLOperation = null;
let isReloading = false;

class SimpleChart {
  private svg: HTMLElement | null;
  private path: HTMLElement | null;
  private area: HTMLElement | null;
  private maxPoints: number;
  private minY: number;
  private maxY: number;
  private points: any[];
  private width: number;
  private height: number;
  private paddingLeft: number;
  private paddingRight: number;
  private paddingTop: number;
  private paddingBottom: number;
  private axisGroup: SVGGElement | undefined;
  constructor(svgId: string, pathId: string, areaId: string, maxPoints = 20, minY = 0, maxY = 100) {
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

    this.setupAxis();
  }

  setupAxis() {
    this.axisGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.axisGroup.setAttribute("class", "chart-axis-group");
    this.svg?.appendChild(this.axisGroup);

    this.updateAxis();
  }

  updateAxis() {
    while (this.axisGroup?.firstChild) {
      this.axisGroup.removeChild(this.axisGroup.firstChild);
    }

    const chartWidth = this.width - this.paddingLeft - this.paddingRight;
    const chartHeight = this.height - this.paddingTop - this.paddingBottom;

    const ySteps = 5;
    const yStep = (this.maxY - this.minY) / ySteps;

    for (let i = 0; i <= ySteps; i++) {
      const y = this.height - this.paddingBottom - (i * chartHeight / ySteps);
      const value = this.minY + (i * yStep);

      // Grid line
      const gridLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      gridLine.setAttribute("x1", String(this.paddingLeft));
      gridLine.setAttribute("y1", String(y));
      gridLine.setAttribute("x2", String(this.width - this.paddingRight));
      gridLine.setAttribute("y2", String(y));
      gridLine.setAttribute("class", "chart-grid");
      this.axisGroup?.appendChild(gridLine);

      // Y-axis label
      const yLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
      yLabel.setAttribute("x", String(this.paddingLeft - 5));
      yLabel.setAttribute("y", String(y));
      yLabel.setAttribute("text-anchor", "end");
      yLabel.setAttribute("class", "chart-label");
      yLabel.textContent = String(Math.round(value));
      this.axisGroup?.appendChild(yLabel);
    }

    if (this.points.length > 0) {
      const xStep = Math.max(1, Math.floor(this.points.length / 5));
      for (let i = 0; i < this.points.length; i += xStep) {
        const x = this.paddingLeft + (i * chartWidth / (this.maxPoints - 1));
        const timeLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
        timeLabel.setAttribute("x", String(x));
        timeLabel.setAttribute("y", String(this.height - this.paddingBottom + 15));
        timeLabel.setAttribute("text-anchor", "middle");
        timeLabel.setAttribute("class", "chart-label");
        timeLabel.textContent = this.points[i].label;
        this.axisGroup?.appendChild(timeLabel);
      }
    }
  }

  addPoint(value: number, label: string) {
    console.log(`[V_Extension] Adding point to ${this.path?.id}: ${value}`);
    this.points.push({ value, label });
    if (this.points.length > this.maxPoints) {
      this.points.shift();
    }

    if (value > this.maxY * 0.9) {
      this.maxY = Math.ceil(value * 1.2 / 100) * 100;
      this.updateAxis();
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

    this.path?.setAttribute('d', linePath);
    this.area?.setAttribute('d', areaPath);
    this.updateAxis();
    console.log(`[V_Extension] Updated chart path: ${linePath.substring(0, 50)}...`);
  }

  clear() {
    this.points = [];
    this.path?.setAttribute('d', '');
    this.area?.setAttribute('d', '');
    this.updateAxis();
  }
}

const bufferChart = new SimpleChart('bufferChart', 'bufferPath', 'bufferArea', 20, 0, 30);
const bitrateChart = new SimpleChart('bitrateChart', 'bitratePath', 'bitrateArea', 20, 0, 5000);

const metrics: any = {
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
  activeAdBreak: null,
  errors: {
    session: {
      count: 0,
      details: []
    },
    playback: {
      count: 0,
      details: []
    },
    loopJump: {
      count: 0,
      details: []
    }
  }
};

function formatTime(timestamp: string | number | Date) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function updateValueInDocument(id: string, value: string | number) {
  // @ts-ignore
  document.getElementById(id).textContent = value;
}

function logEvent(eventName: string, data: any, timestamp: string | number | Date) {
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
  eventLog?.prepend(logEntry);

  if (eventLog?.children && eventLog?.children.length > 100) {
    // @ts-ignore
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
  headerActions?.appendChild(reloadButton);

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
    updateValueInDocument('startupTime', "--")
    updateValueInDocument('scteLog', '')
  });

  const sourceSelector = document.getElementById('sourceSelector');
  if (sourceSelector) {
    sourceSelector.addEventListener('change', function (e) {
      // @ts-ignore
      const selectedIndex = parseInt(e.target?.value);
      if (!isNaN(selectedIndex) && metrics.allStreamSources[selectedIndex]) {
        metrics.selectedSourceIndex = selectedIndex;
        updateStreamDetails(getSelectedSourceInfo());
      }
    });
  }
});

function detectStreamTypeAndPlayer() {
  const sources = metrics.allStreamSources || [];
  for (const src of sources) {
    // @ts-ignore
    const url = src.url?.toLowerCase();
    // @ts-ignore
    const protocol = src.networkProtocol?.toLowerCase();
    // @ts-ignore
    const delivery = src.deliveryType?.toLowerCase();

    if (url?.includes('.m3u8') || protocol?.includes('hls') || delivery?.includes('hls')) {
      return { type: 'HLS', player: detectPlayer() };
    }
    if (url?.includes('.mpd') || protocol?.includes('dash') || delivery?.includes('dash')) {
      return { type: 'DASH', player: detectPlayer() };
    }
  }

  return { type: 'Unknown', player: detectPlayer() };
}

function detectPlayer() {
  console.log('detectPlayer.............', window)
  // @ts-ignore
  if (window.shaka?.Player) return 'Shaka Player';
  // @ts-ignore
  if (window.dashjs?.MediaPlayer) return 'dash.js';
  // @ts-ignore
  if (window.Hls?.isSupported()) return 'hls.js';
  // @ts-ignore
  if (window.videojs) return 'Video.js';
  return 'Unknown';
}


function getSelectedSourceInfo() {
  if (metrics.allStreamSources.length > 0) {
    const source: any = metrics.allStreamSources[metrics.selectedSourceIndex];
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
      networkProtocol: source.networkProtocol,
      streamTypeAndPlayer: detectStreamTypeAndPlayer()
    };
  }
  return metrics.streamInfo;
}

function populateSourceSelector(sources: { deliveryType: any; networkProtocol: any; }[]) {
  const selector = document.getElementById('sourceSelector');
  if (!selector) return;

  selector.innerHTML = '';

  sources.forEach((source: { deliveryType: any; networkProtocol: any; }, index: string | number) => {
    const option = document.createElement('option');
    // @ts-ignore
    option.value = index;

    // @ts-ignore
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
    // @ts-ignore
    selector.value = metrics.selectedSourceIndex;
  }
}

function processMetrics(eventName: string, data: any, timestamp: string | number | Date) {
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
        const startupTime = parseFloat(data.startupTime);
        if (!isNaN(startupTime) && startupTime >= 0) {
          metrics.startupTime = startupTime;
          updateValueInDocument('startupTime', startupTime.toFixed(2))
        } else {
          console.warn('[V_Extension] Invalid startup time value:', data.startupTime);
        }
      }
      break;

    case 'qualityChange':
      console.log('[V_Extension] Processing quality change:', data);
      if (data) {
        if (data.bitrate) {
          const bitrateKbps = Math.round(parseFloat(data.bitrate) / 1000);
          console.log('[V_Extension] Setting bitrate:', bitrateKbps);
          if (!isNaN(bitrateKbps) && bitrateKbps >= 0) {
            metrics.bitrates.push(bitrateKbps);
            updateValueInDocument('currentBitrate', bitrateKbps);
            bitrateChart.addPoint(bitrateKbps, timeLabel);
          }
        }

        if (data.resolution) {
          console.log('[V_Extension] Setting resolution:', data.resolution);
          metrics.resolution = data.resolution;
          updateValueInDocument('currentResolution', data.resolution);
        }

        if (data.qualityLevel) {
          console.log('[V_Extension] Setting quality level:', data.qualityLevel);
          metrics.qualityLevel = data.qualityLevel;
          updateValueInDocument('qualityLevel', data.qualityLevel);
        }
      }
      break;

    case 'bufferUpdate':
      if (data && data.bufferLength) {
        const bufferValue = typeof data.bufferLength === 'number' ?
          data.bufferLength : parseFloat(data.bufferLength);
        if (!isNaN(bufferValue)) {
          metrics.bufferLevels.push(bufferValue);
          updateValueInDocument('bufferLevel', bufferValue.toFixed(1));
          bufferChart.addPoint(bufferValue, timeLabel);
        }
      }
      break;

    case 'frameRate':
      if (data && data.fps) {
        metrics.frameRate = data.fps;
        updateValueInDocument('frameRate', data.fps);
      }
      break;

    case 'error':
      handleError(data, timestamp);
      logEvent(eventName, data, timestamp);
      break;

    case 'droppedFrames':
      if (data && data.count) {
        metrics.droppedFrames += parseInt(data.count);
        updateValueInDocument('droppedFrames', metrics.droppedFrames);
      }
      break;

    case 'progress':
      if (data) {
        if (data.currentTime !== undefined && data.buffered !== undefined) {
          const bufferValue = parseFloat(data.buffered) - parseFloat(data.currentTime);
          if (!isNaN(bufferValue) && bufferValue >= 0) {
            metrics.bufferLevels.push(bufferValue);
            updateValueInDocument('bufferLevel', bufferValue.toFixed(1));
            bufferChart.addPoint(bufferValue, timeLabel);
          }
        }

        if (data.bitrate) {
          const bitrateKbps = Math.round(parseFloat(data.bitrate) / 1000);
          if (!isNaN(bitrateKbps)) {
            metrics.bitrates.push(bitrateKbps);
            updateValueInDocument('currentBitrate', bitrateKbps);
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

    case 'playbackError':
      handlePlaybackError(data, timestamp);
      logEvent(eventName, data, timestamp);
      break;

    case 'loopJump':
      handleLoopJump(data, timestamp);
      logEvent(eventName, data, timestamp);
      break;

    default:
      if (data) {
        if (data && data.networkType) {
          updateValueInDocument('networkType', data.networkType);
        }

        if (data && data.networkSpeed) {
          updateValueInDocument('networkSpeed', data.networkSpeed);
        }
        if (data.bitrate) {
          const bitrateKbps = Math.round(parseFloat(data.bitrate) / 1000);
          if (!isNaN(bitrateKbps)) {
            metrics.bitrates.push(bitrateKbps);
            updateValueInDocument('currentBitrate', bitrateKbps);
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
            updateValueInDocument('bufferLevel', bufferValue.toFixed(1));
            bufferChart.addPoint(bufferValue, timeLabel);
          }
        }

        if (data.resolution) {
          metrics.resolution = data.resolution;
          updateValueInDocument('currentResolution', data.resolution);
        }

        if (data.fps) {
          metrics.frameRate = data.fps;
          updateValueInDocument('frameRate', data.fps);
        }
      }
      break;
  }
}

function updateMetric(key: any, value: string) {
  console.log(`[V_Extension] Direct update: ${key} = ${value}`);
  switch (key) {
    case 'bitrate':
      const bitrateKbps = Math.round(parseFloat(value) / 1000);
      updateValueInDocument('currentBitrate', bitrateKbps);
      bitrateChart.addPoint(bitrateKbps, formatTime(Date.now()));
      break;
    case 'buffer':
      const bufferValue = parseFloat(value);
      updateValueInDocument('bufferLevel', bufferValue.toFixed(1));
      bufferChart.addPoint(bufferValue, formatTime(Date.now()));
      break;
    case 'startup':
      updateValueInDocument('startupTime', value);
      break;
    case 'resolution':
      updateValueInDocument('currentResolution', value);
      break;
    case 'fps':
      updateValueInDocument('frameRate', value);
      break;
    case 'quality':
      updateValueInDocument('qualityLevel', value);
      break;
    case 'dropped':
      metrics.droppedFrames += parseInt(value);
      updateValueInDocument('droppedFrames', metrics.droppedFrames);
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
      // @ts-ignore
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
// @ts-ignore
document.getElementById('clearLog').addEventListener('click', () => {
  // @ts-ignore
  document.getElementById('eventLog').innerHTML = '';
  bitrateChart.clear();
  bufferChart.clear();

  metrics.errors.session.count = 0;
  metrics.errors.session.details = [];
  metrics.errors.playback.count = 0;
  metrics.errors.playback.details = [];
  metrics.errors.loopJump.count = 0;
  metrics.errors.loopJump.details = [];

  updateErrorDisplay();
});

window.addEventListener('message', (event) => {
  console.log('[V_Extension] Received metric via postMessage:................', event.data);
  if (event.data && event.data.type === 'videoMetric') {
    updateMetric(event.data.key, event.data.value);
  }
});

console.log("[V_Extension] Video metrics panel ready!");

function updateStreamStatus(type: string, data: { session: { baseUrl: any; sessionId: any; ttl: any; }; error: any; maxSessionLimit: any; }, isNull = false) {
  const statusDiv = document.getElementById('streamStatus');
  // @ts-ignore
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

function updateStreamDetails(streamInfo: { streamTypeAndPlayer: { type: any; }; csai: { enabled: any; provider: any; extraData: { preRollEnabled: any; preRollTimeOut: any; preRollMaxDuration: any; midRollMaxDuration: any; }; }; ssai: { provider: any; }; drm: { provider: any; kID: any; licenceUrl: any; certificateUrl: any; }; wm: { enabled: any; wmUrl: any; }; title: any; url: any; contentType: any; contentId: any; deliveryType: any; networkProtocol: any; }) {
  const detailsDiv = document.getElementById('streamDetails');
  const streamTypeAndPlayerDiv = document.getElementById('streamTypeAndPlayer');
  console.log('streamInfo......................', streamInfo);

  if (streamInfo.streamTypeAndPlayer && streamTypeAndPlayerDiv) {
    streamTypeAndPlayerDiv.innerHTML = `<div>${streamInfo.streamTypeAndPlayer.type}</div>`;
  }

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

  // @ts-ignore
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

function renderVastTags(extraData: { preRollEnabled?: any; preRollTimeOut?: any; preRollMaxDuration?: any; midRollMaxDuration?: any; preRollVastTagIds?: any; midRollVastTagIds?: any; adTagParams?: any; }) {
  if (!extraData) return '';

  let vastTagsHtml = '';

  if (extraData.preRollVastTagIds?.length > 0) {
    vastTagsHtml += '<div class="vast-tags"><strong>Pre-roll VAST Tags:</strong><ul>';
    extraData.preRollVastTagIds.forEach((tag: { vastTagId: any; vastTagType: any; }) => {
      vastTagsHtml += `<li>ID: ${tag.vastTagId} (${tag.vastTagType})</li>`;
    });
    vastTagsHtml += '</ul></div>';
  }

  if (extraData.midRollVastTagIds?.length > 0) {
    vastTagsHtml += '<div class="vast-tags"><strong>Mid-roll VAST Tags:</strong><ul>';
    extraData.midRollVastTagIds.forEach((tag: { vastTagId: any; vastTagType: any; }) => {
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

function formatJSON(obj: { preRollEnabled?: any; preRollTimeOut?: any; preRollMaxDuration?: any; midRollMaxDuration?: any; preRollVastTagIds?: any; midRollVastTagIds?: any; adTagParams?: any; }) {
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

function renderSsaiDetails(ssai: any) {
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

function formatKey(key: string) {
  return key
    .split(/(?=[A-Z])/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function truncateUrl(url: string) {
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
  // @ts-ignore
  document.getElementById('reloadData').addEventListener('click', reloadData);
});

function updateSCTEDisplay(newMarkers: any[], allMarkers: any) {
  const scteContainer = document.getElementById('scteContainer');
  if (!scteContainer) return;

  updateAdBreakStatus(metrics.activeAdBreak);

  const scteLog = document.getElementById('scteLog');
  newMarkers.forEach(marker => {
    const markerElement = createSCTEMarkerElement(marker);
    scteLog?.insertBefore(markerElement, scteLog.firstChild);
  });

  while (scteLog?.children && scteLog?.children.length > 50) {
    // @ts-ignore
    scteLog.removeChild(scteLog.lastChild);
  }
}

function createSCTEMarkerElement(marker: { type: string; timestamp: string | number | Date; duration: any; elapsedTime: any; dateRange: { [x: string]: any; ID: any; }; time: number; rawData: any; scte35Data: any; }) {
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

function updateAdBreakStatus(activeBreak: { timestamp: number; duration: number; }) {
  const statusElement = document.getElementById('adBreakStatus');
  if (!statusElement) return;

  if (activeBreak) {
    const elapsed = ((Date.now() - activeBreak.timestamp) / 1000).toFixed(1);
    // @ts-ignore
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

function handleError(data: { type: any; message: any; code: any; details: any; }, timestamp: string | number | Date) {
  if (!data) return;

  metrics.errors.session.count++;
  const errorDetail = {
    timestamp,
    time: formatTime(timestamp),
    type: data.type || 'Unknown',
    message: data.message || 'No message',
    code: data.code || 'No code',
    details: data.details || null
  };

  metrics.errors.session.details.unshift(errorDetail);
  if (metrics.errors.session.details.length > 20) {
    metrics.errors.session.details.pop();
  }

  updateErrorDisplay();
}

function handlePlaybackError(data: { type: any; message: any; code: any; details: any; }, timestamp: string | number | Date) {
  if (!data) return;

  metrics.errors.playback.count++;
  const errorDetail = {
    timestamp,
    time: formatTime(timestamp),
    type: data.type || 'Unknown',
    message: data.message || 'No message',
    code: data.code || 'No code',
    details: data.details || null
  };

  metrics.errors.playback.details.unshift(errorDetail);
  if (metrics.errors.playback.details.length > 20) {
    metrics.errors.playback.details.pop();
  }

  updateErrorDisplay();
}

function handleLoopJump(data: { type: any; from: any; to: any; duration: any; reason: any; }, timestamp: string | number | Date) {
  if (!data) return;

  metrics.errors.loopJump.count++;
  const errorDetail = {
    timestamp,
    time: formatTime(timestamp),
    type: data.type || 'Unknown',
    from: data.from || 'Unknown',
    to: data.to || 'Unknown',
    duration: data.duration || 'Unknown',
    reason: data.reason || null
  };

  metrics.errors.loopJump.details.unshift(errorDetail);
  if (metrics.errors.loopJump.details.length > 20) {
    metrics.errors.loopJump.details.pop();
  }

  updateErrorDisplay();
}

function updateErrorDisplay() {
  updateValueInDocument('sessionErrors', metrics.errors.session.count);
  const sessionList = document.querySelector('#sessionErrorDetails .error-list');
  // @ts-ignore
  sessionList.innerHTML = metrics.errors.session.details.map(detail => `
    <div class="error-item">
      <div class="error-time">${detail.time}</div>
      <div class="error-message">${detail.type}: ${detail.message}</div>
      ${detail.code ? `<div class="error-code">Code: ${detail.code}</div>` : ''}
      ${detail.details ? `<div class="error-details">${JSON.stringify(detail.details, null, 2)}</div>` : ''}
    </div>
  `).join('');

  updateValueInDocument('playbackErrors', metrics.errors.playback.count);
  const playbackList = document.querySelector('#playbackErrorDetails .error-list');
  // @ts-ignore
  playbackList.innerHTML = metrics.errors.playback.details.map(detail => `
    <div class="error-item">
      <div class="error-time">${detail.time}</div>
      <div class="error-message">${detail.type}: ${detail.message}</div>
      ${detail.code ? `<div class="error-code">Code: ${detail.code}</div>` : ''}
      ${detail.details ? `<div class="error-details">${JSON.stringify(detail.details, null, 2)}</div>` : ''}
    </div>
  `).join('');

  updateValueInDocument('loopJumpEvents', metrics.errors.loopJump.count);
  const loopJumpList = document.querySelector('#loopJumpDetails .error-list');
  // @ts-ignore
  loopJumpList.innerHTML = metrics.errors.loopJump.details.map(detail => `
    <div class="error-item">
      <div class="error-time">${detail.time}</div>
      <div class="error-message">${detail.type}: ${detail.from} → ${detail.to}</div>
      <div class="error-code">Duration: ${detail.duration}s</div>
      ${detail.reason ? `<div class="error-details">Reason: ${detail.reason}</div>` : ''}
    </div>
  `).join('');
}

function toggleErrorDetails(type: any) {
  const container = document.getElementById(`${type}ErrorDetails`);
  const button = container?.querySelector('.show-more-btn');

  container?.classList.toggle('expanded');
  // @ts-ignore
  button.textContent = container.classList.contains('expanded') ? 'Hide Details' : 'Show Details';
}
