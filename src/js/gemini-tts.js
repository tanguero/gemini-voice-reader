/**
 * Gemini API TTS & Web Speech Fallback Engine
 */

const GEMINI_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'];

export class GeminiTTSEngine {
  constructor() {
    this.apiKey = localStorage.getItem('gemini_api_key') || '';
    this.stylePrompt = localStorage.getItem('gemini_voice_prompt') || 'Read this text naturally, clearly, and expressively like an audiobook narrator.';
    this.audioCache = new Map(); // Cache for sentence index -> AudioBuffer
    this.prefetchQueue = new Set();
    this.speechSynth = window.speechSynthesis;
  }

  setApiKey(key) {
    this.apiKey = key.trim();
    localStorage.setItem('gemini_api_key', this.apiKey);
    this.audioCache.clear(); // Clear cache when API key changes
  }

  setStylePrompt(prompt) {
    this.stylePrompt = prompt;
    localStorage.setItem('gemini_voice_prompt', prompt);
    this.audioCache.clear();
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

    if (this.isGeminiVoice(voiceName) && this.hasApiKey()) {
      try {
        const audioBuffer = await this.fetchGeminiSpeech(text, voiceName, audioCtx);
        if (audioBuffer) {
          this.audioCache.set(cacheKey, audioBuffer);
          return audioBuffer;
        }
      } catch (err) {
        console.warn('Gemini API speech generation failed, falling back to Web Speech API:', err);
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
    
    const requestPayload = {
      contents: [
        {
          parts: [
            { text: `${this.stylePrompt}\nText: "${text}"` }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceName
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

    const mimeType = part.inlineData.mimeType || 'audio/wav';
    const blob = new Blob([bytes], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    let audioBuffer = null;
    try {
      audioBuffer = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
    } catch (e) {}

    return {
      blobUrl: blobUrl,
      audioBuffer: audioBuffer
    };
  }

  /**
   * Pre-fetches audio for upcoming sentences in the document
   */
  prefetchUpcoming(sentences, startIndex, count = 3, voiceName = 'Kore', audioCtx) {
    if (!this.isGeminiVoice(voiceName) || !this.hasApiKey()) return;

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
    }

    return utterance;
  }
}

