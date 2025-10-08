'use client'

import React, { useEffect } from 'react';
import TranslationOverlay from './TranslationOverlay';
import TranscriptOverlay from './TranscriptOverlay';

/**
 * Component to display local and remote video streams during calls
 * Displays simple overlays for transcripts/translations — avoids client-side TTS
 */
const VideoStreams = ({ 
  localVideoRef, 
  remoteVideoRef, 
  localStream, 
  remoteStream,
  localTranscript = '',
  localTranslated = '',
  remoteTranscript = '',
  remoteTranslated = '',
  yourLanguage = 'en',
  yourLanguageName = 'Your Language'
}) => {
  // Setup video streams when components receive new streams
  useEffect(() => {
    const setupVideo = async (ref, stream, isLocal) => {
      if (!ref.current || !stream) {
        console.log(`${isLocal ? 'Local' : 'Remote'} video ref or stream missing`);
        return;
      }

      try {
        // Reset video element
        ref.current.srcObject = null;
        
        // Set new stream
        ref.current.srcObject = stream;
        ref.current.muted = isLocal; // Only mute local video
        ref.current.playsInline = true;
        ref.current.autoplay = true;
        
        // Ensure video elements are properly sized
        ref.current.style.width = '100%';
        ref.current.style.height = '100%';
        ref.current.style.objectFit = 'cover';

        // Play with auto-play fallback
        try {
          await ref.current.play();
        } catch (playError) {
          if (playError.name === 'NotAllowedError') {
            console.log('Auto-play prevented, waiting for user interaction');
            const playOnClick = async () => {
              try {
                await ref.current.play();
                ref.current.removeEventListener('click', playOnClick);
              } catch (err) {
                console.error('Play on click failed:', err);
              }
            };
            ref.current.addEventListener('click', playOnClick);
          }
        }

      } catch (err) {
        console.error(`Error setting up ${isLocal ? 'local' : 'remote'} video:`, err);
      }
    };

    if (localStream && localVideoRef.current) {
      setupVideo(localVideoRef, localStream, true);
    }
    
    if (remoteStream && remoteVideoRef.current) {
      setupVideo(remoteVideoRef, remoteStream, false);
    }

    return () => {
      // Cleanup function
      const cleanupVideo = (ref) => {
        if (ref.current) {
          ref.current.srcObject = null;
          ref.current.removeAttribute('src');
          ref.current.load();
        }
      };
      cleanupVideo(localVideoRef);
      cleanupVideo(remoteVideoRef);
    };
  }, [localStream, remoteStream, localVideoRef, remoteVideoRef]);

  return (
    <>
      {/* Remote Video with Transcription Overlay */}
      <div className="flex-1 relative">
        <video
          ref={remoteVideoRef}
          playsInline
          autoPlay
          className="absolute inset-0 w-full h-full object-cover video-element"
          style={{ transform: 'scaleX(-1)' }}
        />
        
        {/* Remote Transcription Overlay - original + translated */}
        {(remoteTranscript || remoteTranslated) && (
          <div className="absolute bottom-4 left-4 right-4 animate-fade-in">
            <TranslationOverlay transcribedText={remoteTranscript} translatedText={remoteTranslated || remoteTranscript} />
          </div>
        )}
      </div>

      {/* Local Video with Transcription Overlay */}
      <div className="absolute top-4 right-4 w-48 h-36 bg-black rounded-lg overflow-hidden shadow-lg">
        <video
          ref={localVideoRef}
          playsInline
          muted
          className="w-full h-full object-cover video-element"
          style={{ transform: 'scaleX(-1)' }}
        />
        
        {/* Local Transcription Overlay - original + translated (what they heard) */}
        {(localTranscript || localTranslated) && (
          <div className="absolute bottom-2 left-2 right-2 animate-fade-in">
            <div 
              className="bg-emerald-900/90 backdrop-blur-sm rounded-md px-2 py-1.5 shadow-lg"
              style={{ fontSize: '11px' }}
            >
              <div className="text-[10px] text-emerald-300 font-medium mb-0.5">
                🎤 You ({yourLanguage})
              </div>
              <div className="text-white leading-snug line-clamp-2">
                <div className="text-xs text-emerald-200">Original: {localTranscript}</div>
                {localTranslated && <div className="text-sm mt-1">Translated: {localTranslated}</div>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Styles for video elements and animations */}
      <style jsx>{`
        .video-element {
          -webkit-playsinline: 1;
          playsinline: 1;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        .animate-fade-in {
          animation: fadeIn 0.3s ease-in;
        }
        
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </>
  );
};

export default VideoStreams;
