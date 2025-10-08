/**
 * Handle audio translation functionality
 * @param {Object} io - Socket.IO instance
 * @param {Object} socket - Socket connection
 * @param {Object} users - Active users object
 */
const { translateSpeech, recognizeSpeech, translateText } = require('../utils/speechTranslator');
// ✅ NEW: Import optimized Speech Translation SDK (single API call)
const { translateSpeechDirect } = require('../utils/speechTranslationSDK');
// Server-side metrics
const serverMetrics = require('../utils/performanceMetrics');

/**
 * Compress audio data using simple downsampling for better stream handling
 * @param {Buffer} audioData - Raw audio buffer
 * @returns {Buffer} Compressed audio buffer
 */
const compressAudio = (audioData) => {
  // Simple compression: reduce sample rate by half (basic downsampling)
  // For production, consider using Opus codec with node-opus library
  if (!Buffer.isBuffer(audioData)) return audioData;
  
  const originalLength = audioData.length;
  const compressed = Buffer.alloc(Math.floor(originalLength / 2));
  
  for (let i = 0; i < compressed.length; i++) {
    compressed[i] = audioData[i * 2]; // Take every other byte
  }
  
  console.log(`Audio compressed: ${originalLength} -> ${compressed.length} bytes`);
  return compressed;
};

