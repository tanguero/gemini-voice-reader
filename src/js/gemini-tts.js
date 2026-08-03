/**
 * Gemini API TTS & Web Speech Fallback Engine
 */

const GEMINI_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'];

function resamplePcm16(pcmBytes, fromRate = 24000, toRate = 44100) {
  if (!pcmBytes || pcmBytes.length < 2) return pcmBytes;
  const numSamplesIn = Math.floor(pcmBytes.length / 2);
  const samplesIn = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, numSamplesIn);

  const ratio = toRate / fromRate;
  const numSamplesOut = Math.floor(numSamplesIn * ratio);
  const samplesOut = new Int16Array(numSamplesOut);

  for (let i = 0; i < numSamplesOut; i++) {
    const srcPos = i / ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;

    const s1 = samplesIn[idx] || 0;
    const s2 = samplesIn[idx + 1] || s1;

    samplesOut[i] = Math.round(s1 + frac * (s2 - s1));
  }

  return new Uint8Array(samplesOut.buffer);
}

function pcmToWav(pcmBytes, sampleRate = 44100) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBytes.length;
  const chunkSize = 36 + dataSize;

  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);

  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, chunkSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const wavBytes = new Uint8Array(44 + dataSize);
  wavBytes.set(new Uint8Array(wavHeader), 0);
  wavBytes.set(pcmBytes, 44);

  return wavBytes;
}

export class GeminiTTSEngine {
  constructor() {
    this.apiKey = localStorage.getItem('gemini_api_key') || '';
    this.stylePrompt = localStorage.getItem('gemini_voice_prompt') || 'Read this text naturally, clearly, and expressively like an audiobook narrator.';
    this.audioCache = new Map(); // Cache for sentence index -> AudioBuffer
    this.prefetchQueue = new Set();
    this.speechSynth = 'speechSynthesis' in window ? window.speechSynthesis : null;
    this.prefetchSessionId = 0;
  }

  invalidateCache() {
    this.prefetchSessionId++;
    this.audioCache.clear();
  }

  setApiKey(key) {
    this.apiKey = (key || '').trim().replace(/^["']|["']$/g, '');
    localStorage.setItem('gemini_api_key', this.apiKey);
    this.invalidateCache();
  }

  setStylePrompt(prompt) {
    this.stylePrompt = prompt;
    localStorage.setItem('gemini_voice_prompt', prompt);
    this.invalidateCache();
  }

  hasApiKey() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 5);
  }

  isGeminiVoice(voiceName) {
    return GEMINI_VOICES.includes(voiceName);
  }

  /**
   * Fetch Audio for a specific sentence text using Gemini API or Browser fallback
   * @param {string} text - Sentence text
   * @param {string} voiceName - Gemini voice name or Browser voice name
   * @param {AudioContext} audioCtx - Web Audio Context
   * @returns {Promise<AudioBuffer|SpeechSynthesisUtterance>}
   */
  async getSentenceAudio(text, voiceName = 'Kore', audioCtx) {
    const cacheKey = `${voiceName}:${text}`;
    if (this.audioCache.has(cacheKey)) {
      return this.audioCache.get(cacheKey);
    }

    const currentSession = this.prefetchSessionId;

    if (this.isGeminiVoice(voiceName) && this.hasApiKey()) {
      try {
        const audioBuffer = await this.fetchGeminiSpeech(text, voiceName, audioCtx);
        if (audioBuffer && currentSession === this.prefetchSessionId) {
          this.audioCache.set(cacheKey, audioBuffer);
          return audioBuffer;
        }
      } catch (err) {
        console.warn('Gemini API speech generation failed, falling back to Web Speech API:', err);
        this.lastError = err.message;
      }
    }

    // Fallback or direct Browser Web Speech API
    return this.createWebSpeechUtterance(text, voiceName);
  }

