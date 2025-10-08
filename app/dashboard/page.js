'use client'

import React, { useState, useEffect, useContext, useRef } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';
import { AuthContext } from '../../src/contexts/AuthContext';
import { useTranslation } from '../../src/contexts/TranslationContext';
import socketManager from '../../src/utils/socketManager';
import { getIceServers } from '../../src/utils/webrtcConfig';
import callSoundPlayer from '../../src/utils/callSounds';
import Header from '../../src/components/Header';
import ContactList from '../../src/components/ContactList';
import MessageSection from '../../src/components/MessageSection';
import VideoCall from '../../src/components/VideoCall';
import GroupVideoCall from '../../src/components/GroupVideoCall';
import Loader from '../../src/components/Loader';
import SocketStatus from '../../src/components/SocketStatus';
import CreateGroupModal from '../../src/components/CreateGroupModal';
import GroupManagementModal from '../../src/components/GroupManagementModal';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

const Dashboard = () => {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useContext(AuthContext);
  const { currentLanguage, changeLanguage, translateText, translateTexts } = useTranslation();
  
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [messagesPageHasMore, setMessagesPageHasMore] = useState(false);
  const [messagesLoadingMore, setMessagesLoadingMore] = useState(false);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState("Loading...");

  // Video call state
  const [inCall, setInCall] = useState(false);
  const [callType, setCallType] = useState(null); // 'audio' or 'video'
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const [acceptingCall, setAcceptingCall] = useState(false);
  const [activeCallSession, setActiveCallSession] = useState(null);
  // Caller-side ringing state (UI: show callee/device as ringing)
  const [callerRinging, setCallerRinging] = useState(false);
  const [remoteRingingUser, setRemoteRingingUser] = useState(null);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [managingRoom, setManagingRoom] = useState(null);
  
  // Group call state
  const [inGroupCall, setInGroupCall] = useState(false);
  const [groupCallData, setGroupCallData] = useState(null);
  const [pendingGroupCalls, setPendingGroupCalls] = useState([]);
  const [incomingGroupCall, setIncomingGroupCall] = useState(null);

  const socketInstance = socketManager.getSocket();

  // Refs to hold latest selection for socket handlers (avoid stale closures)
  const selectedUserRef = useRef(selectedUser);
  const selectedRoomRef = useRef(selectedRoom);
  const roomsRef = useRef([]);

  // Refs
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const initiatorOfferSentRef = useRef(new Set()); // track callSessionIds we've sent offers for

  // Check authentication
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, router]);

  // Fetch users
  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/auth/users`, {
        headers: { 'x-auth-token': token }
      });
      
      // Transform users to match expected format
      const transformedUsers = res.data.map(u => ({
        id: u._id,
        name: u.username,
        avatar: u.username?.[0]?.toUpperCase() || 'U',
        status: u.status || 'offline',
        lastSeen: u.lastActive
      }));
      
      setUsers(transformedUsers);
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  };

  // Fetch rooms
  const fetchRooms = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/chat/rooms`, {
        headers: { 'x-auth-token': token }
      });
      const roomsData = res.data || [];
      setRooms(roomsData);

      // Ensure we join socket.io rooms for real-time room messages
      try {
        const socket = socketManager.getSocket();
        const joinAll = () => {
          (roomsData || []).forEach(r => {
            try {
              socketManager.emit('joinRoom', r._id);
            } catch (e) {
              console.warn('Failed to join room:', r._id, e);
            }
          });
        };

        if (socket && socket.connected) {
          joinAll();
        } else if (socket) {
          // join once socket connects
          const onConnectJoin = () => {
            joinAll();
            try { socketManager.off('connect', onConnectJoin); } catch (e) {}
          };
          socketManager.on('connect', onConnectJoin);
        }
      } catch (e) {
        console.warn('Error while trying to join rooms:', e);
      }
    } catch (err) {
      console.error('Error fetching rooms:', err);
      setRooms([]);
    }
  };

  // Fetch messages (supports pagination options: { before, limit, append })
  const fetchMessages = async (userId, roomId, opts = {}) => {
    try {
      const token = localStorage.getItem('token');
      const params = userId ? { userId } : { roomId: selectedRoom._id };
      params.limit = opts.limit || 30;
      if (opts.before) params.before = opts.before;
      const res = await axios.get(`${API_URL}/chat/history`, {
        headers: { 'x-auth-token': token },
        params
      });
      // API returns { messages, hasMore }
      const data = res.data || { messages: [] };
      if (opts.append) {
        // prepend older messages so chronological order remains
        setMessages(prev => [...data.messages, ...prev]);
      } else {
        setMessages(data.messages || []);
      }
      setMessagesPageHasMore(Boolean(data.hasMore));
    } catch (err) {
      console.error('Error fetching messages:', err);
      setMessages([]);
    }
  };

  // Load older messages (pagination) when called
  const fetchMoreMessages = async () => {
    if (!messages || messagesLoadingMore || !messagesPageHasMore) return false;
    setMessagesLoadingMore(true);
    try {
      const oldest = messages[0];
      const before = oldest ? oldest.timestamp : undefined;
      await fetchMessages(selectedUser?._id || null, selectedRoom?._id || null, { append: true, before, limit: 30 });
      return true;
    } catch (e) {
      console.error('Error loading more messages:', e);
      return false;
    } finally {
      setMessagesLoadingMore(false);
    }
  };

  // Fetch pending group calls
  const fetchPendingGroupCalls = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/chat/group-call/pending`, {
        headers: { 'x-auth-token': token }
      });
      setPendingGroupCalls(res.data.calls || []);
    } catch (err) {
      console.error('Error fetching pending group calls:', err);
    }
  };

  // Initialize Socket.IO
  useEffect(() => {
    if (!isAuthenticated || !user || typeof window === 'undefined') return;

    const token = localStorage.getItem('token');
    if (!token) return;

    // Enable audio on any user interaction
    const enableAudio = () => {
      callSoundPlayer.enableUserInteraction();
      document.removeEventListener('click', enableAudio);
      document.removeEventListener('keydown', enableAudio);
    };
    document.addEventListener('click', enableAudio);
    document.addEventListener('keydown', enableAudio);

    try {
      const socket = socketManager.initialize(token);
      
      // Wait for socket to connect, then send initial language preference
      const sendLanguagePreference = () => {
        if (currentLanguage) {
          socket.emit('updateLanguagePreference', { language: currentLanguage });
          console.log('📡 Sent initial language preference to server:', currentLanguage);
        }
      };
      
      // Send immediately if already connected
      if (socket.connected) {
        sendLanguagePreference();
      } else {
        // Or wait for connection
        socket.on('connect', sendLanguagePreference);
      }
      
      // Listen for real-time messages
      socketManager.on('receiveMessage', async (msg) => {
        console.log('💬 Received message:', msg);

        // Use refs to avoid stale closures (selectedUser/selectedRoom may change)
        const selUser = selectedUserRef.current;
        const selRoom = selectedRoomRef.current;

        // Determine whether this message should be appended to the current view
        const shouldAppend = (selUser && ((msg.sender && (msg.sender._id === selUser.id || msg.sender._id === selUser._id)) || msg.senderId === selUser.id)) ||
                             (selRoom && (msg.room === selRoom._id || msg.roomId === selRoom._id));

        if (!shouldAppend) return;

        try {
          // Translate incoming message into the user's preferred language before appending
          const translatedContent = await translateText(msg.content, currentLanguage, null);
          // Attach translated content so MessageSection will display the preferred language immediately
          const msgWithTranslated = { ...msg, content: translatedContent, _originalContent: msg.content };
          setMessages(prev => {
            const id = msgWithTranslated._id || msgWithTranslated.id || `${msgWithTranslated.timestamp}-${msgWithTranslated.sender}`;
            if (prev.some(m => (m._id || m.id) === id)) return prev;
            return [...prev, msgWithTranslated];
          });
        } catch (err) {
          console.warn('Translation on receive failed, appending original message:', err);
          setMessages(prev => {
            const id = msg._id || msg.id || `${msg.timestamp}-${msg.sender}`;
            if (prev.some(m => (m._id || m.id) === id)) return prev;
            return [...prev, msg];
          });
        }
      });

      // Listen for typing indicators
      socketManager.on('userTyping', (data) => {
        const selUser = selectedUserRef.current;
        const selRoom = selectedRoomRef.current;
        if ((selUser && data.userId === selUser.id) ||
            (selRoom && data.roomId === selRoom._id)) {
          setIsTyping(data.isTyping);
        }
      });

      // Listen for user status changes
      socketManager.on('userStatusChange', (data) => {
        setUsers(prevUsers => 
          prevUsers.map(u => 
            u.id === data.userId 
              ? { ...u, status: data.status }
              : u
          )
        );
      });

      // Listen for room updates (members added/removed, metadata changed)
      socketManager.on('roomUpdated', (updatedRoom) => {
        console.log('📣 Room updated via socket:', updatedRoom);
        setRooms(prev => prev.map(r => r._id === updatedRoom._id ? updatedRoom : r));
        const selRoom = selectedRoomRef.current;
        if (selRoom && selRoom._id === updatedRoom._id) {
          setSelectedRoom(updatedRoom);
        }
        if (managingRoom && managingRoom._id === updatedRoom._id) {
          setManagingRoom(updatedRoom);
        }
      });

      // Listen for new rooms created that include this user
      socketManager.on('roomCreated', (newRoom) => {
        console.log('📣 New room created via socket:', newRoom);
        setRooms(prev => {
          // Avoid duplicates
          if (prev.some(r => r._id === newRoom._id)) return prev;
          return [newRoom, ...prev];
        });
      });

      console.log('Socket.IO initialization attempted');

      const handleGroupCallIncoming = (payload = {}) => {
        try {
          const currentUserId = user?._id || user?.id;
          if (!currentUserId) return;

          const participantIds = (payload.participants || []).map(p =>
            typeof p === 'string' ? p : p?.userId || p?.id
          ).filter(Boolean);

          if (!participantIds.some(id => id?.toString() === currentUserId.toString())) {
            return;
          }

          const invitation = {
            callId: payload.callId,
            callRoomId: payload.callRoomId,
            roomId: payload.roomId,
            roomName: payload.roomName,
            callType: payload.callType || 'video',
            initiator: payload.initiator
          };

          console.log('📣 Received group call invitation:', invitation);
          setIncomingGroupCall(invitation);
          callSoundPlayer.playRingtone().catch(() => {
            console.log('Ringtone not played for group call invitation');
          });
        } catch (err) {
          console.error('Failed to handle group call incoming payload:', err);
        }
      };

      // Deprecated event support
      const handleGroupCallInvitation = (invitation) => {
        if (!invitation) return;
        console.log('📣 Received group call invitation (deprecated event):', invitation);
        handleGroupCallIncoming(invitation);
      };

      socketManager.on('groupCallIncoming', handleGroupCallIncoming);
      socketManager.on('groupCallInvitation', handleGroupCallInvitation);

      // Fetch pending group calls on socket connection
      const fetchPendingCallInvitations = async () => {
        try {
          await fetchPendingGroupCalls();
        } catch (err) {
          console.warn('Failed to load pending call invitations:', err.message);
        }
      };

      fetchPendingCallInvitations();
    } catch (error) {
      console.warn('Socket.IO initialization failed:', error.message);
      // Continue without real-time features
    }

    return () => {
      try { socketManager.off('groupCallIncoming', handleGroupCallIncoming); } catch (err) {
        console.warn('Failed to detach group call incoming handler:', err);
      }
      try { socketManager.off('groupCallInvitation', handleGroupCallInvitation); } catch (err) {
        console.warn('Failed to detach legacy group call invitation handler:', err);
      }
      try {
        if (socketManager.socket) {
          socketManager.cleanup();
        }
      } catch (error) {
        console.warn('Socket cleanup error:', error);
      }
    };
  }, [isAuthenticated, user]);

  // Load initial data
  useEffect(() => {
    if (isAuthenticated && user) {
      const loadData = async () => {
        setLoadingMessage("Loading contacts...");
        await fetchUsers();
        await fetchRooms();
        await fetchPendingGroupCalls();

        // Join socket.io rooms for real-time updates (so receiveMessage and room events reach this client)
        try {
          const socket = socketManager.getSocket();
          if (socket && socket.connected) {
            // Use the latest rooms state after fetchRooms resolved
            const tokenRooms = await (async () => rooms)();
            (rooms || []).forEach(r => {
              try {
                socketManager.emit('joinRoom', r._id);
              } catch (e) {
                console.warn('Failed to join room after load:', r._id, e);
              }
            });
          }
        } catch (e) {
          console.warn('Error while joining rooms after initial load:', e);
        }
        setLoading(false);
      };
      loadData();
    }
  }, [isAuthenticated, user]);

  // Listen for loadOlderMessages events from MessageSection (scroll to top)
  useEffect(() => {
    const onLoadOlder = async () => {
      try {
        await fetchMoreMessages();
      } catch (e) {
        // ignore
      }
    };
    window.addEventListener('loadOlderMessages', onLoadOlder);
    return () => window.removeEventListener('loadOlderMessages', onLoadOlder);
  }, [messages, messagesPageHasMore, messagesLoadingMore, selectedUser, selectedRoom]);

  // Fetch messages when user/room is selected
  useEffect(() => {
    if (selectedUser) {
  fetchMessages(selectedUser.id, null, { append: false });
    } else if (selectedRoom) {
  fetchMessages(null, selectedRoom._id, { append: false });
    }
  }, [selectedUser, selectedRoom]);

  // Select user
  const selectUser = (u) => {
    // If we were in a room previously, leave it
    try {
      const prevRoom = selectedRoomRef.current;
      if (prevRoom && socketManager.socket?.connected) {
        socketManager.emit('leaveRoom', prevRoom._id);
      }
    } catch (err) {
      console.warn('Error leaving previous room when selecting user:', err);
    }

    setSelectedUser(u);
    setSelectedRoom(null);
    setShowSidebar(false);
  };

  // Keep ref in sync
  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  // Select room
  const selectRoom = (room) => {
    // Leave previous room and join the new one so socket.io room broadcasts reach us
    try {
      const prevRoom = selectedRoomRef.current;
      if (prevRoom && prevRoom._id && socketManager.socket?.connected) {
        if (prevRoom._id !== room._id) {
          socketManager.emit('leaveRoom', prevRoom._id);
        }
      }
      if (room && room._id && socketManager.socket?.connected) {
        socketManager.emit('joinRoom', room._id);
      }
    } catch (err) {
      console.warn('Error joining/leaving rooms on selectRoom:', err);
    }

    setSelectedRoom(room);
    setSelectedUser(null);
    setShowSidebar(false);
  };

  // Keep ref in sync
  useEffect(() => {
    selectedRoomRef.current = selectedRoom;
  }, [selectedRoom]);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  // Create room
  const createRoom = () => {
    setShowCreateGroupModal(true);
  };

  // Handle group creation
  const handleCreateGroup = async (groupData) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API_URL}/chat/rooms`, groupData, {
        headers: { 'x-auth-token': token }
      });

      setRooms(prev => [res.data, ...prev]);
      selectRoom(res.data);
    } catch (err) {
      console.error('Error creating room:', err);
      alert('Failed to create room');
    }
  };

  // Handle room updates (for group management)
  const handleRoomUpdate = (updatedRoom) => {
    setRooms(prev => prev.map(room => 
      room._id === updatedRoom._id ? updatedRoom : room
    ));
    if (selectedRoom && selectedRoom._id === updatedRoom._id) {
      setSelectedRoom(updatedRoom);
    }
    // If group management modal is open for this room, update it too so the modal shows latest participants immediately
    if (managingRoom && managingRoom._id === updatedRoom._id) {
      setManagingRoom(updatedRoom);
    }
  };

  // Send message
  const sendMessage = async () => {
    if (!message.trim()) return;

    try {
      const token = localStorage.getItem('token');
      // clientTempId helps correlate optimistic UI messages with the server-emitted saved message
      const clientTempId = `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
      const payload = {
        content: message,
        clientTempId,
        ...(selectedUser ? { receiverId: selectedUser.id } : { roomId: selectedRoom._id })
      };

      // Note: avoid emitting a pre-save socket message here.
      // The API will save the message and emit the saved/populated message to sockets.

      // Save to database via API (always). We'll prefer the server-emitted socket message which includes _id.
      const resPromise = axios.post(`${API_URL}/chat/message`, payload, {
        headers: { 'x-auth-token': token }
      });

      // Wait briefly for the server to emit the saved message via socket (which includes the _id and clientTempId)
      const savedViaSocket = await new Promise((resolve) => {
        let resolved = false;
        const timeout = setTimeout(async () => {
          if (resolved) return;
          resolved = true;
          try {
            const res = await resPromise;
            resolve(res.data);
          } catch (err) {
            resolve(null);
          }
        }, 700); // 700ms timeout to prefer socket delivery

        const handler = (msg) => {
          if (msg && msg.clientTempId === clientTempId) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(msg);
            }
          }
        };

        // Listen temporarily for socket-delivered saved message
        socketManager.on('receiveMessage', handler);
      });

      if (savedViaSocket) {
        // Server already emitted the saved message; append it (dedupe in handler will ignore duplicates)
        setMessage('');
      } else {
        // Fallback: use API response
        try {
          const res = await resPromise;
          setMessages(prev => {
            const id = res.data._id || res.data.id || `${res.data.timestamp}-${res.data.sender}`;
            if (prev.some(m => (m._id || m.id) === id)) return prev;
            return [...prev, res.data];
          });
        } catch (err) {
          console.error('Error saving message fallback:', err);
        }
        setMessage('');
      }
    } catch (err) {
      console.error('Error sending message:', err);
      alert('Failed to send message. Please try again.');
    }
  };

  // Toggle sidebar
  const toggleSidebar = () => {
    setShowSidebar(!showSidebar);
  };

  // Handle language change
  const handleLanguageChange = async (language) => {
    return await changeLanguage(language);
  };

  // Handle file change
  const handleFileChange = (e) => {
    console.log('File selected:', e.target.files[0]);
  };

  // Initialize peer connection
  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({ iceServers: getIceServers() });

    pc.onicecandidate = (event) => {
      if (event.candidate && selectedUser) {
        socketManager.emit('iceCandidate', {
          to: selectedUser.id,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind);
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      
      // Play connect beep when connection is established
      if (pc.iceConnectionState === 'connected') {
        callSoundPlayer.playConnect().catch(err => {
          console.log('Could not play connect sound:', err.message);
        });
      }
      
      if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        endCall();
      }
    };

    return pc;
  };

  // Create a silent audio track for WebRTC
  const createSilentAudioTrack = () => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const destination = audioContext.createMediaStreamDestination();
    
    oscillator.connect(gainNode);
    gainNode.connect(destination);
    gainNode.gain.value = 0; // Silent
    oscillator.start();
    
    return destination.stream.getAudioTracks()[0];
  };

  // Start call (private or group)
  const startCall = async (type) => {
    if (!selectedUser && !selectedRoom) {
      alert('Please select a user or group to call');
      return;
    }

    // Check if Socket.IO is connected
    if (!socketManager.socket?.connected) {
      alert('Real-time connection not available. Please refresh the page and try again.');
      return;
    }

    try {
      // Enable audio playback (user has interacted by clicking call button)
      callSoundPlayer.enableUserInteraction();
      
      // For group/room calls, use the new group call feature
      if (selectedRoom) {
        await startGroupCall(type);
        return;
        socketManager.emit('joinCallSession', { callSessionId: callSessionInfo.callSessionId });
      } else {
        setActiveCallSession(null);
      }

      setCallType(type);
      
      // Play ringback sound (non-blocking)
      callSoundPlayer.playRingback().catch(() => {
        console.log('Ringback sound not played - user interaction may be required');
      });

      // Get user media
      const constraints = {
        audio: true,
        video: type === 'video' ? { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          facingMode: 'user'
        } : false
      };

      const targetName = selectedUser ? selectedUser.name : selectedRoom.name;
      console.log(`📞 Starting ${type} call to ${targetName}...`);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setLocalStream(stream);

      // Create peer connection
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;

      // Add tracks to peer connection
      // For audio: use a silent track (original voice won't be sent)
      // For video: use the actual video track
      stream.getTracks().forEach(track => {
        if (track.kind === 'audio') {
          // Replace with silent audio track - original voice won't be sent
          const silentTrack = createSilentAudioTrack();
          pc.addTrack(silentTrack, stream);
          console.log(`✓ Added SILENT audio track to peer connection (original voice muted)`);
        } else {
          // Add video track normally
          pc.addTrack(track, stream);
          console.log(`✓ Added ${track.kind} track to peer connection`);
        }
      });

      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const callData = {
        offer: offer,
        callType: type
      };

      if (selectedRoom) {
        // Group call
        callData.roomId = selectedRoom._id;
        if (callSessionInfo) {
          callData.callSessionId = callSessionInfo.callSessionId;
          callData.callRoomId = callSessionInfo.callRoomId;
        }
        socketManager.emit('callUser', callData);
        console.log('✓ Group call offer sent successfully');
      } else {
        // Private call
        callData.to = selectedUser.id;

        // Start a delivery timeout: if we don't get an `incomingCallDelivered` ack
        // within X ms, consider the user unavailable and cleanup the call attempt.
        const DELIVERY_TIMEOUT_MS = 5000;
        let deliveryTimer = null;

        const onDelivered = (data) => {
          try {
            if (data && data.to === selectedUser.id) {
              console.log('✓ incomingCallDelivered ack received for', data);
              if (deliveryTimer) {
                clearTimeout(deliveryTimer);
                deliveryTimer = null;
              }
              // Remove temporary listeners
              try { socketManager.off('incomingCallDelivered', onDelivered); } catch (e) {}
              try { socketManager.off('userUnavailable', onUserUnavailable); } catch (e) {}
              // keep callerRinging unchanged here; we'll wait for app-level ack to mark ringing
            }
          } catch (e) { /* ignore */ }
        };

        const onUserUnavailable = (payload) => {
          try {
            if (payload && payload.to === selectedUser.id) {
              console.log('⚠️ userUnavailable received for', payload);
              if (deliveryTimer) {
                clearTimeout(deliveryTimer);
                deliveryTimer = null;
              }
              // Cleanup call UI
              callSoundPlayer.stopAll();
              setInCall(false);
              setCallType(null);
              // Clear caller ringing state if any
              setCallerRinging(false);
              setRemoteRingingUser(null);
              alert('User is unavailable or offline.');
              try { socketManager.off('incomingCallDelivered', onDelivered); } catch (e) {}
              try { socketManager.off('userUnavailable', onUserUnavailable); } catch (e) {}
            }
          } catch (e) { /* ignore */ }
        };

        // Attach temporary handlers
        socketManager.on('incomingCallDelivered', onDelivered);
        socketManager.on('userUnavailable', onUserUnavailable);

        // Start timer
        deliveryTimer = setTimeout(() => {
          deliveryTimer = null;
          console.warn('No incomingCallDelivered ack received - treating as unavailable');
          callSoundPlayer.stopAll();
          setInCall(false);
          setCallType(null);
          // Clear caller ringing state if any
          setCallerRinging(false);
          setRemoteRingingUser(null);
          alert('No answer from recipient (timeout).');
          try { socketManager.off('incomingCallDelivered', onDelivered); } catch (e) {}
          try { socketManager.off('userUnavailable', onUserUnavailable); } catch (e) {}
        }, DELIVERY_TIMEOUT_MS);

        socketManager.emit('callUser', callData);
        console.log('✓ Private call offer sent successfully (waiting for delivery ack)');
      }

      setInCall(true);
    } catch (err) {
      console.error('Error starting call:', err);
      callSoundPlayer.stopAll();
      
      if (err.name === 'NotAllowedError') {
        alert('❌ Camera/microphone access denied. Please allow access in your browser settings and try again.');
      } else if (err.name === 'NotFoundError') {
        alert('❌ Camera/microphone not found. Please check your devices and try again.');
      } else if (err.name === 'NotReadableError') {
        alert('❌ Camera/microphone is already in use by another application. Please close other apps and try again.');
      } else {
        alert('❌ Failed to start call: ' + err.message);
      }
      endCall();
    }
  };

  // Answer call
  const answerCall = async () => {
    if (!incomingCall) return;

    try {
      console.log('answerCall invoked, incomingCall:', incomingCall);
      console.log('Socket connected?', !!socketManager.socket?.connected, 'socket id:', socketManager.socket?.id);
      
      // Enable audio playback (user has interacted by clicking answer)
      callSoundPlayer.enableUserInteraction();
      
      setAcceptingCall(true);
      callSoundPlayer.stopAll();
      setCallType(incomingCall.callType);

      if (incomingCall.callSessionId) {
        setActiveCallSession(incomingCall);
        socketManager.emit('joinCallSession', { callSessionId: incomingCall.callSessionId });
      } else {
        setActiveCallSession(null);
      }

      // Get user media
      const constraints = {
        audio: true,
        video: incomingCall.callType === 'video' ? { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          facingMode: 'user'
        } : false
      };

      console.log(`📞 Answering ${incomingCall.callType} call from ${incomingCall.fromName}...`);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setLocalStream(stream);

      // Create peer connection
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;

      // Add tracks to peer connection
      // For audio: use a silent track (original voice won't be sent)
      // For video: use the actual video track
      stream.getTracks().forEach(track => {
        if (track.kind === 'audio') {
          // Replace with silent audio track - original voice won't be sent
          const silentTrack = createSilentAudioTrack();
          pc.addTrack(silentTrack, stream);
          console.log(`✓ Added SILENT audio track to peer connection (original voice muted)`);
        } else {
          // Add video track normally
          pc.addTrack(track, stream);
          console.log(`✓ Added ${track.kind} track to peer connection`);
        }
      });

      // If there's no SDP offer (invitation-only group call), join the call session
      // and wait for a real incoming offer to arrive. Otherwise proceed normally.
      const waitingForOffer = !incomingCall.offer && !!incomingCall.callSessionId;

  if (waitingForOffer) {
        // Join call session so server marks us as active participant
        socketManager.emit('joinCallSession', { callSessionId: incomingCall.callSessionId });

        const handleOffer = async (data) => {
          try {
            // Ensure it's for the same session
            if (data.callSessionId && data.callSessionId !== incomingCall.callSessionId) return;
            if (!data.offer) return;

            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socketManager.emit('answerCall', {
              to: data.from,
              answer: answer,
              roomId: data.roomId,
              callSessionId: data.callSessionId,
              callRoomId: data.callRoomId
            });

            console.log('✓ Call answered successfully (after deferred offer)');
            
            // Play connect beep sound
            callSoundPlayer.playConnect().catch(err => {
              console.log('Could not play connect sound:', err.message);
            });
            
            setInCall(true);
            setIncomingCall(null);
          } catch (err) {
            console.error('Error answering deferred offer:', err);
            rejectCall();
          } finally {
            socketManager.off('incomingCall', handleOffer);
          }
        };

        socketManager.on('incomingCall', handleOffer);

        // Safety timeout to avoid hanging forever (shorter during testing)
        setTimeout(() => {
          try { socketManager.off('incomingCall', handleOffer); } catch (e) {}
          console.warn('No offer received for deferred call; aborting');
          setAcceptingCall(false);
          rejectCall();
        }, 8000);
      } else {
        // Normal answer flow with an offer
        await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socketManager.emit('answerCall', {
          to: incomingCall.from,
          answer: answer,
          roomId: incomingCall.roomId,
          callSessionId: incomingCall.callSessionId,
          callRoomId: incomingCall.callRoomId
        });

        console.log('✓ Call answered successfully');
        
        // Play connect beep sound
        callSoundPlayer.playConnect().catch(err => {
          console.log('Could not play connect sound:', err.message);
        });
        
        setInCall(true);
        setIncomingCall(null);
        setAcceptingCall(false);
      }
    } catch (err) {
      console.error('Error answering call:', err);
      callSoundPlayer.stopAll();
      
      if (err.name === 'NotAllowedError') {
        alert('❌ Camera/microphone access denied. Please allow access and try again.');
      } else if (err.name === 'NotFoundError') {
        alert('❌ Camera/microphone not found. Please check your devices.');
      } else if (err.name === 'NotReadableError') {
        alert('❌ Camera/microphone is already in use. Please close other apps and try again.');
      } else {
        alert('❌ Failed to answer call: ' + err.message);
      }
      setAcceptingCall(false);
      rejectCall();
    }
  };

  // Reject call
  const rejectCall = () => {
    console.log('📵 Rejecting incoming call');
    callSoundPlayer.stopAll();
    if (incomingCall) {
      const endCallData = { to: incomingCall.from };
      if (incomingCall.roomId) {
        endCallData.roomId = incomingCall.roomId;
      }
      if (incomingCall.isGroupCall && incomingCall.callSessionId) {
        socketManager.emit('leaveCallSession', { callSessionId: incomingCall.callSessionId });
      } else {
        if (incomingCall.callSessionId) {
          endCallData.callSessionId = incomingCall.callSessionId;
          endCallData.callRoomId = incomingCall.callRoomId;
        }
        socketManager.emit('endCall', endCallData);
      }
    }
    setIncomingCall(null);
  };

  // End call
  const endCall = () => {
    console.log('📴 Ending call');
    
    // Stop all sounds first
    callSoundPlayer.stopAll();
    
    // Play disconnect sound (non-blocking, allow failures)
    callSoundPlayer.playDisconnect().catch(() => {
      console.log('Disconnect sound not played');
    });

    // Stop all tracks
    if (localStream) {
      localStream.getTracks().forEach(track => {
        track.stop();
        console.log(`✓ Stopped ${track.kind} track`);
      });
    }
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => {
        track.stop();
      });
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      console.log('✓ Peer connection closed');
    }

    // Notify other peer
    if (activeCallSession?.callSessionId) {
      socketManager.emit('leaveCallSession', { callSessionId: activeCallSession.callSessionId });
    }

    if (inCall) {
      if (selectedRoom) {
        socketManager.emit('endCall', { roomId: selectedRoom._id, callSessionId: activeCallSession?.callSessionId });
      } else if (selectedUser) {
        socketManager.emit('endCall', { to: selectedUser.id, callSessionId: activeCallSession?.callSessionId });
      }
    }

    // Reset state
    setInCall(false);
    setCallType(null);
    setLocalStream(null);
    setRemoteStream(null);
    setIsMuted(false);
    setIsCameraOff(false);
    peerConnectionRef.current = null;
    setActiveCallSession(null);
    
    console.log('✓ Call ended successfully');
  };

  // Toggle mute
  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  // Toggle camera
  const toggleCamera = () => {
    if (localStream && callType === 'video') {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOff(!videoTrack.enabled);
      }
    }
  };

  // ==================== GROUP CALL FUNCTIONS ====================
  
  // Start group call
  const startGroupCall = async (type = 'video') => {
    if (!selectedRoom) {
      alert('Please select a group to call');
      return;
    }

    try {
      console.log(`📞 Starting group ${type} call for room:`, selectedRoom._id);

      const token = localStorage.getItem('token');
      const res = await axios.post(
        `${API_URL}/chat/group-call/initiate`,
        {
          roomId: selectedRoom._id,
          callType: type
        },
        {
          headers: { 'x-auth-token': token }
        }
      );

      const { call, alreadyActive } = res.data;

      if (!call) {
        throw new Error('Call details missing from server response');
      }

      if (alreadyActive) {
        console.log('ℹ️ Call already active, joining existing session');
        await joinGroupCall({
          callId: call._id || call.id,
          callRoomId: call.callRoomId,
          roomId: call.roomId?._id || call.roomId || selectedRoom._id,
          roomName: call.roomId?.name || selectedRoom.name,
          callType: call.callType || type
        });
        return;
      }

      setGroupCallData({
        callId: call._id || call.id,
        callRoomId: call.callRoomId,
        roomId: call.roomId?._id || call.roomId || selectedRoom._id,
        roomName: call.roomId?.name || selectedRoom.name,
        callType: call.callType || type
      });
      
      setInGroupCall(true);
      
      console.log('✅ Group call initiated:', call);
    } catch (error) {
      console.error('Error starting group call:', error);
      
      // If there's already an active call, offer to join it
      if (error.response?.data?.call) {
        const existingCall = error.response.data.call;
        console.log('ℹ️ Server indicated existing call, attempting to join');
        await joinGroupCall({
          callId: existingCall._id || existingCall.id,
          callRoomId: existingCall.callRoomId,
          roomId: existingCall.roomId?._id || existingCall.roomId || selectedRoom._id,
          roomName: existingCall.roomId?.name || selectedRoom.name,
          callType: existingCall.callType || type
        });
        return;
      } else {
        alert(error.response?.data?.message || 'Failed to start group call');
      }
    }
  };

  // Join group call
  const joinGroupCall = async (callData) => {
    try {
      console.log('📞 Joining group call:', callData);
      
      const token = localStorage.getItem('token');
      const res = await axios.post(
        `${API_URL}/chat/group-call/${callData.callId}/join`,
        {},
        {
          headers: { 'x-auth-token': token }
        }
      );

      const serverCall = res.data?.call;
      const mergedCall = serverCall || callData || {};
      const roomInfo = mergedCall.roomId || {};
      const normalizedRoomId = typeof roomInfo === 'string' ? roomInfo : roomInfo?._id;
      const normalizedRoomName = typeof roomInfo === 'object' ? roomInfo?.name : callData?.roomName;
      const normalizedCallType = mergedCall.callType || callData?.callType || 'video';
      const normalizedCallId = mergedCall._id || mergedCall.id || callData?.callId;
      const normalizedCallRoomId = mergedCall.callRoomId || callData?.callRoomId;
      const participants = serverCall?.participants || [];
      
      setGroupCallData({
        callId: normalizedCallId,
        callRoomId: normalizedCallRoomId,
        roomId: normalizedRoomId,
        roomName: normalizedRoomName || selectedRoom?.name,
        callType: normalizedCallType,
        participants
      });
      
      setInGroupCall(true);
      setIncomingGroupCall(null);
      callSoundPlayer.stopAll();
      
      console.log('✅ Joined group call');
    } catch (error) {
      console.error('Error joining group call:', error);
      alert(error.response?.data?.message || 'Failed to join group call');
    }
  };

  // Decline group call
  const declineGroupCall = async (callData) => {
    try {
      const token = localStorage.getItem('token');
      await axios.post(
        `${API_URL}/chat/group-call/${callData.callId}/decline`,
        {},
        {
          headers: { 'x-auth-token': token }
        }
      );
      
      setIncomingGroupCall(null);
      callSoundPlayer.stopAll();
      
      console.log('✅ Declined group call');
    } catch (error) {
      console.error('Error declining group call:', error);
    }
  };

  // End group call
  const endGroupCall = async () => {
    try {
      console.log('📴 Ending group call');
      
      callSoundPlayer.stopAll();
      callSoundPlayer.playDisconnect().catch(() => {
        console.log('Disconnect sound not played');
      });

      if (groupCallData?.callId) {
        const token = localStorage.getItem('token');
        await axios.post(
          `${API_URL}/chat/group-call/${groupCallData.callId}/leave`,
          {},
          {
            headers: { 'x-auth-token': token }
          }
        );
      }

      setInGroupCall(false);
      setGroupCallData(null);
      
      console.log('✅ Group call ended');
    } catch (error) {
      console.error('Error ending group call:', error);
      // Still clean up local state
      setInGroupCall(false);
      setGroupCallData(null);
    }
  };

  // ==================== END GROUP CALL FUNCTIONS ====================

  // Socket event handlers for WebRTC signaling
  useEffect(() => {
    if (!socketManager.socket) return;

    // Attach incomingCall listener once to avoid race conditions where the server
    // emits an incomingCall before the component re-runs and re-attaches handlers.
    const handleIncomingCall = (data) => {
      console.log('📞 Incoming call from:', data.fromName);
      // Play ringtone (non-blocking)
      callSoundPlayer.playRingtone().catch(() => {
        console.log('Ringtone not played - showing visual notification instead');
      });
      // Emit an app-level ACK so the caller knows the callee UI received the event
      try {
        socketManager.emit('incomingCallAck', { from: data.from, to: user?.id || user?._id, callSessionId: data.callSessionId });
      } catch (e) {
        console.warn('Failed to send incomingCallAck:', e);
      }
      setIncomingCall(data);
    };

    // Register handlers
    socketManager.on('incomingCall', handleIncomingCall);

    // Caller-side: when the callee's UI acknowledges the incoming call, update caller UI
    const handleIncomingCallAck = (data) => {
      try {
        console.log('📣 incomingCallAck received (app-level):', data);
        // If this ack corresponds to the user we called, update ringing state
        if (selectedUser && data && data.from && selectedUser.id && data.from.toString() === selectedUser.id.toString()) {
          setCallerRinging(true);
          setRemoteRingingUser(selectedUser);
          // Optionally stop ringback sound and show ringing UI
          callSoundPlayer.playRingback().catch(() => {});
        }
      } catch (e) {
        console.warn('Error in incomingCallAck handler:', e);
      }
    };

    socketManager.on('incomingCallAck', handleIncomingCallAck);

    // Handle call answered
    socketManager.on('callAnswered', async (data) => {
      console.log('✓ Call answered by:', data.from);
      callSoundPlayer.stopAll();

      if (data.callSessionId) {
        setActiveCallSession(prev => {
          if (prev?.callSessionId) return prev;
          return {
            callSessionId: data.callSessionId,
            callRoomId: data.callRoomId,
            callType,
            from: data.from
          };
        });
      }
      
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.setRemoteDescription(
            new RTCSessionDescription(data.answer)
          );
          console.log('✓ Remote description set successfully');
        } catch (err) {
          console.error('Error setting remote description:', err);
        }
      }
    });

    // Handle ICE candidate
    socketManager.on('iceCandidate', async (data) => {
      console.log('🧊 Received ICE candidate');
      
      if (peerConnectionRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(
            new RTCIceCandidate(data.candidate)
          );
          console.log('✓ ICE candidate added successfully');
        } catch (err) {
          console.error('Error adding ICE candidate:', err);
        }
      }
    });

    // Handle call ended
    socketManager.on('callEnded', () => {
      console.log('� Call ended by remote peer');
      endCall();
    });

    return () => {
      socketManager.off('incomingCall');
      socketManager.off('callAnswered');
      socketManager.off('iceCandidate');
      socketManager.off('callEnded');
      socketManager.off('incomingCallAck', handleIncomingCallAck);
    };
  }, [selectedUser]);

  // Listen for server ack that a participant joined so initiator can send offer if needed
  useEffect(() => {
    if (!socketManager.socket) return;

    const handleParticipantAck = async (data) => {
      try {
        console.log('📣 participantJoinedAck received:', data);
        const { callSessionId } = data || {};
        if (!callSessionId) return;

        // Only initiator should respond by (re)sending an offer
        // Accept ack even if local `activeCallSession` isn't populated yet; use fallback data from server
        const initiatorId = activeCallSession?.initiator?.id || activeCallSession?.initiator;
        if (initiatorId) {
          if (initiatorId.toString() !== user?._id?.toString()) return;
        } else {
          // If we don't have activeCallSession, the ack is addressed to this socket (initiator), so proceed
        }

        // Avoid sending multiple offers for same session
        if (initiatorOfferSentRef.current.has(callSessionId)) {
          console.log('Offer already sent for session', callSessionId);
          return;
        }

        // Ensure we have a peer connection and local tracks
        let pc = peerConnectionRef.current;
        if (!pc) {
          pc = createPeerConnection();
          peerConnectionRef.current = pc;
        }

        // Use callType/roomId from activeCallSession if present, otherwise from ack
        const effectiveCallType = activeCallSession?.callType || data.callType || callType;
        const effectiveRoomId = activeCallSession?.roomId || data.roomId || activeCallSession?.roomId;

        if (!localStream) {
          // Acquire media (best-effort, similar to startCall)
          try {
            const constraints = {
              audio: true,
              video: effectiveCallType === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            setLocalStream(stream);
            stream.getTracks().forEach(track => {
              if (track.kind === 'audio') {
                const silentTrack = createSilentAudioTrack();
                pc.addTrack(silentTrack, stream);
              } else {
                pc.addTrack(track, stream);
              }
            });
          } catch (err) {
            console.warn('Failed to acquire media when resending offer:', err);
          }
        }

        // Create offer and emit to room
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          const callData = {
            offer,
            callType: effectiveCallType,
            roomId: effectiveRoomId,
            callSessionId: callSessionId,
            callRoomId: activeCallSession?.callRoomId || data.callRoomId
          };

          socketManager.emit('callUser', callData);
          initiatorOfferSentRef.current.add(callSessionId);
          console.log('🔁 Initiator resent offer for session', callSessionId);
        } catch (err) {
          console.error('Failed to create/send offer on participantJoinedAck:', err);
        }
      } catch (err) {
        console.error('participantJoinedAck handler error:', err);
      }
    };

    socketManager.on('participantJoinedAck', handleParticipantAck);

    return () => {
      try { socketManager.off('participantJoinedAck', handleParticipantAck); } catch (e) {}
    };
  }, [activeCallSession, localStream, callType, user]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      endCall();
    };
  }, []);

  // Format time
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (authLoading || loading) {
    return <Loader message={loadingMessage} />;
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-100">
      {/* Header */}
      <Header
        user={user}
        toggleSidebar={toggleSidebar}
        handleLanguageChange={handleLanguageChange}
      />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden pt-16">
        {/* Sidebar */}
        <ContactList
          users={users}
          rooms={rooms}
          selectedUser={selectedUser}
          selectedRoom={selectedRoom}
          selectUser={selectUser}
          selectRoom={selectRoom}
          createRoom={createRoom}
          showSidebar={showSidebar}
          onManageGroup={(room) => {
            console.log('Opening group management for room:', room);
            console.log('Current user:', user);
            setManagingRoom(room);
          }}
          user={user}
        />

        {/* Main chat area or video call */}
        {inGroupCall && groupCallData ? (
          <div className="flex-1 flex flex-col">
            {socketInstance ? (
              <GroupVideoCall
                socket={socketInstance}
                callRoomId={groupCallData.callRoomId}
                roomName={groupCallData.roomName}
                currentUserId={user?._id || user?.id}
                onEndCall={endGroupCall}
                callType={groupCallData.callType}
              />
            ) : (
              <Loader message="Preparing group call..." />
            )}
          </div>
        ) : inCall ? (
          <div className="flex-1 flex flex-col">
            <VideoCall
              localStream={localStream}
              remoteStream={remoteStream}
              localVideoRef={localVideoRef}
              remoteVideoRef={remoteVideoRef}
              toggleMute={toggleMute}
              toggleCamera={toggleCamera}
              endCall={endCall}
              isMuted={isMuted}
              isCameraOff={isCameraOff}
              peerConnection={peerConnectionRef.current}
              socket={socketManager.socket}
              selectedUser={selectedUser}
              activeCallSession={activeCallSession}
            />
          </div>
        ) : (selectedUser || selectedRoom) ? (
          <MessageSection
            selectedUser={selectedUser}
            selectedRoom={selectedRoom}
            messages={messages}
            message={message}
            setMessage={setMessage}
            sendMessage={sendMessage}
            handleFileChange={handleFileChange}
            isTyping={isTyping}
            user={user}
            startCall={startCall}
            formatTime={formatTime}
            onManageGroup={(room) => {
              // console.log('Opening group management from chat header for room:', room);
              // console.log('Current user in dashboard:', user);
              // console.log('User ID:', user?.id, 'User _id:', user?._id);
              setManagingRoom(room);
            }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 mx-auto text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-xl text-gray-500 mb-2">Welcome to Vani!</p>
              <p className="text-gray-400">Select a contact to start chatting</p>
            </div>
          </div>
        )}
      </div>

      {/* Incoming call notification */}
      {incomingCall && !inCall && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4 shadow-2xl">
            <div className="text-center">
              <div className="mb-4">
                <div className="w-20 h-20 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl font-bold text-white">
                    {incomingCall.fromName?.[0]?.toUpperCase() || 'U'}
                  </span>
                </div>
                <h3 className="text-2xl font-semibold text-gray-800 mb-2">
                  {incomingCall.fromName}
                </h3>
                <p className="text-gray-600 mb-4">
                  Incoming {incomingCall.callType} call...
                </p>
              </div>

              <div className="flex gap-4 justify-center">
                <button
                  onClick={rejectCall}
                  className="px-6 py-3 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Decline
                </button>
                <button
                  onClick={answerCall}
                  className="px-6 py-3 bg-green-500 text-white rounded-full hover:bg-green-600 transition-colors flex items-center gap-2"
                  disabled={acceptingCall}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  {acceptingCall ? 'Joining...' : 'Accept'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Incoming group call notification */}
      {incomingGroupCall && !inGroupCall && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4 shadow-2xl">
            <div className="text-center">
              <div className="mb-4">
                <div className="w-20 h-20 bg-purple-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <h3 className="text-2xl font-semibold text-gray-800 mb-2">
                  {incomingGroupCall.roomName}
                </h3>
                <p className="text-gray-600 mb-2">
                  Incoming group {incomingGroupCall.callType} call
                </p>
                <p className="text-sm text-gray-500 mb-4">
                  from {incomingGroupCall.initiator?.username}
                </p>
              </div>

              <div className="flex gap-4 justify-center">
                <button
                  onClick={() => declineGroupCall(incomingGroupCall)}
                  className="px-6 py-3 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Decline
                </button>
                <button
                  onClick={() => joinGroupCall(incomingGroupCall)}
                  className="px-6 py-3 bg-green-500 text-white rounded-full hover:bg-green-600 transition-colors flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Join Call
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Socket connection status */}
      <SocketStatus />

      <CreateGroupModal
        isOpen={showCreateGroupModal}
        onClose={() => setShowCreateGroupModal(false)}
        users={users}
        onCreateGroup={handleCreateGroup}
      />

      <GroupManagementModal
        isOpen={!!managingRoom}
        onClose={() => setManagingRoom(null)}
        room={managingRoom}
        users={users}
        currentUserId={user?._id?.toString()}
        onRoomUpdate={handleRoomUpdate}
      />
    </div>
  );
};

export default Dashboard;