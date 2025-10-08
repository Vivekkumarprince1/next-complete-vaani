// Optimized call sounds utility for ringtone, ringback, connect, and disconnect

class CallSounds {
  constructor() {
    this.sounds = {
      ringtone: null,
      ringback: null,
      connect: null,
      disconnect: null
    };
    this.initialized = false;
    this.playingSound = null;
    this.audioContext = null;
    this._loopOscillator = null;
  }

  /**
   * Initialize audio - only uses generated tones
   */
  init() {
    if (this.initialized) return;
    this.initialized = true;
    console.log('✓ Call sounds initialized (using generated tones)');
  }

  /**
   * Initialize AudioContext for fallback tones
   */
  async ensureAudioContext() {
    try {
      if (!this.audioContext) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.audioContext = new AC();
      }
      if (this.audioContext?.state === 'suspended') {
        await this.audioContext.resume().catch(() => {});
      }
      return this.audioContext;
    } catch (err) {
      return null;
    }
  }

  /**
   * Safely play an audio element
   */
  async safePlay(audioElement, soundName) {
    if (!audioElement) {
      console.warn(`⚠️ ${soundName} not initialized`);
      return false;
    }

    try {
      if (!audioElement.paused) {
        audioElement.pause();
        audioElement.currentTime = 0;
      }

      await audioElement.play();
      this.playingSound = soundName;
      console.log(`✓ Playing ${soundName}`);
      return true;
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        console.warn(`⚠️ Could not play ${soundName}:`, err.message);
      }
      return false;
    }
  }

  /**
   * Play ringtone (incoming call)
   */
  async playRingtone() {
    this.init();
    this.stopAll();
    
    const ok = await this.safePlay(this.sounds.ringtone, 'ringtone');
    if (!ok) {
      // Fallback to generated tone
      await this.ensureAudioContext();
      this._startGeneratedLoop(420, 'ringtone');
    }
  }

  /**
   * Play ringback (outgoing call)
   */
  async playRingback() {
    this.init();
    this.stopAll();
    
    // Use generated tone for ringback
    await this.ensureAudioContext();
    this._startGeneratedLoop(620, 'ringback');
  }

  /**
   * Play connect sound (call answered)
   */
  async playConnect() {
    this.init();
    this.stopAll();
    
    // Use generated beep for connect
    const ac = await this.ensureAudioContext();
    if (ac) {
      await this._playGeneratedBeep(880, 0.12, 0.6);
      this.playingSound = 'connect';
      console.log('✓ Playing connect beep');
    }
  }

  /**
   * Play disconnect sound (call ended)
   */
  async playDisconnect() {
    this.init();
    
    // Use generated beep for disconnect
    const ac = await this.ensureAudioContext();
    if (ac) {
      await this._playGeneratedBeep(440, 0.18, 0.8);
      console.log('✓ Playing disconnect beep');
    }
  }

  /**
   * Generate looped tone for ringtone/ringback fallback
   */
  _startGeneratedLoop(freq, name) {
    if (!this.audioContext) return;
    
    try {
      const ac = this.audioContext;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.0001;
      
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start();

      // Pulsing pattern
      const pulse = () => {
        const t = ac.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.7, t + 0.02);
        gain.gain.linearRampToValueAtTime(0.0001, t + 0.08);
      };
      
      pulse();
      const timer = setInterval(pulse, 400);

      this._loopOscillator = { osc, gain, timer };
      this.playingSound = name;
      console.log(`✓ Started generated ${name}`);
    } catch (err) {
      console.warn('⚠️ Failed to start generated loop:', err.message);
    }
  }

  /**
   * Stop generated loop
   */
  _stopGeneratedLoop() {
    if (this._loopOscillator) {
      const { osc, gain, timer } = this._loopOscillator;
      clearInterval(timer);
      try { osc.stop(); gain.disconnect(); } catch (e) {}
      this._loopOscillator = null;
    }
  }

  /**
   * Play one-off generated beep
   */
  async _playGeneratedBeep(freq, duration, volume) {
    const ac = await this.ensureAudioContext();
    if (!ac) return;

    return new Promise((resolve) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = volume;
      
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start();
      
      setTimeout(() => {
        try { osc.stop(); osc.disconnect(); gain.disconnect(); } catch (e) {}
        resolve();
      }, duration * 1000);
    });
  }

  /**
   * Stop all sounds
   */
  stopAll() {
    // Stop ringtone audio file
    if (this.sounds.ringtone && !this.sounds.ringtone.paused) {
      this.sounds.ringtone.pause();
      this.sounds.ringtone.currentTime = 0;
    }
    // Stop any generated loops
    this._stopGeneratedLoop();
    this.playingSound = null;
  }

  /**
   * Stop specific sounds
   */
  stopRingtone() {
    if (this.sounds.ringtone && !this.sounds.ringtone.paused) {
      this.sounds.ringtone.pause();
      this.sounds.ringtone.currentTime = 0;
    }
    if (this.playingSound === 'ringtone') this._stopGeneratedLoop();
  }

  stopRingback() {
    if (this.playingSound === 'ringback') this._stopGeneratedLoop();
  }

  /**
   * Get currently playing sound
   */
  getCurrentSound() {
    return this.playingSound;
  }

  /**
   * Enable user interaction flag and unlock audio
   */
  enableUserInteraction() {
    this.unlockAudio().catch(() => {});
  }

  /**
   * Compatibility helper used by components to satisfy browser autoplay checks.
   * Attempts to unlock audio and resume the AudioContext. Resolves when playback
   * is allowed, rejects otherwise.
   */
  async ensurePlaybackAllowed() {
    try {
      // Try the unlock flow first
      const unlocked = await this.unlockAudio();
      if (unlocked) return true;

      // If unlockAudio didn't explicitly succeed, try to resume audio context
      const ac = await this.ensureAudioContext();
      if (ac) {
        if (ac.state === 'suspended') {
          try {
            await ac.resume();
            return true;
          } catch (e) {
            // continue to failure
          }
        } else {
          return true;
        }
      }

      throw new Error('Playback not allowed');
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /**
   * Unlock audio playback (call on user gesture)
   */
  async unlockAudio() {
    const ac = await this.ensureAudioContext();
    if (ac) {
      try {
        await this._playGeneratedBeep(440, 0.01, 0.001);
        console.log('✓ Audio unlocked');
        return true;
      } catch (err) {
        return false;
      }
    }
    return false;
  }
}

// Export singleton instance
const callSounds = new CallSounds();
export default callSounds;