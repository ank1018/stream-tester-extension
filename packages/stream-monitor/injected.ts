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
        // @ts-ignore
        const url = args[0]?.url || args[0];
        console.log('[V_Extension] Processing URL:', url);

        // @ts-ignore
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

let videoStartTime: number | null = null;
let videoLoadStartTime: number | null = null;
let isFirstPlay = true;
let lastQualityMetrics: {
    bitrate: number | null
    resolution: string | null
    qualityLevel: string | null
}
    = {
    bitrate: null,
    resolution: null,
    qualityLevel: null
};

function captureVideoMetrics(videoElement: HTMLVideoElement, eventName: string, errorData?: {
    code: string | number;
    message: string;
    details: any;
}) {
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
        bitrate: 'N/A',
        networkType: 'N/A',
        networkSpeed: ''
    };

    if (eventName === 'firstplay' && !videoStartTime) {
        videoStartTime = Date.now();
        const startupTime = (videoStartTime - window.performance.timing.navigationStart) / 1000;

        const startupEvent = new CustomEvent('VideoPlayerEvent', {
            detail: {
                eventName: 'startup',
                data: {
                    startupTime: startupTime.toFixed(2)
                },
                timestamp: Date.now()
            }
        });
        window.dispatchEvent(startupEvent);
    }

    const currentQualityMetrics = {
        bitrate: calculateBitrate(videoElement),
        resolution: metrics.resolution,
        qualityLevel: determineQualityLevel(videoElement)
    };

    if (hasQualityChanged(currentQualityMetrics, lastQualityMetrics)) {
        const qualityEvent = new CustomEvent('VideoPlayerEvent', {
            detail: {
                eventName: 'qualityChange',
                data: currentQualityMetrics,
                timestamp: Date.now()
            }
        });
        window.dispatchEvent(qualityEvent);
        lastQualityMetrics = { ...currentQualityMetrics };
    }

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

function calculateBitrate(videoElement: HTMLVideoElement) {
    if (videoElement.videoWidth && videoElement.videoHeight && videoElement.duration) {
        const pixels = videoElement.videoWidth * videoElement.videoHeight;
        const fps = 30;
        const bitsPerPixel = 0.1;
        return Math.round(pixels * fps * bitsPerPixel);
    }
    return null;
}

function determineQualityLevel(videoElement: HTMLVideoElement) {
    if (!videoElement.videoWidth || !videoElement.videoHeight) return null;

    const height = videoElement.videoHeight;
        if (height >= 2160) return '4K';
        if (height >= 1440) return '2K';
        if (height >= 1080) return '1080p';
        if (height >= 720)  return '720p';
        if (height >= 576)  return '576p';
        if (height >= 540)  return '540p';
        if (height >= 480)  return '480p';
        if (height >= 360)  return '360p';
        if (height >= 240)  return '240p';
        if (height >= 144)  return '144p';
        return 'Very Low';
}

function hasQualityChanged(current: { bitrate: any; resolution: any; qualityLevel: any; }, last: { bitrate: any; resolution: any; qualityLevel: any; }) {
    return current.bitrate !== last.bitrate ||
        current.resolution !== last.resolution ||
        current.qualityLevel !== last.qualityLevel;
}

