/**
 * Web Audio API Player & Visualizer Controller
 * With reliable background / lock-screen playback support
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
    this.keepAliveAudio = null;

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

      // Set playback state so lock screen controls show correctly
      try {
        navigator.mediaSession.playbackState = 'playing';
      } catch (e) {}
    }
  }

  createSilentWavBlob() {
    const sampleRate = 44100;
    const numSamples = sampleRate * 10; // 10 seconds of silence (longer = more reliable keep-alive)
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    function writeString(offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    // Write near-silent audio (tiny amplitude to prevent iOS from detecting pure silence and suspending)
    for (let i = 0; i < numSamples; i++) {
      view.setInt16(44 + i * 2, (i % 800 === 0) ? 1 : 0, true);
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  }

  async requestWakeLock() {
    if ('wakeLock' in navigator && !this.wakeLock) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        // Re-acquire wake lock if it's released (e.g. tab switch)
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
    if (!this.keepAliveAudio) {
      const blobUrl = this.createSilentWavBlob();
      this.keepAliveAudio = new Audio(blobUrl);
      this.keepAliveAudio.loop = true;
      this.keepAliveAudio.volume = 0.01; // Near-silent but not muted (muted audio gets suspended on iOS)
      this.keepAliveAudio.setAttribute('playsinline', '');
      this.keepAliveAudio.setAttribute('x-webkit-airplay', 'allow');
      this.keepAliveAudio.style.display = 'none';
      document.body.appendChild(this.keepAliveAudio);
    }
    this.keepAliveAudio.play().catch(e => {});
    this.requestWakeLock();
  }

  stopBackgroundKeepAlive() {
    if (this.keepAliveAudio) {
      this.keepAliveAudio.pause();
    }
    this.releaseWakeLock();
    // Update media session state
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
    // Pre-start the keep-alive audio from user gesture context (required on iOS)
    this.startBackgroundKeepAlive();
  }

  setPlaybackRate(rate) {
    this.playbackRate = parseFloat(rate);
    if (this.currentSource && this.currentSource.playbackRate) {
      this.currentSource.playbackRate.value = this.playbackRate;
    }
    if (this.currentHtmlAudio) {
      this.currentHtmlAudio.playbackRate = this.playbackRate;
    }
  }

  /**
   * Plays an AudioBuffer object or Web Speech Utterance
   * Prefers HTML5 Audio for Gemini audio (survives screen lock better than Web Audio API)
   */
  async playItem(audioItem, onEndedCallback) {
    this.initAudioContext();
    this.stopCurrentAudio(); // Stop audio only, keep the keep-alive running

    this.isPlaying = true;

    // Gemini Audio object: prefer blobUrl (HTML5 Audio) for background playback reliability
    if (audioItem && audioItem.blobUrl) {
      const htmlAudio = new Audio(audioItem.blobUrl);
      htmlAudio.playbackRate = this.playbackRate;

      htmlAudio.onended = () => {
        if (this.currentHtmlAudio === htmlAudio) {
          this.isPlaying = false;
          if (onEndedCallback) onEndedCallback();
        }
      };
      htmlAudio.onerror = () => {
        if (this.currentHtmlAudio === htmlAudio) {
          this.isPlaying = false;
          if (onEndedCallback) onEndedCallback();
        }
      };

      this.currentHtmlAudio = htmlAudio;
      htmlAudio.play().catch(e => {
        console.warn('HTML5 Audio play failed:', e);
        // If HTML5 Audio fails, try Web Audio API as fallback
        if (audioItem.audioBuffer) {
          this.playAudioBuffer(audioItem.audioBuffer, onEndedCallback);
        }
      });
      this.startVisualizerMock();
    } else if (audioItem && audioItem.audioBuffer) {
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
   * Stop only the current audio playback (keep the silent keep-alive running for background continuity)
   */
  stopCurrentAudio() {
    this.isPlaying = false;
    this.activeUtterance = null;

    if (this.currentHtmlAudio) {
      try {
        this.currentHtmlAudio.pause();
        this.currentHtmlAudio.currentTime = 0;
      } catch (e) {}
      this.currentHtmlAudio = null;
    }

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
   * Full stop: stop audio AND background keep-alive (used when user pauses)
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
