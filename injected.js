const eventsList = [
    'abort',
    'loadstart',
    'firstplay',
    'play',
    'ended',
    'pause',
    'playing',
    'mute',
    'unmute',
    'waiting',
    'timeupdate',
    'error',
    'fcerror',
    'contenterror',
    'dispose',
    'loadedmetadata',
    'loadeddata',
    'durationchange',
    'seeking',
    'seeked',
    'progress',
    'stalled',
    'resize',
    'volumechange',
    'fullscreenchange',
    'fullscreenenter',
    'fullscreenexit',
    'leavepictureinpicture',
    'enterpictureinpicture',
    'ready',
    'ratechange',
    'liveedgechange',
    'cuechange',
    'adbreakstarted',
    'adbreakended',
    'adstarted',
    'adended',
    'adskipped',
    'adprogress',
    'adbuffering',
    'adpaused',
    'adresumed',
    'aderror',
    'ssaiadinitialised',
    'adloaded',
    'adclicked',
    'video_started_playing_in_mute',
    'plugin_loaded',
    'all_plugin_loaded',
    'player_initialised',
    'quality_change_custom',
    'AD_BLOCKER_DETECTED',
    'PLATFORM_NOT_SUPPOERTED',
    'CAST_AVAILABILITY',
    'REPLAY',
    'CAST_STATE_CHANGE',
    'CAST_REQUEST_SESSION_COMPLETE',
    'CAST_REMOTE_PLAY_PAUSE_CHANGED',
    'CAST_REMOTE_PROGRESS_CHANGED',
    'castclicked',
    'startcasting',
    'stopcasting',
    'updatecastmessage',
    'updateislive',
    'castvideocomplete',
    'castreplayed',
    'ON_CAST_DATA_LOADED',
    'CAST_RECEIVER_EVENTS',
    'licenceUrlRequest',
    'licenceUrlResponse',
    'ssaiTimedEvents',
    'streamInitialized'
];

let originalFetch = window.fetch;

window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    console.log('[V_Extension] Fetch called with args:', args);

    const clone = response.clone();

    try {
        const url = args[0]?.url || args[0];
        console.log('[V_Extension] Processing URL:', url);

        if (url.includes('/graphql') || (args[1]?.body && args[1].body.includes('query'))) {
            const json = await clone.json();

            const event = new CustomEvent('VideoPlayerEvent', {
                detail: {
                    eventName: 'graphqlResponse',
                    data: {
                        operationName: json.operationName || 'unknown',
                        data: json.data,
                        path: url
                    },
                    timestamp: Date.now()
                }
            });

            window.dispatchEvent(event);
        }

        const isM3u8Request =
            (typeof url === 'string' && (url.endsWith('.m3u8') || url.includes('.m3u8?'))) ||
            (args[0] instanceof Request && (args[0].url.endsWith('.m3u8') || args[0].url.includes('.m3u8?')));

        if (isM3u8Request) {
            console.log('[V_Extension] Processing m3u8 response from:', url);
            const content = await clone.text();
            console.log('[V_Extension] M3U8 content:', content);

            const newScteMarkers = parseSCTEMarkers(content);
            console.log('[V_Extension] Detected SCTE markers:', newScteMarkers);

            if (newScteMarkers.length > 0) {
                scteEvents = [...scteEvents, ...newScteMarkers];
                // Keep last 100 events
                if (scteEvents.length > 100) {
                    scteEvents = scteEvents.slice(-100);
                }

                const event = new CustomEvent('VideoPlayerEvent', {
                    detail: {
                        eventName: 'scteUpdate',
                        data: {
                            newMarkers: newScteMarkers,
                            allMarkers: scteEvents
                        },
                        timestamp: Date.now()
                    }
                });
                window.dispatchEvent(event);
            }
        }
    } catch (error) {
        console.error('[V_Extension] Error processing response:', error);
    }

    return response;
};

function captureVideoMetrics(videoElement, eventName) {
    const metrics = {
        currentTime: videoElement.currentTime,
        duration: videoElement.duration,
        buffered: videoElement.buffered.length ? videoElement.buffered.end(videoElement.buffered.length - 1) : 0,
        buffer: videoElement.buffered.length ?
            videoElement.buffered.end(videoElement.buffered.length - 1) - videoElement.currentTime : 0,
        readyState: videoElement.readyState,
        playbackRate: videoElement.playbackRate,
        volume: videoElement.volume,
        muted: videoElement.muted,
        resolution: videoElement.videoWidth ? `${videoElement.videoWidth}x${videoElement.videoHeight}` : 'unknown',
        bitrate: 'N/A'
    };

    const networkInfo = getNetworkInfo();
    metrics.networkType = networkInfo.type;
    metrics.networkSpeed = networkInfo.speed;

    const event = new CustomEvent('VideoPlayerEvent', {
        detail: {
            eventName: eventName,
            data: metrics,
            timestamp: Date.now()
        }
    });

    window.dispatchEvent(event);
}

