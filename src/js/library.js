/**
 * Document Library & Reading Progress Persistence
 */

const LIBRARY_STORAGE_KEY = 'gemini_reader_library_v1';

export class DocumentLibrary {
  constructor() {
    this.documents = this.loadFromStorage();
  }

  loadFromStorage() {
    try {
      const data = localStorage.getItem(LIBRARY_STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load document library:', e);
      return [];
    }
  }

  saveToStorage() {
    try {
      localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(this.documents));
    } catch (e) {
      console.error('Failed to save document library:', e);
    }
  }

  /**
   * Save or update a parsed document model in library
   */
  addOrUpdateDoc(docModel) {
    const existingIdx = this.documents.findIndex(d => d.id === docModel.id);
    const summaryItem = {
      id: docModel.id,
      title: docModel.title,
      createdAt: docModel.createdAt || new Date().toISOString(),
      lastReadAt: new Date().toISOString(),
      currentSentenceIndex: docModel.currentSentenceIndex || 0,
      totalSentences: docModel.totalSentences,
      totalParagraphs: docModel.totalParagraphs,
      paragraphs: docModel.paragraphs
    };

    if (existingIdx >= 0) {
      this.documents[existingIdx] = summaryItem;
    } else {
      this.documents.unshift(summaryItem);
    }

    this.saveToStorage();
    return summaryItem;
  }

  updateProgress(docId, sentenceIndex) {
    const doc = this.documents.find(d => d.id === docId);
    if (doc) {
      doc.currentSentenceIndex = sentenceIndex;
      doc.lastReadAt = new Date().toISOString();
      this.saveToStorage();
    }
  }

  getDoc(docId) {
    return this.documents.find(d => d.id === docId);
  }

  deleteDoc(docId) {
    this.documents = this.documents.filter(d => d.id !== docId);
    this.saveToStorage();
  }

  getAllDocs() {
    return this.documents;
  }

  /**
   * Creates sample document if library is empty
   */
  getSampleDoc() {
    const sampleText = `Welcome to Gemini Voice Reader! This is a state-of-the-art text-to-speech document reader designed specifically for Android mobile devices and PC desktop browsers.

Inspired by power features in apps like @Voice Aloud Reader, Gemini Voice Reader leverages Google Gemini 2.0 AI voices like Kore, Puck, Charon, and Fenrir to bring your articles, eBooks, and text notes to life with natural human emotion.

You can click or tap any sentence directly in the document view to jump speech playback instantly to that exact sentence. Try tapping on this sentence right now!

Notice how the active sentence glows with an energetic highlight as it reads aloud. We also support playback speed adjustments from 0.5x all the way up to 3.0x, sleep timers, audio visualizers, and offline fallback mode using your browser's built-in voices.

To get started with Gemini AI natural voices, click the gear icon in the top right corner and enter your Gemini API key. Enjoy seamless reading on your phone or PC!`;

    return {
      title: "Welcome & Feature Overview",
      text: sampleText
    };
  }
}
