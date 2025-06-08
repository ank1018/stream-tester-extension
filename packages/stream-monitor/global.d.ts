declare global {
    interface Window {
        shaka?: {
            Player?: any;
        };
        dashjs?: {
            MediaPlayer?: any;
        };
        Hls?: {
            isSupported: () => boolean;
        };
        videojs?: any;
    }
}