function getNetworkInfo() {
    const info = {
        type: 'unknown',
        speed: 'unknown'
    };

    if (navigator.connection) {
        info.type = navigator.connection.effectiveType || navigator.connection.type || 'unknown';
        info.speed = navigator.connection.downlink ? `${navigator.connection.downlink} Mbps` : 'unknown';
    }

    if (info.speed === 'unknown' && lastDownloadedBytes > 0 && (Date.now() - lastDownloadTime) < 10000) {
        info.speed = `${Math.round(bitrate / 1000000)} Mbps (est.)`;
    }

    return info;
}

let lastDownloadTime = Date.now();
let lastDownloadedBytes = 0;
let downloadedBytes = 0;
let bitrate = 0;


function getErrorDetails(code) {
    const errorMap = {
        1: 'MEDIA_ERR_ABORTED - Fetching process aborted by user',
        2: 'MEDIA_ERR_NETWORK - Error occurred when downloading',
        3: 'MEDIA_ERR_DECODE - Error occurred when decoding',
        4: 'MEDIA_ERR_SRC_NOT_SUPPORTED - Audio/Video not supported'
    };
    return errorMap[code] || 'Unknown error';
}

window.addEventListener('ReloadVideoMonitoring', function () {
    console.log('[V_Extension] ReloadVideoMonitoring event received');

    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
        if (video._monitoringAttached) {
            console.log('[V_Extension] Cleaning up existing listeners for:', video);
            if (video._eventHandlers) {
                for (const [eventName, handler] of Object.entries(video._eventHandlers)) {
                    video.removeEventListener(eventName, handler);
                }
            }
            video._monitoringAttached = false;
        }
    });

    setupVideoMonitoring();

    if (typeof startMetricsPolling === 'function') {
        startMetricsPolling();
    }

    window.dispatchEvent(new CustomEvent('VideoPlayerEvent', {
        detail: {
            eventName: 'systemEvent',
            data: 'Video monitoring reloaded',
            timestamp: Date.now()
        }
    }));
});

const videoLastTimeMap = new WeakMap();
const jumpThreshold = 15; // seconds

function setupVideoMonitoring() {
    const videos = document.querySelectorAll('video');
    console.log('[V_Extension] Setting up video monitoring for', videos.length, 'videos');

    videos.forEach(video => {
        if (video._monitoringAttached) {
            console.log('[V_Extension] Video already monitored:', video);
            return;
        }

        video._eventHandlers = {};

        eventsList.forEach(eventName => {
            let handler;

            if (eventName === 'timeupdate') {
                handler = function () {
                    const currentTime = video.currentTime;
                    const prevTime = videoLastTimeMap.get(video) ?? 0;
                    const delta = currentTime - prevTime;

                    if (Math.abs(delta) > jumpThreshold) {
                        const eventType = delta < 0 ? 'VIDEO_LOOPBACK' : 'VIDEO_JUMP_FORWARD';
                        console.log(`[${eventType}] Δ=${delta.toFixed(2)}s | From ${prevTime} → ${currentTime}`);

                        const jumpEvent = new CustomEvent('VideoPlayerEvent', {
                            detail: {
                                eventName: eventType,
                                data: {
                                    currentTime,
                                    previousTime: prevTime,
                                    jumpDuration: Math.abs(delta),
                                },
                                timestamp: Date.now()
                            }
                        });

                        window.dispatchEvent(jumpEvent);
                    }

                    videoLastTimeMap.set(video, currentTime);
                    captureVideoMetrics(video, eventName);
                };
            } else {
                handler = function () {
                    captureVideoMetrics(video, eventName);
                };
            }

            video.addEventListener(eventName, handler);
            video._eventHandlers[eventName] = handler;
        });

        // Error listener
        const errorHandler = function () {
            const errorData = {
                code: video.error ? video.error.code : 'unknown',
                message: video.error ? video.error.message : 'unknown error',
                details: getErrorDetails(video.error ? video.error.code : 0)
            };
            captureVideoMetrics(video, 'error', errorData);
        };
        video.addEventListener('error', errorHandler);
        video._eventHandlers['error'] = errorHandler;

        video._monitoringAttached = true;
        captureVideoMetrics(video, 'monitoring_attached');
        console.log('[V_Extension] Video monitoring set up for', video);
    });

    if (videos.length === 0) {
        setTimeout(setupVideoMonitoring, 1000);
    }
}

document.addEventListener('DOMContentLoaded', setupVideoMonitoring);
setTimeout(setupVideoMonitoring, 3000);

let lastPlayPos = 0;
let currentPlayPos = 0;
let bufferingDetected = false;
let stallCount = 0;

