'use client'

import { useState, useEffect, useRef } from 'react';
import { createOptimizedAudioContext, hasSound, convertToInt16, createWavBuffer, convertToBase64 } from '../utils/audioProcessing';
import performanceMetrics from '../utils/performanceMetrics';

/**
 * OPTIMIZED: Ultra-low latency audio processing
 * Key improvements:
 * 1. Streaming recognition (partial results)
 * 2. Reduced buffer sizes
 * 3. Parallel processing where possible
 * 4. Optimistic UI updates
 * 5. Performance metrics tracking
 */
const useAudioProcessing = (localStream, remoteStream, socket, selectedUser, currentLanguage, peerConnection = null) => {
  // Separate tracking for local vs remote
  const [localOriginal, setLocalOriginal] = useState('');
  const [localTranslated, setLocalTranslated] = useState('');
  const [remoteOriginal, setRemoteOriginal] = useState('');
  const [remoteTranslated, setRemoteTranslated] = useState('');
  
  // Legacy states
  const [transcribedText, setTranscribedText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [localTranscript, setLocalTranscript] = useState('');
  const [remoteTranscript, setRemoteTranscript] = useState('');
  const [callParticipant, setCallParticipant] = useState(null);
  
  // Audio processing refs
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const processorNodeRef = useRef(null);
  
  // Performance optimization refs
  const lastProcessTimeRef = useRef(0);
  const pendingAudioRef = useRef([]);
  const isProcessingRef = useRef(false);

  // TTS playback queue - ensure only one audio plays at a time
  const ttsQueueRef = useRef([]); // array of { base64, meta }
  const isPlayingRef = useRef(false);
  const runnerRunningRef = useRef(false); // ensures single runner
  const currentAudioElRef = useRef(null);
  
  // ✅ Performance metrics tracking
  const currentMetricRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    if (socket?.connected) {
      socket.emit('audioSystemReady', { ready: true });
      console.log('✅ Audio system ready');
    }
  }, [socket, peerConnection]);

  const getTargetUser = () => {
    return callParticipant || selectedUser;
  };

  useEffect(() => {
    if (!socket?.connected || !selectedUser?.id) return;
    socket.emit('getCallParticipantInfo', { userId: selectedUser.id });
  }, [socket, selectedUser]);

  const setupAudioProcessing = async () => {
    try {
      audioContextRef.current = createOptimizedAudioContext();
      const audioTrack = localStream.getAudioTracks()[0];
      
      if (!audioTrack) {
        console.error('No audio track found');
        return;
      }
      
      sourceNodeRef.current = audioContextRef.current.createMediaStreamSource(
        new MediaStream([audioTrack])
      );
      
      setupOptimizedScriptProcessor();
    } catch (error) {
      console.error('Audio processing setup failed:', error);
    }
  };

  /**
   * OPTIMIZED: Reduced latency audio processor
   * Key changes:
   * - Smaller buffer (512 samples = ~32ms at 16kHz)
   * - Reduced silence threshold (3 chunks = ~96ms)
   * - Minimum audio reduced to 0.3s
   * - Debounced processing
   */
  const setupOptimizedScriptProcessor = () => {
    // CRITICAL: Use 512 buffer size for ~32ms latency (was 2048 = ~128ms)
    processorNodeRef.current = audioContextRef.current.createScriptProcessor(512, 1, 1);
    let audioBuffer = new Float32Array();
    let silenceCounter = 0;
    
    // OPTIMIZED: Reduce thresholds for faster response
    const SILENCE_THRESHOLD = 2; // ~64ms of silence (was 96ms)
    const MIN_AUDIO_LENGTH = audioContextRef.current.sampleRate * 0.3; // 0.3s min (was 0.5s)
    const MIN_PROCESS_INTERVAL = 150; // Minimum 150ms between sends
    
    processorNodeRef.current.onaudioprocess = (e) => {
      if (!socket?.connected || isProcessingRef.current) return;
  
      const inputData = e.inputBuffer.getChannelData(0);
      const hasCurrentSound = hasSound(inputData, 0.003); // Lower threshold
      
      if (hasCurrentSound) {
        const newBuffer = new Float32Array(audioBuffer.length + inputData.length);
        newBuffer.set(audioBuffer);
        newBuffer.set(inputData, audioBuffer.length);
        audioBuffer = newBuffer;
        silenceCounter = 0;
      } else if (audioBuffer.length > 0) {
        silenceCounter++;
        
        // Check if enough silence and minimum audio length
        if (silenceCounter >= SILENCE_THRESHOLD && audioBuffer.length >= MIN_AUDIO_LENGTH) {
          const now = Date.now();
          const timeSinceLastProcess = now - lastProcessTimeRef.current;
          
          // Debounce to prevent too frequent sends
          if (timeSinceLastProcess >= MIN_PROCESS_INTERVAL) {
            isProcessingRef.current = true;
            lastProcessTimeRef.current = now;
            
            const bufferToProcess = audioBuffer;
            audioBuffer = new Float32Array();
            silenceCounter = 0;
            
            sendAudioForTranslation(bufferToProcess)
              .finally(() => {
                isProcessingRef.current = false;
              });
          }
        }
      }
    };
  
    sourceNodeRef.current.connect(processorNodeRef.current);
    processorNodeRef.current.connect(audioContextRef.current.destination);
  };

  /**
   * OPTIMIZED: Faster audio transmission with performance tracking
   */
  const sendAudioForTranslation = async (audioData) => {
    try {
      if (!socket?.connected) return;
      
      const targetUser = getTargetUser();
      const targetLanguage = targetUser?.preferredLanguage || 'en';
      const targetUserId = targetUser?.id || 'unknown';
      
      const requestId = `speech-${Date.now()}`;
      
      // ✅ Start performance tracking
      const metric = performanceMetrics.startTracking(requestId);
      performanceMetrics.recordTimestamp(metric, 'audioCapture');
      currentMetricRef.current = metric;
      
      // Convert and send immediately - no delays
      const pcmData = convertToInt16(audioData);
      const wavBuffer = createWavBuffer(pcmData);
      const base64Audio = await convertToBase64(wavBuffer);
      
      performanceMetrics.recordTimestamp(metric, 'audioProcessed');
      
      // Single event for entire pipeline (optimized)
      socket.emit('translateSpeechOptimized', {
        audio: base64Audio,
        sourceLanguage: currentLanguage,
        targetLanguage,
        userId: targetUserId,
        sampleRate: 16000,
        encoding: 'WAV',
        requestId,
        timestamp: Date.now() // For latency tracking
      });
    } catch (error) {
      console.error('Error sending audio:', error);
    }
  };

  const cleanupAudioProcessing = () => {
    if (processorNodeRef.current) {
      processorNodeRef.current.disconnect();
      processorNodeRef.current = null;
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
  };

  useEffect(() => {
    if (!localStream || !socket?.connected) return;
    setupAudioProcessing();
    return () => {
      cleanupAudioProcessing();
    };
  }, [localStream, socket, callParticipant, currentLanguage]);

  // OPTIMIZED: Event listeners with latency tracking and partial results
  useEffect(() => {
    if (!socket || !socket.connected) return;
    
    const handleTranslatedSpeech = async (data) => {
      if (!data) return;

      const { text, isLocal, requestId, timestamp, partial, metrics } = data;
      
      // ✅ Track client receive time and merge server metrics if available
      const metric = currentMetricRef.current;
      if (metric && metric.requestId === requestId) {
        // mark when client received the server response
        performanceMetrics.recordTimestamp(metric, 'clientReceived');

        // Merge server-provided timestamps/durations when present
        try {
          const serverMetric = metrics && metrics.server ? metrics.server : null;
          if (serverMetric && serverMetric.timestamps) {
            Object.entries(serverMetric.timestamps).forEach(([k, v]) => {
              if (v) {
                metric.timestamps[k] = v; // copy server timestamp
              }
            });
            // Recalculate durations using merged timestamps
            if (typeof performanceMetrics._calculateDurations === 'function') {
              performanceMetrics._calculateDurations(metric);
            }
          }
        } catch (e) {
          // non-fatal
        }
      }

      // ⚡ Calculate and display latency metrics
      if (timestamp) {
        const totalLatency = Date.now() - timestamp;

        // Prefer server-side durations when available
        if (metrics) {
          const srv = metrics.server && metrics.server.durations ? metrics.server.durations : metrics;
          const rec = srv.recognition || srv.recognition === 0 ? srv.recognition : (metrics.recognition || 0);
          const trans = srv.translation || srv.translation === 0 ? srv.translation : (metrics.translation || 0);
          const totalSrv = srv.serverTotal || srv.total || 0;

          console.log(`📊 Performance Metrics:\n  ├─ Recognition: ${rec}ms\n  ├─ Translation: ${trans}ms\n  ├─ Total Server: ${totalSrv}ms\n  └─ End-to-End: ${totalLatency}ms`);
        } else if (partial) {
          console.log(`⚡ Partial result latency: ${totalLatency}ms (recognition only)`);
        } else {
          console.log(`⚡ Total latency: ${totalLatency}ms`);
        }
      }

      if (text) {
        if (isLocal) {
          // Always update original text (available in both partial and final)
          if (text.original) {
            setLocalOriginal(text.original);
            setTranscribedText(text.original);
          }
          
          // Only update translated text when available (final result)
          if (text.translated && !partial) {
            setLocalTranslated(text.translated);
            setTranslatedText(text.translated);
            
            // ✅ Complete metrics tracking
            if (metric && metric.requestId === requestId) {
              performanceMetrics.recordTimestamp(metric, 'displayed');
              performanceMetrics.complete(metric);
              currentMetricRef.current = null;
            }
          }
        } else {
          // Always update original text for remote
          if (text.original) {
            setRemoteOriginal(text.original);
          }
          
          // Only update translated text when available (final result)
          if (text.translated && !partial) {
            setRemoteTranslated(text.translated);
          }
          
          // Play translated audio when provided (final result)
          if (data.audio && !partial) {
            console.log(`🔊 Client received audio for playback: ${data.audio.length} chars`);
            // Enqueue audio for sequential playback
            try {
              const audioBase64 = data.audio;
              enqueueTtsAudio(audioBase64, { requestId, timestamp, text: text.translated });
            } catch (err) {
              console.error('❌ Error enqueueing translated audio:', err);
            }
          } else if (!partial) {
            console.log('🔇 No audio received for playback');
          }
        }
      }
    };
    
    socket.on('translatedSpeech', handleTranslatedSpeech);

    // Listen for partial text-only results (arrive earlier). These update the UI
    // with interim transcripts but do not trigger audio playback. Final 'translatedSpeech'
    // will contain both text and audio and should be used for synchronized playback.
    const handleTranslatedTextPartial = (data) => {
      if (!data) return;
      const { text, isLocal, partial } = data;

      if (isLocal) {
        if (text && text.original) {
          setLocalOriginal(text.original);
          setTranscribedText(text.original);
        }
        // don't update translated final text until final message arrives
      } else {
        if (text && text.original) {
          setRemoteOriginal(text.original);
        }
        // partial translated text may be shown if available
        if (text && text.translated && partial) {
          setRemoteTranslated(text.translated);
        }
      }
    };

    socket.on('translatedTextPartial', handleTranslatedTextPartial);
    
    socket.on('callParticipantInfo', (data) => {
      if (data.participantInfo) {
        setCallParticipant(data.participantInfo);
      }
    });

    return () => {
      socket.off('translatedSpeech', handleTranslatedSpeech);
      socket.off('translatedTextPartial', handleTranslatedTextPartial);
      socket.off('callParticipantInfo');
      // cleanup any queued or playing audio
      stopAndCleanupTts();
    };
  }, [socket, currentLanguage]);

  // Enqueue a base64 audio string (TTS) with optional metadata
  const enqueueTtsAudio = (base64Audio, meta = {}) => {
    if (!base64Audio) return;
    ttsQueueRef.current.push({ base64: base64Audio, meta });
    console.log('🔔 TTS enqueued, queue length:', ttsQueueRef.current.length, meta?.requestId || '');
    // Start the runner if not already running
    if (!runnerRunningRef.current) {
      runnerRunningRef.current = true;
      // run without awaiting so it processes asynchronously
      runTtsQueueRunner();
    }
  };

  // Helper to play a single audio element and await its end or error
  const playAudioAndWait = (audioEl) => {
    return new Promise((resolve) => {
      const onEnded = () => {
        try { audioEl.pause(); audioEl.src = ''; } catch (e) {}
        audioEl.removeEventListener('ended', onEnded);
        audioEl.removeEventListener('error', onError);
        resolve();
      };
      const onError = (err) => {
        console.warn('TTS playback error', err);
        audioEl.removeEventListener('ended', onEnded);
        audioEl.removeEventListener('error', onError);
        try { audioEl.pause(); audioEl.src = ''; } catch (e) {}
        resolve();
      };
      audioEl.addEventListener('ended', onEnded);
      audioEl.addEventListener('error', onError);
      // try to play; if blocked, resolve immediately so queue continues
      audioEl.play().then(() => {
        // playing; wait for events
      }).catch((err) => {
        console.warn('🔇 TTS autoplay blocked or failed:', err);
        // resolve to continue queue
        onError(err);
      });
    });
  };

  // Runner loop that consumes the queue sequentially
  const runTtsQueueRunner = async () => {
    console.log('▶️ TTS runner started');
    isPlayingRef.current = true;
    while (ttsQueueRef.current.length > 0) {
      const next = ttsQueueRef.current.shift();
      if (!next) break;
      const { base64, meta } = next;
      console.log('▶️ TTS runner playing next, remaining:', ttsQueueRef.current.length, meta?.requestId || '');
      // Defensive: ensure any prior audio is stopped
      if (currentAudioElRef.current) {
        try {
          currentAudioElRef.current.pause();
          currentAudioElRef.current.src = '';
        } catch (e) {}
        currentAudioElRef.current = null;
      }
      try {
        const audioUrl = `data:audio/mp3;base64,${base64}`;
        const audioEl = new Audio(audioUrl);
        currentAudioElRef.current = audioEl;
        console.log('🔊 TTS playback started for', meta?.requestId || '', 'url len', audioUrl.length);
        // await audio end or error
        // eslint-disable-next-line no-await-in-loop
        await playAudioAndWait(audioEl);
        console.log('⏹️ TTS playback ended for', meta?.requestId || '');
        currentAudioElRef.current = null;
      } catch (err) {
        console.error('Error in TTS runner playback:', err);
        currentAudioElRef.current = null;
      }
      // small gap between audios
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res) => setTimeout(res, 50));
    }
    isPlayingRef.current = false;
    runnerRunningRef.current = false;
  };

  // Stop and clean up queue and any playing audio
  const stopAndCleanupTts = () => {
    // Clear queue
    ttsQueueRef.current = [];
    // Stop current audio
    const audioEl = currentAudioElRef.current;
    if (audioEl) {
      try {
        audioEl.pause();
        audioEl.src = '';
        // remove listeners if present by replacing with new element
        try { audioEl.removeAttribute && audioEl.removeAttribute('src'); } catch (e) {}
      } catch (e) {}
      currentAudioElRef.current = null;
    }
    isPlayingRef.current = false;
    runnerRunningRef.current = false;
  };

  return {
    transcribedText,
    translatedText,
    localTranscript,
    remoteTranscript,
    callParticipant,
    setCallParticipant,
    localOriginal,
    localTranslated,
    remoteOriginal,
    remoteTranslated
  };
};

export default useAudioProcessing;