'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from '../contexts/TranslationContext';
import { getIceServers } from '../utils/webrtcConfig';
import CallControls from './VideoCallComponents/CallControls';
import useGroupCallAudioProcessing from '../hooks/useGroupCallAudioProcessing';
// Server-side TTS handled by socket event 'groupCallTranslatedSpeech'

/**
 * GroupVideoCall component for multi-participant video calls with translation
 * Handles WebRTC mesh topology where each peer connects to all others
 */
const GroupVideoCall = ({
  socket,
  callRoomId,
  roomName,
  currentUserId,
  onEndCall,
  callType = 'video'
}) => {
  const { currentLanguage } = useTranslation();
  
  // State
  const [participants, setParticipants] = useState(new Map());
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(callType === 'audio');
  const [activeSpeaker, setActiveSpeaker] = useState(null);
  
  // Refs
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const peerConnectionsRef = useRef(new Map()); // Map<socketId, RTCPeerConnection>
  const audioContextRef = useRef(null);
  
  // Use audio processing hook for translation/transcription
  const { transcripts } = useGroupCallAudioProcessing(
    localStreamRef.current,
    socket,
    callRoomId,
    currentLanguage,
    currentUserId,
    isMuted
  );
  
  // Initialize local stream
  useEffect(() => {
    const initLocalStream = async () => {
      try {
        const constraints = {
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: callType === 'video' ? {
            width: { ideal: 1280 },
            height: { ideal: 720 }
          } : false
        };
        
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current = stream;
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        
        // Join the group call room
        socket.emit('joinGroupCall', {
          callRoomId,
          userId: currentUserId
        });
        
      } catch (error) {
        console.error('Error accessing media devices:', error);
        alert('Failed to access camera/microphone. Please check permissions.');
      }
    };
    
    if (socket && callRoomId) {
      initLocalStream();
    }
    
    return () => {
      // Cleanup on unmount
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      // Close all peer connections
      peerConnectionsRef.current.forEach(pc => pc.close());
      peerConnectionsRef.current.clear();
      
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [socket, callRoomId, currentUserId, callType]);
  
  // Create peer connection
  const createPeerConnection = useCallback((socketId, userId, username) => {
    const existing = peerConnectionsRef.current.get(socketId);
    if (existing) {
      return existing;
    }

    try {
      const pc = new RTCPeerConnection({
        iceServers: getIceServers()
      });
      
      // Add local stream tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current);
        });
      }
      
      // Handle remote stream
      pc.ontrack = (event) => {
        console.log(`📥 Received track from ${username} (${socketId})`);
        const remoteStream = event.streams[0];
        
        // IMPORTANT: Mute all audio tracks from remote streams
        // Only video will be displayed; audio will come from translated synthesis
        remoteStream.getAudioTracks().forEach(track => {
          track.enabled = false;
          console.log(`🔇 Muted audio track from ${username} - will use translated audio instead`);
        });
        
        setParticipants(prev => {
          const updated = new Map(prev);
          const participant = updated.get(socketId) || {};
          updated.set(socketId, {
            ...participant,
            socketId,
            userId,
            username,
            stream: remoteStream
          });
          return updated;
        });
      };
      
      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('groupCallIceCandidate', {
            callRoomId,
            targetSocketId: socketId,
            candidate: event.candidate
          });
        }
      };
      
      // Connection state monitoring
      pc.onconnectionstatechange = () => {
        console.log(`Connection state with ${username}: ${pc.connectionState}`);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          removeParticipant(socketId);
        }
      };
      
      peerConnectionsRef.current.set(socketId, pc);
      return pc;
      
    } catch (error) {
      console.error('Error creating peer connection:', error);
      return null;
    }
  }, [socket, callRoomId]);
  
  // Remove participant
  const removeParticipant = useCallback((socketId) => {
    const pc = peerConnectionsRef.current.get(socketId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(socketId);
    }
    
    setParticipants(prev => {
      const updated = new Map(prev);
      updated.delete(socketId);
      return updated;
    });
  }, []);
  
  // Socket event handlers
  useEffect(() => {
    if (!socket) return;
    
    // Handle existing participants when joining
    const handleExistingParticipants = async ({ participants: existingParticipants }) => {
      console.log(`👥 Existing participants:`, existingParticipants);
      
      // Create offer for each existing participant
      for (const participant of existingParticipants) {
        const { socketId, userId, username } = participant;
        
        const pc = createPeerConnection(socketId, userId, username);
        if (!pc) continue;
        
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          
          socket.emit('groupCallOffer', {
            callRoomId,
            targetSocketId: socketId,
            offer
          });
          
          console.log(`📤 Sent offer to ${username} (${socketId})`);
        } catch (error) {
          console.error(`Error creating offer for ${username}:`, error);
        }
      }
    };
    
    // Handle new participant joining
    const handleUserJoined = async ({ userId, username, socketId }) => {
      console.log(`👤 User joined: ${username} (${socketId})`);
      
      setParticipants(prev => {
        const updated = new Map(prev);
        updated.set(socketId, {
          socketId,
          userId,
          username,
          stream: null
        });
        return updated;
      });
    };
    
    // Handle incoming offer from another participant
    const handleGroupCallOffer = async ({ fromSocketId, fromUserId, fromUsername, offer }) => {
      console.log(`📥 Received offer from ${fromUsername} (${fromSocketId})`);
      
      const pc = createPeerConnection(fromSocketId, fromUserId, fromUsername);
      if (!pc) return;
      
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socket.emit('groupCallAnswer', {
          callRoomId,
          targetSocketId: fromSocketId,
          answer
        });
        
        console.log(`📤 Sent answer to ${fromUsername} (${fromSocketId})`);
      } catch (error) {
        console.error(`Error handling offer from ${fromUsername}:`, error);
      }
    };
    
    // Handle answer from another participant
    const handleGroupCallAnswer = async ({ fromSocketId, fromUserId, fromUsername, answer }) => {
      console.log(`📥 Received answer from ${fromUsername} (${fromSocketId})`);
      
      const pc = peerConnectionsRef.current.get(fromSocketId);
      if (!pc) {
        console.error(`No peer connection found for ${fromSocketId}`);
        return;
      }
      
      try {
        if (pc.signalingState === 'stable' && pc.currentRemoteDescription) {
          console.log(`⚠️ Skipping duplicate remote description from ${fromUsername}`);
          return;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (error) {
        console.error(`Error setting remote description from ${fromUsername}:`, error);
      }
    };
    
    // Handle ICE candidate
    const handleGroupCallIceCandidate = async ({ fromSocketId, candidate }) => {
      const pc = peerConnectionsRef.current.get(fromSocketId);
      if (!pc) return;
      
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    };
    
    // Handle participant leaving
    const handleUserLeft = ({ socketId }) => {
      console.log(`👋 User left: ${socketId}`);
      removeParticipant(socketId);
    };
    
    // Register event listeners
    socket.on('existingParticipants', handleExistingParticipants);
    socket.on('userJoinedGroupCall', handleUserJoined);
    socket.on('groupCallOffer', handleGroupCallOffer);
    socket.on('groupCallAnswer', handleGroupCallAnswer);
    socket.on('groupCallIceCandidate', handleGroupCallIceCandidate);
    socket.on('userLeftGroupCall', handleUserLeft);
    
    return () => {
      socket.off('existingParticipants', handleExistingParticipants);
      socket.off('userJoinedGroupCall', handleUserJoined);
      socket.off('groupCallOffer', handleGroupCallOffer);
      socket.off('groupCallAnswer', handleGroupCallAnswer);
      socket.off('groupCallIceCandidate', handleGroupCallIceCandidate);
      socket.off('userLeftGroupCall', handleUserLeft);
    };
  }, [socket, callRoomId, createPeerConnection, removeParticipant]);
  
  // Toggle mute - IMPORTANT: We keep the local track enabled for voice recognition
  // But stop sending audio through peer connections when muted
  const toggleMute = useCallback(() => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    
    // Mute/unmute audio in all peer connections
    peerConnectionsRef.current.forEach((pc, socketId) => {
      const senders = pc.getSenders();
      senders.forEach(sender => {
        if (sender.track && sender.track.kind === 'audio') {
          sender.track.enabled = !newMutedState;
          console.log(`${newMutedState ? '🔇' : '🔊'} ${newMutedState ? 'Muted' : 'Unmuted'} audio to peer ${socketId}`);
        }
      });
    });
    
    // Note: We keep localStreamRef.current audio track enabled for voice recognition
    // Only the peer connection tracks are muted
  }, [isMuted]);
  
  // Toggle camera
  const toggleCamera = useCallback(() => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOff(!videoTrack.enabled);
      }
    }
  }, []);
  
  // End call
  const handleEndCall = useCallback(() => {
    // Leave the group call room
    socket.emit('leaveGroupCall', { callRoomId });
    
    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    // Close all peer connections
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    
    // Call parent callback
    if (onEndCall) {
      onEndCall();
    }
  }, [socket, callRoomId, onEndCall]);
  
  return (
    <div className="fixed inset-0 z-50 bg-gray-900">
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/50 to-transparent p-4 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white text-xl font-semibold">{roomName}</h2>
            <p className="text-gray-300 text-sm">{participants.size + 1} participants</p>
          </div>
        </div>
      </div>
      
      {/* Video Grid */}
      <div className="h-full w-full p-4 pt-20 pb-32">
        <div className={`grid gap-4 h-full ${
          participants.size === 0 ? 'grid-cols-1' :
          participants.size === 1 ? 'grid-cols-2' :
          participants.size <= 3 ? 'grid-cols-2 grid-rows-2' :
          participants.size <= 8 ? 'grid-cols-3 grid-rows-3' :
          'grid-cols-4 grid-rows-3'
        }`}>
          {/* Local video */}
          <div className="relative bg-gray-800 rounded-lg overflow-hidden">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className={`w-full h-full object-cover ${isCameraOff ? 'hidden' : ''}`}
            />
            {isCameraOff && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                <div className="w-24 h-24 rounded-full bg-blue-500 flex items-center justify-center text-white text-4xl font-bold">
                  {socket?.user?.username?.[0]?.toUpperCase() || 'Y'}
                </div>
              </div>
            )}
            <div className="absolute bottom-2 left-2 bg-black/70 px-2 py-1 rounded text-white text-sm">
              You {isMuted && '🔇'}
            </div>
          </div>
          
          {/* Remote videos */}
          {Array.from(participants.values()).map((participant) => (
            <ParticipantVideo
              key={participant.socketId}
              participant={participant}
              activeSpeaker={activeSpeaker}
            />
          ))}
        </div>
      </div>
      
      {/* Transcription Display (simple cards) */}
      <div className="absolute bottom-32 left-4 right-4 space-y-3 max-h-80 overflow-y-auto">
        {transcripts.length > 0 && (
          <div className="space-y-2">
            {transcripts.slice(-3).map((transcript, idx) => {
              const isMe = transcript.userId === currentUserId;
              const isTranslated = transcript.isTranslated;

              return (
                <div key={`${transcript.userId}-${idx}-${transcript.timestamp}`} className={`animate-fade-in p-2 rounded-md ${isTranslated ? 'bg-green-900/60' : 'bg-gray-900/60'}`}>
                  <div className="flex items-start justify-between">
                    <div className="text-xs text-emerald-300 font-medium">
                      {isTranslated ? `🌐 ${transcript.username} (translated to ${currentLanguage})` : `${isMe ? '🎤' : '👤'} ${transcript.username} (${transcript.language})`}
                    </div>
                    <div className="text-[10px] text-gray-400 ml-2">{new Date(transcript.timestamp).toLocaleTimeString()}</div>
                  </div>
                  <div className="text-white mt-1 leading-snug line-clamp-3">
                    {transcript.text}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      
      {/* Call Controls */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent p-6 z-10">
        <CallControls
          toggleMute={toggleMute}
          toggleCamera={toggleCamera}
          endCall={handleEndCall}
          isMuted={isMuted}
          isCameraOff={isCameraOff}
        />
      </div>
    </div>
  );
};

// Participant video component
const ParticipantVideo = ({ participant, activeSpeaker }) => {
  const videoRef = useRef(null);
  const [hasVideo, setHasVideo] = useState(false);
  
  useEffect(() => {
    if (videoRef.current && participant.stream) {
      videoRef.current.srcObject = participant.stream;
      videoRef.current.muted = true;
      videoRef.current.volume = 0;
      videoRef.current.setAttribute('muted', 'true');
      
      // Check if stream has video track
      const videoTrack = participant.stream.getVideoTracks()[0];
      setHasVideo(videoTrack && videoTrack.enabled);
      
      // Listen for track changes
      participant.stream.addEventListener('addtrack', () => {
        const vt = participant.stream.getVideoTracks()[0];
        setHasVideo(vt && vt.enabled);
      });
      
      participant.stream.addEventListener('removetrack', () => {
        const vt = participant.stream.getVideoTracks()[0];
        setHasVideo(vt && vt.enabled);
      });
    }
  }, [participant.stream]);
  
  const isActive = activeSpeaker === participant.userId;
  
  return (
    <div className={`relative bg-gray-800 rounded-lg overflow-hidden ${
      isActive ? 'ring-4 ring-green-500' : ''
    }`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={`w-full h-full object-cover ${!hasVideo ? 'hidden' : ''}`}
      />
      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
          <div className="w-24 h-24 rounded-full bg-purple-500 flex items-center justify-center text-white text-4xl font-bold">
            {participant.username?.[0]?.toUpperCase() || '?'}
          </div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 bg-black/70 px-2 py-1 rounded text-white text-sm">
        {participant.username}
      </div>
    </div>
  );
};

export default GroupVideoCall;

// Add global styles for animations
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
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
    
    .animate-fade-in {
      animation: fadeIn 0.3s ease-in;
    }
  `;
  if (!document.head.querySelector('style[data-group-call-styles]')) {
    style.setAttribute('data-group-call-styles', 'true');
    document.head.appendChild(style);
  }
}
