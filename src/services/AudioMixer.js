// class AudioMixer {
//   constructor() {
//     // Initialize AudioContext on constructor
//     this.audioContext = null;
//     this.destination = null;
//     this.audioElement = null;
    
//     if (typeof window !== 'undefined') {
//       this.initAudioContext();
//     }
//   }

//   // Add method to initialize AudioContext
//   initAudioContext() {
//     try {
//       if (typeof window === 'undefined') return;
      
//       this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
//       this.destination = this.audioContext.createMediaStreamDestination();
//       console.log('AudioContext initialized successfully:', this.audioContext.state);
//     } catch (error) {
//       console.error('Failed to initialize AudioContext:', error);
//     }
//   }

//   // Add method to ensure AudioContext is active
//   async ensureAudioContextActive() {
//     if (!this.audioContext) {
//       this.initAudioContext();
//     }
    
//     if (this.audioContext && this.audioContext.state === 'suspended') {
//       try {
//         console.log('Resuming suspended audio context');
//         await this.audioContext.resume();
//         console.log('AudioContext resumed successfully:', this.audioContext.state);
//       } catch (error) {
//         console.error('Failed to resume AudioContext:', error);
//         // Re-initialize if resume fails
//         this.initAudioContext();
//       }
//     }
//     return this.audioContext && this.audioContext.state === 'running';
//   }

//   async createMixedStream(translatedAudioBuffer) {
//     try {
//       // Ensure audio context is active
//       await this.ensureAudioContextActive();
      
//       // Create buffer source for translated audio
//       const source = this.audioContext.createBufferSource();
//       source.buffer = translatedAudioBuffer;

//       // Create gain node for volume control
//       const gainNode = this.audioContext.createGain();
//       gainNode.gain.value = 1.0;

//       // Connect nodes
//       source.connect(gainNode);
//       gainNode.connect(this.destination);

//       // Start playback
//       source.start(0);

//       // Return the mixed stream
//       return this.destination.stream;
//     } catch (error) {
//       console.error('Error creating mixed stream:', error);
//       throw error;
//     }
//   }

//   // Revised playTranslatedAudio method with better error handling
//   async playTranslatedAudio(audioData) {
//     try {
//       console.log('AudioMixer: Starting playTranslatedAudio method');
      
//       // Ensure audio context is active before proceeding
//       const contextActive = await this.ensureAudioContextActive();
//       if (!contextActive) {
//         console.error('AudioMixer: Failed to activate AudioContext');
//         throw new Error('Failed to activate AudioContext');
//       }
      
//       console.log('AudioMixer: AudioContext is active:', this.audioContext.state);
      
//       // Convert base64 to ArrayBuffer if needed
//       let arrayBuffer;
//       if (typeof audioData === 'string') {
//         console.log('AudioMixer: Converting base64 to ArrayBuffer');
//         // Remove data URL prefix if present
//         const base64Data = audioData.replace(/^data:audio\/\w+;base64,/, '');
//         const binaryString = atob(base64Data);
//         const bytes = new Uint8Array(binaryString.length);
//         for (let i = 0; i < binaryString.length; i++) {
//           bytes[i] = binaryString.charCodeAt(i);
//         }
//         arrayBuffer = bytes.buffer;
//       } else {
//         arrayBuffer = audioData;
//       }
      
//       console.log('AudioMixer: ArrayBuffer size:', arrayBuffer.byteLength);
      
//       // Decode audio data
//       const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      
//       // Create buffer source
//       const source = this.audioContext.createBufferSource();
//       source.buffer = audioBuffer;
      
//       // Create gain node
//       const gainNode = this.audioContext.createGain();
//       gainNode.gain.value = 1.0;
      
//       // Connect nodes
//       source.connect(gainNode);
//       gainNode.connect(this.audioContext.destination);
      
//       // Start playback
//       source.start(0);
      
//       console.log('AudioMixer: Audio playback started');
      
//       return new Promise((resolve) => {
//         source.onended = () => {
//           console.log('AudioMixer: Audio playback ended');
//           resolve();
//         };
//       });
//     } catch (error) {
//       console.error('AudioMixer: Error in playTranslatedAudio:', error);
//       throw error;
//     }
//   }

//   // Clean up resources
//   cleanup() {
//     if (this.audioContext) {
//       this.audioContext.close();
//       this.audioContext = null;
//     }
    
//     if (this.audioElement) {
//       this.audioElement.pause();
//       this.audioElement.src = '';
//       this.audioElement = null;
//     }
//   }
// }

// export default AudioMixer;