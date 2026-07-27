/**
 * Gemini API TTS & Web Speech Fallback Engine
 */

const GEMINI_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'];

function pcmToWav(pcmBytes, sampleRate = 24000) {
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
    return Boolean(this.apiKey && this.apiKey.length > 5);
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
        console.error('Gemini API speech generation failed:', err);
        this.lastError = err.message;
      }
    }

    // Fallback or direct Browser Web Speech API
    return this.createWebSpeechUtterance(text, voiceName);
  }

  /**
   * Calls Gemini 2.0 Flash Audio REST API
   */
  async fetchGeminiSpeech(text, voiceName, audioCtx) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`;
    
    const formattedVoiceName = voiceName ? (voiceName.charAt(0).toUpperCase() + voiceName.slice(1).toLowerCase()) : 'Kore';

    const requestPayload = {
      contents: [
        {
          parts: [
            { text: `Please read this sentence aloud: "${text}"` }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: formattedVoiceName
            }
          }
        }
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const part = candidate?.content?.parts?.[0];

    if (!part || !part.inlineData) {
      throw new Error('No audio content returned from Gemini API');
    }

    const base64Data = part.inlineData.data;

    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const mimeType = (part.inlineData.mimeType || '').toLowerCase();
    let finalWavBytes = bytes;

    // Gemini 2.0 Flash returns raw 24kHz PCM (audio/pcm or audio/raw).
    // Wrap with a 44-byte WAV header if it doesn't already start with 'RIFF'
    const isRiff = bytes.length > 4 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70;
    if (!isRiff || mimeType.includes('pcm') || mimeType.includes('raw')) {
      finalWavBytes = pcmToWav(bytes, 24000);
    }

    const blob = new Blob([finalWavBytes], { type: 'audio/wav' });
    const blobUrl = URL.createObjectURL(blob);
    let audioBuffer = null;
    try {
      audioBuffer = await audioCtx.decodeAudioData(finalWavBytes.buffer.slice(0));
    } catch (e) {}

    return {
      blobUrl: blobUrl,
      audioBuffer: audioBuffer,
      pcmBytes: bytes
    };
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

  /**
   * Exports full document text as a single downloadable WAV audio file
   */
  async exportFullDocumentAudio(sentences, voiceName, audioCtx, onProgress) {
    if (!this.hasApiKey()) {
      throw new Error('Please save your Gemini API Key in Settings ⚙️ to export HD Audio files.');
    }
    if (!this.isGeminiVoice(voiceName)) {
      throw new Error('Audio exporting is available for ✨ Gemini AI voices (Puck, Charon, Kore, Fenrir, Aoede).');
    }

    const pcmChunks = [];

    for (let i = 0; i < sentences.length; i++) {
      if (onProgress) onProgress(i + 1, sentences.length);

      const cacheKey = `${voiceName}:${sentences[i].text}`;
      let audioItem = this.audioCache.get(cacheKey);

      if (!audioItem || !audioItem.pcmBytes) {
        audioItem = await this.fetchGeminiSpeech(sentences[i].text, voiceName, audioCtx);
        if (audioItem) {
          this.audioCache.set(cacheKey, audioItem);
        }
      }

      if (audioItem && audioItem.pcmBytes) {
        pcmChunks.push(audioItem.pcmBytes);
      } else {
        throw new Error(`Could not generate audio for sentence ${i + 1}.`);
      }

      // Small 80ms pacing delay between sentence requests
      await new Promise(r => setTimeout(r, 80));
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

    const finalWav = pcmToWav(combinedPcm, 24000);
    return new Blob([finalWav], { type: 'audio/wav' });
  }

  /**
   * Web Speech API fallback generator
   */
  createWebSpeechUtterance(text, voiceName) {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = this.speechSynth.getVoices();
    
    if (!voices || voices.length === 0) {
      return utterance;
    }

    const cleanTargetName = (voiceName || '').trim().toLowerCase();

    // 1. Direct match by exact name or voiceURI (for local browser voices)
    let match = voices.find(v => v.name === voiceName || v.voiceURI === voiceName || v.name.trim().toLowerCase() === cleanTargetName);

    if (!match) {
      // 2. Partial match for local voices
      match = voices.find(v => v.name.toLowerCase().includes(cleanTargetName));
    }

    if (!match) {
      // 3. Fallback mapping for Gemini prebuilt voice names (Puck, Charon, Kore, Fenrir, Aoede)
      const englishVoices = voices.filter(v => v.lang.startsWith('en') || v.lang.startsWith('en-'));
      const pool = englishVoices.length > 0 ? englishVoices : voices;

      // Smart distribution across available phone voices
      if (cleanTargetName === 'puck') {
        match = pool.find(v => v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('david')) || pool[1 % pool.length] || pool[0];
        utterance.pitch = pool.length > 1 ? 1.0 : 1.15;
      } else if (cleanTargetName === 'charon') {
        match = pool.find(v => v.name.toLowerCase().includes('deep') || (v.name.toLowerCase().includes('male') && v !== pool[0])) || pool[2 % pool.length] || pool[0];
        utterance.pitch = pool.length > 1 ? 1.0 : 0.85;
      } else if (cleanTargetName === 'kore') {
        match = pool.find(v => v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('zira')) || pool[0];
        utterance.pitch = 1.0;
      } else if (cleanTargetName === 'fenrir') {
        match = pool.find(v => v.name.toLowerCase().includes('authoritative') || v.name.toLowerCase().includes('george')) || pool[3 % pool.length] || pool[0];
        utterance.pitch = pool.length > 1 ? 1.0 : 0.90;
      } else if (cleanTargetName === 'aoede') {
        match = pool.find(v => v.name.toLowerCase().includes('female') && v !== pool[0]) || pool[4 % pool.length] || pool[0];
        utterance.pitch = pool.length > 1 ? 1.0 : 1.10;
      } else {
        match = pool[0];
      }
    }

    if (match) {
      utterance.voice = match;
      utterance.lang = match.lang || 'en-US';
    }

    return utterance;
  }
}