function detectStall(video) {
    currentPlayPos = video.currentTime;

    const isPlaying = !video.paused && !video.ended;
    const isBuffering = isPlaying && currentPlayPos === lastPlayPos && video.readyState < 3;

    if (isBuffering && !bufferingDetected) {
        bufferingDetected = true;
        stallCount++;

        const event = new CustomEvent('VideoPlayerEvent', {
            detail: {
                eventName: 'stall',
                data: {
                    stallCount,
                    position: currentPlayPos,
                    readyState: video.readyState
                },
                timestamp: Date.now()
            }
        });
        window.dispatchEvent(event);
    } else if (!isBuffering && bufferingDetected) {
        bufferingDetected = false;
    }

    lastPlayPos = currentPlayPos;
}

function startMetricsPolling() {
    setInterval(() => {
        const videos = document.querySelectorAll('video');
        console.log('startMetricsPolling.................', videos.length, 'videos');
        if (videos.length > 0) {
            detectStall(videos[0]);
            // captureVideoMetrics(videos[0], 'metricsPoll');
        }
    }, 1000);
}

let scteEvents = [];

function parseSCTEMarkers(content) {
    const lines = content.split('\n');
    const scteMarkers = [];
    let currentTime = 0;
    let currentCueOut = null;

    lines.forEach((line, index) => {
        if (line.startsWith('#EXTINF:')) {
            currentTime += parseFloat(line.split(':')[1].split(',')[0]);
        }

        if (line.includes('#EXT-OATCLS-SCTE35:') ||
            line.includes('#EXT-X-CUE') ||
            line.includes('#EXT-X-DATERANGE')) {

            let type = 'unknown';
            let duration = 0;
            let elapsedTime = 0;
            let scte35Data = '';
            let dateRange = null;

            if (line.includes('#EXT-OATCLS-SCTE35:')) {
                type = 'SCTE35';
                scte35Data = line.split(':')[1];
            }
            else if (line.includes('#EXT-X-CUE-OUT:')) {
                type = 'CUE-OUT';
                duration = parseFloat(line.split(':')[1]);
                currentCueOut = {
                    startTime: currentTime,
                    duration: duration
                };
            }
            else if (line.includes('#EXT-X-CUE-OUT-CONT:')) {
                type = 'CUE-OUT-CONT';
                const params = line.split(':')[1].split(',').reduce((acc, param) => {
                    const [key, value] = param.split('=');
                    acc[key] = value;
                    return acc;
                }, {});

                elapsedTime = parseFloat(params.ElapsedTime);
                duration = parseFloat(params.Duration);
                if (params.SCTE35) {
                    scte35Data = params.SCTE35;
                }
            }
            else if (line.includes('#EXT-X-DATERANGE:')) {
                type = 'DATERANGE';
                dateRange = line.split(':')[1].split(',').reduce((acc, param) => {
                    const [key, value] = param.split('=');
                    acc[key] = value?.replace(/"/g, '');
                    return acc;
                }, {});

                if (dateRange['PLANNED-DURATION']) {
                    duration = parseFloat(dateRange['PLANNED-DURATION']);
                }
                if (dateRange['SCTE35-OUT']) {
                    scte35Data = dateRange['SCTE35-OUT'];
                }
            }

            scteMarkers.push({
                type,
                time: currentTime,
                duration,
                elapsedTime,
                scte35Data,
                dateRange,
                rawData: line,
                timestamp: Date.now()
            });
        }
    });

    return scteMarkers;
}

// Add XMLHttpRequest interceptor
const originalXHR = window.XMLHttpRequest;
window.XMLHttpRequest = function () {
    const xhr = new originalXHR();
    const originalOpen = xhr.open;
    const originalSend = xhr.send;

    xhr.open = function (method, url) {
        console.log('[V_Extension] XHR open called:', method, url);
        this._url = url;
        return originalOpen.apply(this, arguments);
    };

    xhr.send = function () {
        const url = this._url;

        if (url && (url.endsWith('.m3u8') || url.includes('.m3u8?'))) {

            this.addEventListener('load', function () {
                if (this.readyState === 4 && this.status === 200) {
                    try {
                        const content = this.responseText;

                        const newScteMarkers = parseSCTEMarkers(content);
                        console.log('[V_Extension] Detected SCTE markers from XHR:', newScteMarkers);

                        if (newScteMarkers.length > 0) {
                            scteEvents = [...scteEvents, ...newScteMarkers];
                            if (scteEvents.length > 100) {
                                scteEvents = scteEvents.slice(-100);
                            }

                            const event = new CustomEvent('VideoPlayerEvent', {
                                detail: {
                                    eventName: 'scteUpdate',
                                    data: {
                                        newMarkers: newScteMarkers,
                                        allMarkers: scteEvents
                                    },
                                    timestamp: Date.now()
                                }
                            });
                            window.dispatchEvent(event);
                        }
                    } catch (error) {
                        console.error('[V_Extension] Error processing XHR m3u8 response:', error);
                    }
                }
            });
        }

        return originalSend.apply(this, arguments);
    };

    return xhr;
};

// Expose functions to window object so they can be called from the panel
window.setupVideoMonitoring = setupVideoMonitoring;
window.startMetricsPolling = startMetricsPolling;