  /**
   * Calls Gemini 2.0 Flash Audio REST API
   */
  /**
   * Calls Gemini REST API for Speech Synthesis
   */
  async fetchGeminiSpeech(text, voiceName, audioCtx) {
    const modelsToTry = [
      'gemini-2.0-flash',
      'gemini-2.0-flash-lite'
    ];

    const formattedVoiceName = voiceName ? (voiceName.charAt(0).toUpperCase() + voiceName.slice(1).toLowerCase()) : 'Kore';
    const promptText = this.stylePrompt ? `${this.stylePrompt}\n\n${text}` : text;

    const payloadVariations = [
      {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: formattedVoiceName }
            }
          }
        }
      },
      {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          responseModalities: ["TEXT", "AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: formattedVoiceName }
            }
          }
        }
      }
    ];

    let firstErr = null;
    let lastErr = null;

    for (const model of modelsToTry) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
      
      for (const requestPayload of payloadVariations) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': this.apiKey
            },
            body: JSON.stringify(requestPayload)
          });

          if (!res.ok) {
            const errText = await res.text();
            const isKeyError = res.status === 401 || res.status === 403 || errText.includes('API_KEY_INVALID') || errText.includes('API key not valid');
            if (isKeyError) {
              throw new Error('Invalid Gemini API Key. Please verify your API Key from Google AI Studio (aistudio.google.com).');
            }
            const err = new Error(`Gemini API Error (${res.status}): ${errText}`);
            if (!firstErr) firstErr = err;
            lastErr = err;
            continue;
          }

          const data = await res.json();
          const candidate = data.candidates?.[0];
          const parts = candidate?.content?.parts || [];
          
          // Search for part containing inlineData (audio bytes)
          const audioPart = parts.find(p => p.inlineData && p.inlineData.data);

          if (!audioPart) {
            const err = new Error('No audio content returned from Gemini API');
            if (!firstErr) firstErr = err;
            lastErr = err;
            continue;
          }

          const base64Data = audioPart.inlineData.data;

          const binaryString = atob(base64Data);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          const mimeType = (audioPart.inlineData.mimeType || '').toLowerCase();
          let finalWavBytes = bytes;

          const isRiff = bytes.length > 4 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70;
          if (!isRiff || mimeType.includes('pcm') || mimeType.includes('raw')) {
            finalWavBytes = pcmToWav(bytes, 24000);
          }

          const blob = new Blob([finalWavBytes], { type: 'audio/wav' });
          const blobUrl = URL.createObjectURL(blob);
          let audioBuffer = null;
          if (audioCtx) {
            try {
              if (audioCtx.state === 'suspended') {
                audioCtx.resume().catch(() => {});
              }
              const arrayBufferSlice = finalWavBytes.buffer.slice(finalWavBytes.byteOffset, finalWavBytes.byteOffset + finalWavBytes.byteLength);
              audioBuffer = await new Promise((resolve) => {
                const res = audioCtx.decodeAudioData(
                  arrayBufferSlice,
                  (decoded) => resolve(decoded),
                  () => resolve(null)
                );
                if (res && typeof res.then === 'function') {
                  res.then(resolve).catch(() => resolve(null));
                }
              });
            } catch (e) {
              console.error('AudioContext decodeAudioData error:', e);
            }
          }

          return {
            blobUrl: blobUrl,
            audioBuffer: audioBuffer,
            pcmBytes: bytes
          };
        } catch (e) {
          if (!firstErr) firstErr = e;
          lastErr = e;
        }
      }
    }

    if (firstErr) throw firstErr;
    if (lastErr) throw lastErr;
    return null;
  }

  /**
   * Pre-fetches audio for upcoming sentences in the document
   */
  prefetchUpcoming(sentences, startIndex, count = 3, voiceName = 'Kore', audioCtx) {
    if (!this.isGeminiVoice(voiceName) || !this.hasApiKey()) return;

    const currentSession = this.prefetchSessionId;

    for (let i = startIndex; i < Math.min(startIndex + count, sentences.length); i++) {
      const s = sentences[i];
      const cacheKey = `${voiceName}:${s.text}`;
      if (!this.audioCache.has(cacheKey) && !this.prefetchQueue.has(cacheKey)) {
        this.prefetchQueue.add(cacheKey);
        this.getSentenceAudio(s.text, voiceName, audioCtx).finally(() => {
          this.prefetchQueue.delete(cacheKey);
        });
      }
    }
  }

  async exportFullDocumentAudio(sentences, voiceName, audioCtx, onProgress) {
    if (!this.hasApiKey()) {
      throw new Error('MISSING_KEY');
    }

    const targetVoice = this.isGeminiVoice(voiceName) ? voiceName : 'Kore';
    const pcmChunks = [];

    for (let i = 0; i < sentences.length; i++) {
      if (onProgress) onProgress(i + 1, sentences.length);

      const cacheKey = `${targetVoice}:${sentences[i].text}`;
      let audioItem = this.audioCache.get(cacheKey);

      if (!audioItem || !audioItem.pcmBytes) {
        // Pass null audioCtx during audio file export to avoid decodeAudioData hanging
        audioItem = await this.fetchGeminiSpeech(sentences[i].text, targetVoice, null);
        if (audioItem && audioItem.pcmBytes) {
          this.audioCache.set(cacheKey, audioItem);
        }
      }

      if (audioItem && audioItem.pcmBytes) {
        pcmChunks.push(audioItem.pcmBytes);
      } else {
        throw new Error(`Speech synthesis failed at sentence ${i + 1}. Please verify your Gemini API key and network connection.`);
      }

      await new Promise(r => setTimeout(r, 40));
    }

    if (pcmChunks.length === 0) {
      throw new Error('No audio data produced.');
    }

    const totalLength = pcmChunks.reduce((acc, c) => acc + c.length, 0);
    const combinedPcm = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of pcmChunks) {
      combinedPcm.set(chunk, offset);
      offset += chunk.length;
    }

    const pcm44k = resamplePcm16(combinedPcm, 24000, 44100);
    const finalWav = pcmToWav(pcm44k, 44100);
    return new Blob([finalWav], { type: 'audio/wav' });
  }

  /**
   * Web Speech API fallback generator
   */
  createWebSpeechUtterance(text, voiceName) {
    const utterance = new SpeechSynthesisUtterance(text);
    if (!this.speechSynth) return utterance;

    const voices = this.speechSynth.getVoices() || [];
    if (voices.length === 0) {
      return utterance;
    }

    const cleanTargetName = (voiceName || '').trim().toLowerCase();

    // 1. Direct match by exact name or voiceURI (for local browser voices)
    let match = voices.find(v => v.name === voiceName || v.voiceURI === voiceName || v.name.trim().toLowerCase() === cleanTargetName);

    if (!match) {
      // 2. Partial match for local voices
      match = voices.find(v => v.name.toLowerCase().includes(cleanTargetName));
    }

    const isGeminiVoice = GEMINI_VOICES.map(v => v.toLowerCase()).includes(cleanTargetName);

    if (!match && isGeminiVoice) {
      const maleKeywords = ['male', 'david', 'mark', 'richard', 'guy', 'george', 'daniel', 'aaron', 'arthur', 'fred', 'gordon', 'oliver', 'tom', 'thomas', 'alex', 'evan', 'nathan', 'malcolm', 'james', 'john', 'steven', 'michael', 'paul', 'brian', 'christopher', 'diego', 'jorge', 'luca', 'rishi', 'vikram'];
      const femaleKeywords = ['female', 'zira', 'linda', 'jenny', 'aria', 'samantha', 'karen', 'moira', 'tessa', 'victoria', 'veena', 'fiona', 'kate', 'serena', 'audrey', 'allison', 'ava', 'susan', 'emma', 'stephanie', 'catherine', 'sarah', 'rachel', 'laura', 'nicky'];

      const isMale = (v) => {
        const name = v.name.toLowerCase();
        return maleKeywords.some(kw => name.includes(kw)) && !name.includes('female');
      };
      const isFemale = (v) => {
        const name = v.name.toLowerCase();
        return femaleKeywords.some(kw => name.includes(kw));
      };

      const usVoices = voices.filter(v => v.lang && (v.lang === 'en-US' || v.lang === 'en_US' || v.lang.startsWith('en-US')));
      const englishVoices = voices.filter(v => v.lang && v.lang.startsWith('en'));
      const activePool = usVoices.length > 0 ? usVoices : (englishVoices.length > 0 ? englishVoices : voices);

      const malePool = activePool.filter(isMale);
      const femalePool = activePool.filter(isFemale);

      const googleUkMale = voices.find(v => (v.name.toLowerCase().includes('uk english male') || (v.name.toLowerCase().includes('google') && v.name.toLowerCase().includes('uk') && isMale(v))) && !v.name.toLowerCase().includes('female'));
      const googleUsMale = voices.find(v => (v.name.toLowerCase().includes('us english') || (v.name.toLowerCase().includes('google') && v.name.toLowerCase().includes('us') && isMale(v))) && !v.name.toLowerCase().includes('female'));
      const googleUkFemale = voices.find(v => v.name.toLowerCase().includes('uk english female') || (v.name.toLowerCase().includes('google') && v.name.toLowerCase().includes('uk') && isFemale(v)));

      utterance.pitch = 1.0;
      utterance.rate = 1.0;

      if (cleanTargetName === 'charon') {
        match = googleUkMale || malePool[0] || activePool[0];
      } else if (cleanTargetName === 'fenrir') {
        match = googleUkMale || malePool[1] || malePool[0] || activePool[Math.min(1, activePool.length - 1)];
      } else if (cleanTargetName === 'puck') {
        match = googleUsMale || googleUkMale || malePool[2] || malePool[0] || activePool[Math.min(2, activePool.length - 1)];
      } else if (cleanTargetName === 'kore') {
        match = googleUkFemale || femalePool[0] || activePool[Math.min(3, activePool.length - 1)];
      } else if (cleanTargetName === 'aoede') {
        match = googleUkFemale || femalePool[1] || femalePool[0] || activePool[Math.min(4, activePool.length - 1)];
      }
    } else if (!match) {
      const usVoices = voices.filter(v => v.lang && (v.lang === 'en-US' || v.lang === 'en_US' || v.lang.startsWith('en-US')));
      const englishVoices = voices.filter(v => v.lang && v.lang.startsWith('en'));
      const pool = usVoices.length > 0 ? usVoices : (englishVoices.length > 0 ? englishVoices : voices);
      match = pool[0];
    }

    if (match) {
      utterance.voice = match;
      utterance.lang = match.lang || 'en-US';
    }

    return utterance;
  }
}

