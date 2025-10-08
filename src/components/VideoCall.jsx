'use client'

import React from 'react';
import { useTranslation } from '../contexts/TranslationContext';
import useAudioProcessing from '../hooks/useAudioProcessing';
import VideoStreams from './VideoCallComponents/VideoStreams';
import CallControls from './VideoCallComponents/CallControls';

/**
 * VideoCall component to handle video calls with real-time translation
 * Updated to use text-based translation workflow:
 * 1. Speaking side: Voice recognition only (voice-to-text)
 * 2. Send text data only (not audio) to the other side
 * 3. Receiving side: Translate text and convert to speech
 */
const VideoCall = ({
  localStream,
  remoteStream,
  localVideoRef,
  remoteVideoRef,
  toggleMute,
  toggleCamera,
  endCall,
  isMuted,
  isCameraOff,
  peerConnection,
  socket,
  selectedUser
}) => {
  const { currentLanguage, languages } = useTranslation();
  
  // Use our custom hook for audio processing and translation only when socket is connected
  const audioProcessingEnabled = socket && socket.connected;
  
  const audioProcessingData = audioProcessingEnabled ? useAudioProcessing(
    localStream,
    remoteStream,
    socket, 
    selectedUser,
    currentLanguage,
    peerConnection
  ) : {
    localOriginal: '',
    localTranslated: '',
    remoteOriginal: '',
    remoteTranslated: '',
    callParticipant: null
  };

  const {
    localOriginal,      // What I said in my language
    localTranslated,    // What they heard (translated to their language)
    remoteOriginal,     // What they said in their language
    remoteTranslated,   // What I heard (translated to my language)
    callParticipant
  } = audioProcessingData;

  // Get language names for display
  const yourLanguageName = languages?.[currentLanguage]?.name || currentLanguage;
  const theirLanguageName = callParticipant?.language 
    ? (languages?.[callParticipant.language]?.name || callParticipant.language)
    : 'Their Language';

  return (
    <div className="relative h-[calc(100vh-220px)] rounded-lg p-4 overflow-hidden bg-black flex flex-col">
      {/* Video streams (local and remote) with transcriptions overlaid */}
      <VideoStreams
        localVideoRef={localVideoRef}
        remoteVideoRef={remoteVideoRef}
        localStream={localStream}
        remoteStream={remoteStream}
        localTranscript={localOriginal}
        localTranslated={localTranslated}
        remoteTranscript={remoteOriginal}
        remoteTranslated={remoteTranslated}
        yourLanguage={currentLanguage}
        yourLanguageName={yourLanguageName}
      />

      {/* Call controls (mute, camera, end call) */}
      <CallControls
        toggleMute={toggleMute}
        toggleCamera={toggleCamera}
        endCall={endCall}
        isMuted={isMuted}
        isCameraOff={isCameraOff}
      />
    </div>
  );
};

export default VideoCall;
