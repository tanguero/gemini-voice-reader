/**
 * Web Audio API Player Controller
 * Uses continuous OscillatorNode to ensure gapless lock-screen / background playback on iOS/Android
 */

export class AudioPlayerController {
  constructor() {
    this.audioCtx = null;
    this.analyser = null;
    this.currentSource = null;
    this.isPlaying = false;
    this.playbackRate = 1.0;
    this.selectedVoice = 'Kore';
    
    this.onSentenceStart = null;
    this.onSentenceEnd = null;
    this.onPlaybackFinished = null;
    
    this.sleepTimerId = null;
    this.sleepTimerEndTime = null;

    this.animFrameId = null;
    
    this.keepAliveOscillator = null;
    this.keepAliveGain = null;

    this.onMediaPlay = null;
    this.onMediaPause = null;
    this.onMediaNext = null;
    this.onMediaPrev = null;

    // Re-acquire wake lock and resume audio when screen unlocks
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.isPlaying) {
        this.requestWakeLock();
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
          this.audioCtx.resume().catch(() => {});
        }
        if ('speechSynthesis' in window) {
          try { window.speechSynthesis.resume(); } catch (e) {}
        }
      }
    });
  }

  updateMediaSession(title, sentenceIdx, totalSentences) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'Gemini Voice Reader',
        artist: `Sentence ${sentenceIdx + 1} of ${totalSentences}`,
        album: 'Gemini Voice Reader PWA',
        artwork: [
          { src: './icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: './icon-192.png', sizes: '192x192', type: 'image/png' }
        ]
      });

      try {
        navigator.mediaSession.setActionHandler('play', () => { if (this.onMediaPlay) this.onMediaPlay(); });
        navigator.mediaSession.setActionHandler('pause', () => { if (this.onMediaPause) this.onMediaPause(); });
        navigator.mediaSession.setActionHandler('previoustrack', () => { if (this.onMediaPrev) this.onMediaPrev(); });
        navigator.mediaSession.setActionHandler('nexttrack', () => { if (this.onMediaNext) this.onMediaNext(); });
      } catch (e) {}

      try {
        navigator.mediaSession.playbackState = 'playing';
      } catch (e) {}
    }
  }

  async requestWakeLock() {
    if ('wakeLock' in navigator && !this.wakeLock) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
          if (this.isPlaying) {
            this.requestWakeLock();
          }
        });
      } catch (e) {}
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release().catch(e => {});
      this.wakeLock = null;
    }
  }

  startBackgroundKeepAlive() {
    this.initAudioContext();
    if (!this.keepAliveOscillator) {
      this.keepAliveOscillator = this.audioCtx.createOscillator();
      this.keepAliveGain = this.audioCtx.createGain();
      
      // Extremely low volume, enough to keep audio hardware engaged without being audible
      this.keepAliveGain.gain.value = 0.0001; 
      
      this.keepAliveOscillator.connect(this.keepAliveGain);
      this.keepAliveGain.connect(this.audioCtx.destination);
      
      this.keepAliveOscillator.start();
    }
    this.requestWakeLock();
  }

  stopBackgroundKeepAlive() {
    if (this.keepAliveOscillator) {
      try {
        this.keepAliveOscillator.stop();
        this.keepAliveOscillator.disconnect();
        this.keepAliveGain.disconnect();
      } catch (e) {}
      this.keepAliveOscillator = null;
      this.keepAliveGain = null;
    }
    this.releaseWakeLock();
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = 'paused'; } catch (e) {}
    }
  }

  initAudioContext() {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.connect(this.audioCtx.destination);
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  unlockMobileAudio() {
    this.initAudioContext();
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
      try {
        const buffer = this.audioCtx.createBuffer(1, 1, 22050);
        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioCtx.destination);
        source.start(0);
      } catch (e) {}
    }
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.resume();
      } catch (e) {}
    }

    this.startBackgroundKeepAlive();
  }

  setPlaybackRate(rate) {
    this.playbackRate = parseFloat(rate);
    if (this.currentSource && this.currentSource.playbackRate) {
      this.currentSource.playbackRate.value = this.playbackRate;
    }
  }

  /**
   * Plays Gemini Audio Buffer or Web Speech Utterance
   */
  async playItem(audioItem, onEndedCallback) {
    this.initAudioContext();
    this.stopCurrentAudio(); // Stop active sentence audio only, keep background oscillator active

    this.isPlaying = true;

    // Prefer Web Audio API buffer for background robustness
    if (audioItem && audioItem.audioBuffer) {
      this.playAudioBuffer(audioItem.audioBuffer, onEndedCallback);
    } else if (audioItem instanceof AudioBuffer) {
      this.playAudioBuffer(audioItem, onEndedCallback);
    } else if (audioItem instanceof SpeechSynthesisUtterance) {
      audioItem.rate = this.playbackRate;
      const currentUtterance = audioItem;
      this.activeUtterance = currentUtterance;

      audioItem.onend = () => {
        if (this.activeUtterance !== currentUtterance) return;
        this.isPlaying = false;
        if (onEndedCallback) onEndedCallback();
      };

      audioItem.onerror = () => {
        if (this.activeUtterance !== currentUtterance) return;
        this.isPlaying = false;
        if (onEndedCallback) onEndedCallback();
      };
      
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(audioItem);
      }
      this.startVisualizerMock();
    }
  }

  playAudioBuffer(audioBuffer, onEndedCallback) {
    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = this.playbackRate;
    source.connect(this.analyser);

    source.onended = () => {
      if (this.currentSource === source) {
        this.isPlaying = false;
        if (onEndedCallback) onEndedCallback();
      }
    };

    this.currentSource = source;
    source.start(0);
    this.startVisualizer();
  }

  /**
   * Stop current sentence audio without stopping background keep-alive
   */
  stopCurrentAudio() {
    this.isPlaying = false;
    this.activeUtterance = null;

    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch (e) {}
      this.currentSource = null;
    }

    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
  }

  /**
   * Full stop: stops audio AND background keep-alive (used when user hits pause)
   */
  stopCurrent() {
    this.stopCurrentAudio();
    this.stopBackgroundKeepAlive();
  }

  startVisualizer() {
    const canvas = document.getElementById('visualizer-canvas');
    if (!canvas || !this.analyser) return;

    const ctx = canvas.getContext('2d');
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!this.isPlaying) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      this.animFrameId = requestAnimationFrame(draw);
      this.analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 1.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        ctx.fillStyle = i % 2 === 0 ? '#6366f1' : '#06b6d4';
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    };

    draw();
  }

  startVisualizerMock() {
    const canvas = document.getElementById('visualizer-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const draw = () => {
      if (!this.isPlaying) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      this.animFrameId = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const barCount = 12;
      const barWidth = canvas.width / barCount;
      for (let i = 0; i < barCount; i++) {
        const height = Math.random() * canvas.height * 0.8;
        ctx.fillStyle = i % 2 === 0 ? '#6366f1' : '#06b6d4';
        ctx.fillRect(i * barWidth, canvas.height - height, barWidth - 1, height);
      }
    };
    draw();
  }

  startSleepTimer(minutes, onTimeout) {
    this.clearSleepTimer();

    if (minutes <= 0) return;

    const ms = minutes * 60 * 1000;
    this.sleepTimerEndTime = Date.now() + ms;
    this.sleepTimerId = setTimeout(() => {
      this.stopCurrent();
      this.clearSleepTimer();
      if (onTimeout) onTimeout();
    }, ms);
  }

  clearSleepTimer() {
    if (this.sleepTimerId) {
      clearTimeout(this.sleepTimerId);
      this.sleepTimerId = null;
      this.sleepTimerEndTime = null;
    }
  }

  getSleepTimerRemaining() {
    if (!this.sleepTimerEndTime) return 0;
    return Math.max(0, Math.ceil((this.sleepTimerEndTime - Date.now()) / 1000 / 60));
  }
}