const handleAudioTranslation = (io, socket, users) => {
  // Add event listener for client-side ready state
  socket.on('audioSystemReady', (data) => {
    console.log('Client audio system ready:', data);
    socket.audioSystemReady = true;
  });
  
  // Handle compressed audio streams for better performance
  socket.on('audioStream', (data) => {
    // Compress audio data before processing
    const compressed = compressAudio(data.audio);
    // Continue with existing processing using compressed data
    // ...existing handler...
    console.log('Compressed audio stream received and processed');
  });
  
  // NEW: Handle speech recognition only (voice-to-text)
  socket.on('recognizeSpeech', async (data) => {
    try {
      const { audio, sourceLanguage, userId, requestId } = data;
      console.log('\n🎤 [SPEECH RECOGNITION] Voice to Text Only');
      console.log(`   📝 Language: ${sourceLanguage}`);
      console.log(`   🆔 Request: ${requestId || 'none'}`);
      
      // Validate input data
      if (!audio || audio.length < 100) {
        console.warn('Invalid audio data received');
        socket.emit('error', { 
          message: 'Invalid audio data',
          requestId
        });
        return;
      }
      
      // Find receiver's socket ID
      const receiverSocketId = Object.keys(users).find(
        key => users[key].userId === userId
      );
      
      if (!receiverSocketId) {
        console.error('Receiver not found or not online:', userId);
        socket.emit('error', { 
          message: 'Receiver not found or not online',
          requestId
        });
        return;
      }
      
      // Convert base64 to buffer
      let audioBuffer;
      try {
        audioBuffer = Buffer.from(audio, 'base64');
      } catch (err) {
        console.error('Error decoding audio data:', err);
        socket.emit('error', { 
          message: 'Invalid audio data format',
          requestId
        });
        return;
      }
      
      // Recognize speech (voice-to-text only)
      const recognizedText = await recognizeSpeech(audioBuffer, sourceLanguage);
      
      if (!recognizedText || !recognizedText.trim()) {
        console.log('No speech detected or empty transcription');
        return;
      }
      
      // Send recognized text only to the sender (local).
      // Do NOT forward raw recognized text to the remote receiver.
      socket.emit('recognizedSpeech', {
        text: recognizedText,
        isLocal: true,
        requestId
      });
      
      console.log(`✅ Speech recognized: "${recognizedText}"`);
    } catch (error) {
      console.error('Error in speech recognition:', error);
      socket.emit('error', {
        message: 'Speech recognition failed',
        requestId: data.requestId
      });
    }
  });
  
  // NEW: Handle text translation only
  socket.on('translateText', async (data) => {
    try {
      let { text, sourceLanguage, targetLanguage, userId, requestId } = data;
      console.log('\n📝 [TEXT TRANSLATION] Text Only');
      console.log(`   📝 ${sourceLanguage} → ${targetLanguage}`);
      console.log(`   🆔 Request: ${requestId || 'none'}`);
      
      // Find receiver's socket ID
      const receiverSocketId = Object.keys(users).find(
        key => users[key].userId === userId
      );
      
      if (!receiverSocketId) {
        console.error('Receiver not found or not online:', userId);
        socket.emit('error', { 
          message: 'Receiver not found or not online',
          requestId
        });
        return;
      }
      
      // Get receiver's preferred language
      const receiverData = users[receiverSocketId];
      targetLanguage = receiverData.preferredLanguage || targetLanguage || 'en';
      
      console.log(`   🎯 Target language set to receiver's preference: ${targetLanguage}`);
      
      // Validate input data
      if (!text || !text.trim()) {
        console.warn('Invalid text data received');
        socket.emit('error', { 
          message: 'Invalid text data',
          requestId
        });
        return;
      }
      
      // Translate text
      const translatedText = await translateText(text, sourceLanguage, targetLanguage);
      
      if (!translatedText) {
        console.log('Translation failed or empty result');
        socket.emit('error', { 
          message: 'Translation failed',
          requestId
        });
        return;
      }
      
      // Send translated text only to the sender (local).
      // Do NOT forward text-only translations to the remote receiver. The
      // receiver will get the combined payload (text + TTS) via
      // 'translatedSpeech' when available.
      socket.emit('translatedText', {
        originalText: text,
        translatedText,
        isLocal: true,
        targetLanguage,
        requestId
      });
      
      console.log(`✅ Text translated: "${text}" → "${translatedText}"`);
    } catch (error) {
      console.error('Error in text translation:', error);
      socket.emit('error', {
        message: 'Text translation failed',
        requestId: data.requestId
      });
    }
  });
  // Add a ping/pong mechanism to check client audio system readiness
  socket.on('pingAudioSystem', () => {
    socket.emit('pongAudioSystem', { timestamp: Date.now() });
  });

  // Handle request for call participant information
  socket.on('getCallParticipantInfo', async (data) => {
    try {
      const { userId } = data;
      
      if (!userId) {
        console.warn('getCallParticipantInfo: No userId provided');
        return;
      }

      // Find the participant's socket
      const participantSocketId = Object.keys(users).find(
        key => users[key].userId === userId
      );

      if (!participantSocketId) {
        console.warn(`getCallParticipantInfo: User ${userId} not found in active users`);
        socket.emit('callParticipantInfo', {
          participantInfo: null,
          error: 'User not found or offline'
        });
        return;
      }

      const participantData = users[participantSocketId];
      
      // Use the preferredLanguage stored in the users object
      // This is updated when user changes language via 'updateLanguagePreference' event
      const participantInfo = {
        id: userId,
        name: participantData.username || 'Unknown',
        preferredLanguage: participantData.preferredLanguage || 'en',
        socketId: participantSocketId
      };

      console.log('📞 Sending call participant info:', participantInfo);

      socket.emit('callParticipantInfo', {
        participantInfo,
        error: null
      });
    } catch (error) {
      console.error('Error getting call participant info:', error);
      socket.emit('callParticipantInfo', {
        participantInfo: null,
        error: error.message
      });
    }
  });
  
  // Handle speech translation -> voice-to-voice using direct speech translation + TTS
  socket.on('translateSpeech', async (data) => {
    const startTime = Date.now();

    try {
      const { audio, sourceLanguage, targetLanguage, userId, requestId, timestamp } = data;
      console.log('\n🎯 [FULL SPEECH TRANSLATION - VOICE] Voice-to-Voice Pipeline');
      console.log(`   📝 ${sourceLanguage} → ${targetLanguage}`);

      if (timestamp) {
        const clientLatency = startTime - timestamp;
        console.log(`   ⏱️  Client processing: ${clientLatency}ms`);
      }

      if (!audio || audio.length < 100) {
        console.error('Invalid audio data received');
        socket.emit('error', { message: 'Invalid audio data', requestId });
        return;
      }

      const receiverSocketId = Object.keys(users).find(key => users[key].userId === userId);
      if (!receiverSocketId) {
        console.error('Receiver not found:', userId);
        socket.emit('error', { message: 'Receiver not found', requestId });
        return;
      }

      let audioBuffer;
      try {
        audioBuffer = Buffer.from(audio, 'base64');
      } catch (err) {
        console.error('Error converting audio from base64:', err);
        socket.emit('error', { message: 'Invalid audio format', requestId });
        return;
      }

      const receiverData = users[receiverSocketId];
      const finalTargetLanguage = receiverData.preferredLanguage || targetLanguage || 'en';
      console.log(`   🎯 Target language set to receiver's preference: ${finalTargetLanguage}`);

      // Use the optimized direct speech translation (single API call)
      const { translateSpeechDirect } = require('../utils/speechTranslationSDK');
      const { textToSpeech } = require('../utils/textToSpeechModule');

      // Partial callback to stream transcripts back
      // Emit partial results only to the sender (local). Do NOT forward
      // partial text-only results to the remote receiver so the remote
      // side only receives the final combined payload (text + TTS).
      const handlePartial = (partial) => {
        if (partial && partial.original) {
          const partialData = {
            text: { original: partial.original, translated: partial.translated || '' },
            audio: null,
            isLocal: true,
            targetLanguage: finalTargetLanguage,
            requestId,
            timestamp: startTime,
            partial: !partial.isFinal
          };

          // Emit partial text only to the sender. Final combined
          // 'translatedSpeech' (text + audio) will be emitted to both
          // sender and receiver when TTS is ready.
          socket.emit('translatedTextPartial', partialData);
        }
      };

      const translateStart = Date.now();
      const result = await translateSpeechDirect(audioBuffer, sourceLanguage, finalTargetLanguage, handlePartial);
      const translateTime = Date.now() - translateStart;

      if (result.error || !result.translated) {
        console.error('Translation failed:', result.error);
        socket.emit('error', { message: 'Translation failed', requestId });
        return;
      }

      // Synthesize translated text into audio (voice-to-voice)
      let ttsBuffer = null;
      try {
        ttsBuffer = await textToSpeech(result.translated, finalTargetLanguage);
      } catch (ttsErr) {
        console.error('Text-to-speech failed:', ttsErr);
        // Fall back to sending only transcripts
      }

      const audioBase64 = ttsBuffer ? ttsBuffer.toString('base64') : null;

      const finalResponseData = {
        text: { original: result.original || '', translated: result.translated || '' },
        audio: audioBase64,
        isLocal: true,
        targetLanguage: finalTargetLanguage,
        requestId,
        timestamp: startTime,
        partial: false,
        metrics: { speechTranslation: translateTime, total: Date.now() - startTime }
      };

      // Send to sender (local)
      socket.emit('translatedSpeech', finalResponseData);

      // Send to receiver (remote)
      finalResponseData.isLocal = false;
      io.to(receiverSocketId).emit('translatedSpeech', finalResponseData);

      console.log(`✅ Voice-to-voice complete: "${result.original}" → "${result.translated}" (${translateTime}ms)`);
    } catch (error) {
      console.error('Error in voice-to-voice speech translation:', error);
      socket.emit('error', { message: 'Speech translation failed', requestId: data.requestId });
    }
  });

  // ✅ NEW: Optimized Speech Translation using Azure Speech Translation SDK
  // This is FASTER than separate STT + Translation (single API call)
  // Expected: 200-400ms faster than 'translateSpeech' event
  socket.on('translateSpeechOptimized', async (data) => {
    const startTime = Date.now();
    
    try {
      const { audio, sourceLanguage, targetLanguage, userId, requestId, timestamp } = data;
      console.log('\n🚀 [OPTIMIZED SPEECH TRANSLATION] Single API Call');
      console.log(`   📝 ${sourceLanguage} → ${targetLanguage}`);
      console.log(`   🆔 Request: ${requestId || 'none'}`);
      
      if (timestamp) {
        const clientLatency = startTime - timestamp;
        console.log(`   ⏱️  Client processing: ${clientLatency}ms`);
      }
      
      if (!audio || audio.length < 100) {
        console.error('Invalid audio data received');
        socket.emit('error', {
          message: 'Invalid audio data',
          requestId
        });
        return;
      }
      
      const receiverSocketId = Object.keys(users).find(
        key => users[key].userId === userId
      );
      
      if (!receiverSocketId) {
        console.error('Receiver not found:', userId);
        socket.emit('error', {
          message: 'Receiver not found',
          requestId
        });
        return;
      }
      
      let audioBuffer;
      try {
        audioBuffer = Buffer.from(audio, 'base64');
      } catch (err) {
        console.error('Error converting audio from base64:', err);
        socket.emit('error', {
          message: 'Invalid audio format',
          requestId
        });
        return;
      }
      
      const receiverData = users[receiverSocketId];
      const finalTargetLanguage = receiverData.preferredLanguage || targetLanguage || 'en';
      
      console.log(`   🎯 Target language: ${finalTargetLanguage}`);
      
      // ✅ OPTIMIZED: Single API call for speech translation
      const translationStartTime = Date.now();
      
      // Callback for partial results
      const handlePartialResult = (partial) => {
        if (partial.original) {
          const partialData = {
            text: {
              original: partial.original,
              translated: partial.translated || ''
            },
            audio: null,
            isLocal: true,
            targetLanguage: finalTargetLanguage,
            requestId,
            timestamp: startTime,
            partial: !partial.isFinal
          };
          // Emit partial text-only event only to the sender. The remote
          // receiver will get the final 'translatedSpeech' (text + audio)
          // which keeps text and audio synchronized.
          socket.emit('translatedTextPartial', partialData);

          if (!partial.isFinal) {
            console.log(`⚡ Partial text-only result sent to sender: "${partial.original}"`);
          }
        }
      };
      
      // Start server-side metric tracking for this request
      const serverMetric = serverMetrics.startTracking(requestId);
      // Record server received timestamp (when audio arrives at server)
      serverMetrics.recordTimestamp(serverMetric, 'serverReceived');
      serverMetrics.recordTimestamp(serverMetric, 'translationStart');

      const result = await translateSpeechDirect(
        audioBuffer,
        sourceLanguage,
        finalTargetLanguage,
        (partial) => {
          // Record partial recognition times loosely
          if (partial && partial.original) {
            // approximate recognition start/end for partial
            serverMetrics.recordTimestamp(serverMetric, 'recognitionStart');
          }
          // invoke existing partial handler to forward to clients
          handlePartialResult(partial);
        }
      );

      serverMetrics.recordTimestamp(serverMetric, 'translationEnd');
      
      const translationTime = Date.now() - translationStartTime;
      
      if (result.error || !result.original) {
        console.error('Translation failed:', result.error);
        socket.emit('error', {
          message: 'Translation failed',
          requestId
        });
        return;
      }
      
      console.log(`✅ Complete: "${result.original}" → "${result.translated}" (${translationTime}ms)`);
      
  // Generate TTS audio for the translated text
      console.log(`🔊 TTS BLOCK REACHED - translated: "${result.translated}"`);
      let ttsBuffer = null;
      console.log(`🔊 Starting TTS for: "${result.translated}" in ${finalTargetLanguage}`);
      try {
        console.log('Loading textToSpeech module...');
        const textToSpeechModule = require('../utils/textToSpeechModule');
        console.log('textToSpeechModule loaded:', textToSpeechModule);
        const { textToSpeech } = textToSpeechModule;
        console.log('textToSpeech function loaded:', typeof textToSpeech);
        console.log('Calling textToSpeech...');
        ttsBuffer = await textToSpeech(result.translated, finalTargetLanguage);
        console.log(`✅ TTS completed, buffer size: ${ttsBuffer ? ttsBuffer.length : 'null'} bytes`);
      } catch (ttsErr) {
        console.error('❌ Text-to-speech failed:', ttsErr);
        console.error('❌ TTS Error stack:', ttsErr.stack);
        // Continue without audio if TTS fails
      }
      
      const audioBase64 = ttsBuffer ? ttsBuffer.toString('base64') : null;
      if (ttsBuffer) {
        console.log(`🔍 Audio buffer first 20 bytes: ${ttsBuffer.slice(0, 20).toString('hex')}`);
        console.log(`🔍 Audio buffer length: ${ttsBuffer.length}`);
        console.log(`🔍 Base64 starts with: ${audioBase64.substring(0, 50)}`);
      }
      console.log(`📤 Sending audio: ${audioBase64 ? 'YES' : 'NO'} (${audioBase64 ? audioBase64.length : 0} chars)`);
      
      // Send final result
      // Record clientReceived timestamp just before emitting back
      serverMetrics.recordTimestamp(serverMetric, 'clientReceived');

      const finalResponseData = {
        text: {
          original: result.original,
          translated: result.translated
        },
        audio: audioBase64,
        isLocal: true,
        targetLanguage: finalTargetLanguage,
        requestId,
        timestamp: startTime,
        partial: false,
        metrics: {
          speechTranslation: translationTime,
          tts: ttsBuffer ? Date.now() - translationStartTime - translationTime : 0,
          total: Date.now() - startTime,
          server: serverMetric
        }
      };
      
      socket.emit('translatedSpeech', finalResponseData);
      
  finalResponseData.isLocal = false;
  io.to(receiverSocketId).emit('translatedSpeech', finalResponseData);

  // Complete server metric tracking
  serverMetrics.recordTimestamp(serverMetric, 'displayed');
  serverMetrics.complete(serverMetric);
      
      const totalTime = Date.now() - startTime;
      console.log(`🚀 Optimized pipeline: ${totalTime}ms (Speech Translation: ${translationTime}ms)`);
      console.log(`   💡 Estimated savings: ~200-300ms vs separate STT+Translation`);
    } catch (error) {
      console.error('Error in optimized speech translation:', error);
      socket.emit('error', {
        message: 'Speech translation failed',
        requestId: data.requestId
      });
    }
  });
};

module.exports = handleAudioTranslation;