function getNetworkInfo() {
    const info = {
        type: 'unknown',
        speed: 'unknown'
    };

    // @ts-ignore
    if (navigator.connection) {
        // @ts-ignore
        info.type = navigator.connection.effectiveType || navigator.connection.type || 'unknown';
        // @ts-ignore
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


function getErrorDetails(code: number) {
    const errorMap = {
        1: 'MEDIA_ERR_ABORTED - Fetching process aborted by user',
        2: 'MEDIA_ERR_NETWORK - Error occurred when downloading',
        3: 'MEDIA_ERR_DECODE - Error occurred when decoding',
        4: 'MEDIA_ERR_SRC_NOT_SUPPORTED - Audio/Video not supported'
    };
    // @ts-ignore
    return errorMap[code] || 'Unknown error';
}

window.addEventListener('ReloadVideoMonitoring', function () {
    console.log('[V_Extension] ReloadVideoMonitoring event received');
    resetVideoMetrics();

    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
        // @ts-ignore
        if (video._monitoringAttached) {
            console.log('[V_Extension] Cleaning up existing listeners for:', video);
            // @ts-ignore
            if (video._eventHandlers) {
                // @ts-ignore
                for (const [eventName, handler] of Object.entries(video._eventHandlers)) {
                    // @ts-ignore
                    video.removeEventListener(eventName, handler);
                }
            }
            // @ts-ignore
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

    videos.forEach((video: HTMLVideoElement & {
        _eventHandlers?: Record<string, EventListener>;
        _monitoringAttached?: boolean;
    }) => {
        if (video._monitoringAttached) {
            console.log('[V_Extension] Video already monitored:', video);
            return;
        }

        video._eventHandlers = {};

        const loadStartHandler = function () {
            if (!videoLoadStartTime) {
                videoLoadStartTime = performance.now();
                console.log('[V_Extension] Video load started at:', videoLoadStartTime);
            }
        };
        video.addEventListener('loadstart', loadStartHandler);
        video._eventHandlers['loadstart'] = loadStartHandler;

        const firstPlayHandler = function () {
            if (isFirstPlay) {
                isFirstPlay = false;
                videoStartTime = performance.now();
                const startupTime = (videoStartTime - (videoLoadStartTime ?? 0)) / 1000;
                console.log('[V_Extension] Video first play at:', videoStartTime, 'Startup time:', startupTime);

                if (startupTime > 0 && startupTime < 30) {
                    const startupEvent = new CustomEvent('VideoPlayerEvent', {
                        detail: {
                            eventName: 'startup',
                            data: {
                                startupTime: startupTime.toFixed(2)
                            },
                            timestamp: Date.now()
                        }
                    });
                    window.dispatchEvent(startupEvent);
                } else {
                    console.warn('[V_Extension] Invalid startup time calculated:', startupTime);
                }

                video.removeEventListener('playing', firstPlayHandler);
            }
        };
        video.addEventListener('playing', firstPlayHandler);
        // @ts-ignore
        video._eventHandlers['firstplay'] = firstPlayHandler;

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
            if (video._eventHandlers) video._eventHandlers[eventName] = handler;
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

function detectStall(video: HTMLVideoElement) {
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

let scteEvents: any[] = [];

function parseSCTEMarkers(content: string) {
    const lines = content.split('\n');
    const siteMarkers: { type: string; time: number; duration: number; elapsedTime: number; scte35Data: string; dateRange: {} | null; rawData: string; timestamp: number; }[] = [];
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
                const params: any = line.split(':')[1].split(',').reduce((acc, param) => {
                    const [key, value] = param.split('=');
                    // @ts-ignore
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
                    // @ts-ignore
                    acc[key] = value?.replace(/"/g, '');
                    return acc;
                }, {});

                // @ts-ignore
                if (dateRange['PLANNED-DURATION']) {
                    // @ts-ignore
                    duration = parseFloat(dateRange['PLANNED-DURATION']);
                }
                // @ts-ignore
                if (dateRange['SCTE35-OUT']) {
                    // @ts-ignore
                    scte35Data = dateRange['SCTE35-OUT'];
                }
            }

            siteMarkers.push({
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

    return siteMarkers;
}

// Add XMLHttpRequest interceptor
const originalXHR = window.XMLHttpRequest;
// @ts-ignore
window.XMLHttpRequest = function () {
    const xhr = new originalXHR();
    const originalOpen = xhr.open;
    const originalSend = xhr.send;

    xhr.open = function (method, url) {
        console.log('[V_Extension] XHR open called:', method, url);
        // @ts-ignore
        this._url = url;
        // @ts-ignore
        return originalOpen.apply(this, arguments);
    };

    xhr.send = function () {
        // @ts-ignore
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

        // @ts-ignore
        return originalSend.apply(this, arguments);
    };

    return xhr;
};

window.setupVideoMonitoring = setupVideoMonitoring;
window.startMetricsPolling = startMetricsPolling;

function resetVideoMetrics() {
    videoStartTime = null;
    videoLoadStartTime = null;
    isFirstPlay = true;
}
