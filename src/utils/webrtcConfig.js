// WebRTC configuration for video calling
export const ICE_SERVERS = {
  iceServers: [
    {
      urls: 'stun:stun.l.google.com:19302'
    },
    {
      urls: 'stun:stun1.l.google.com:19302'
    }
  ],
  iceCandidatePoolSize: 10
};

export const MEDIA_CONSTRAINTS = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: 'user'
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
};

export const OFFER_OPTIONS = {
  offerToReceiveAudio: true,
  offerToReceiveVideo: true
};

/**
 * Get ICE servers configuration for WebRTC
 * @returns {Object} ICE servers configuration
 */
export const getIceServers = () => {
  return ICE_SERVERS.iceServers;
};