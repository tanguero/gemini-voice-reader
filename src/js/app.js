/**
 * Gemini Voice Reader - Main Application Controller
 */

import { DocumentParser } from './parser.js';
import { GeminiTTSEngine } from './gemini-tts.js';
import { AudioPlayerController } from './audio-player.js';
import { DocumentLibrary } from './library.js';

class GeminiVoiceReaderApp {
  constructor() {
    this.ttsEngine = new GeminiTTSEngine();
    this.player = new AudioPlayerController();
    this.library = new DocumentLibrary();

    this.currentDoc = null;
    this.currentSentenceIndex = 0;
    this.speedRates = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
    this.currentSpeedIdx = 2; // Default 1.0x

    this.initElements();
    this.bindEvents();
    this.bindMediaSession();
    this.registerServiceWorker();

    this.populateLocalVoices();

    const savedVoice = localStorage.getItem('selected_voice');
    if (savedVoice && this.voiceSelect) {
      const optionExists = Array.from(this.voiceSelect.options).some(opt => opt.value === savedVoice);
      if (optionExists) {
        this.voiceSelect.value = savedVoice;
        this.player.selectedVoice = savedVoice;
      }
    }

    this.loadInitialDoc();
  }

  bindMediaSession() {
    this.player.onMediaPlay = () => this.startPlayback();
    this.player.onMediaPause = () => this.pausePlayback();
    this.player.onMediaNext = () => this.skipSentence(1);
    this.player.onMediaPrev = () => this.skipSentence(-1);
  }

  initElements() {
    // Top Bar
    this.btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    this.btnCloseSidebar = document.getElementById('btn-close-sidebar');
    this.sidebar = document.getElementById('sidebar');
    this.sidebarBackdrop = document.getElementById('sidebar-backdrop');
    this.currentDocTitle = document.getElementById('current-doc-title');
    this.btnImport = document.getElementById('btn-import');
    this.btnFontToggle = document.getElementById('btn-font-toggle');
    this.btnSettings = document.getElementById('btn-settings');
    this.btnNewDoc = document.getElementById('btn-new-doc');

    // Content Views
    this.readerView = document.getElementById('reader-view');
    this.emptyState = document.getElementById('empty-state');
    this.readerContent = document.getElementById('reader-content');
    this.libraryList = document.getElementById('library-list');

    // Controls & Buttons
    this.btnPlayPause = document.getElementById('btn-play-pause');
    this.iconPlay = document.getElementById('icon-play');
    this.iconPause = document.getElementById('icon-pause');
    
    this.btnPrevSentence = document.getElementById('btn-prev-sentence');
    this.btnNextSentence = document.getElementById('btn-next-sentence');
    this.btnPrevPara = document.getElementById('btn-prev-para');
    this.btnNextPara = document.getElementById('btn-next-para');

    this.voiceSelect = document.getElementById('voice-select');
    this.voiceEngineBadge = document.getElementById('voice-engine-badge');
    this.btnSpeed = document.getElementById('btn-speed');
    this.speedLabel = document.getElementById('speed-label');
    
    this.progressTrack = document.getElementById('progress-track');
    this.progressFill = document.getElementById('progress-fill');
    this.playerTimeCurrent = document.getElementById('player-time-current');
    this.playerTimeTotal = document.getElementById('player-time-total');

    this.btnSleepTimer = document.getElementById('btn-sleep-timer');
    this.sleepBadge = document.getElementById('sleep-timer-badge');
    // Modals
    this.modalImport = document.getElementById('modal-import');
    this.modalSettings = document.getElementById('modal-settings');
    this.modalSleep = document.getElementById('modal-sleep');

    // Settings Form Inputs
    this.inputApiKey = document.getElementById('gemini-api-key');
    this.selectStylePrompt = document.getElementById('voice-style-prompt');
    this.btnSaveSettings = document.getElementById('btn-save-settings');

    // Empty State Buttons
    this.btnLoadSample = document.getElementById('btn-load-sample');
    this.btnImportEmpty = document.getElementById('btn-import-empty');

    // Import Tabs & Inputs
    this.dropZone = document.getElementById('drop-zone');
    this.btnBrowseFile = document.getElementById('btn-browse-file');
    this.fileInput = document.getElementById('file-input');
    this.docTitleInput = document.getElementById('doc-title-input');
    this.pasteInput = document.getElementById('paste-input');
    this.btnSubmitImport = document.getElementById('btn-submit-import');

    this.updateVoiceBadge();
  }

  toggleSidebar() {
    const isClosed = this.sidebar.classList.contains('closed');
    if (isClosed) {
      this.openSidebar();
    } else {
      this.closeSidebar();
    }
  }

  openSidebar() {
    this.renderLibrarySidebar();
    this.sidebar.classList.remove('closed');
    if (this.sidebarBackdrop) {
      this.sidebarBackdrop.classList.remove('hidden');
    }
  }

  closeSidebar() {
    this.sidebar.classList.add('closed');
    if (this.sidebarBackdrop) {
      this.sidebarBackdrop.classList.add('hidden');
    }
  }

  updateVoiceBadge() {
    if (!this.voiceEngineBadge) return;

    const selectedVoice = this.voiceSelect.value;
    const isGeminiVoice = this.ttsEngine.isGeminiVoice(selectedVoice);

    if (isGeminiVoice && this.ttsEngine.hasApiKey()) {
      this.voiceEngineBadge.textContent = '✨ Gemini AI Active';
      this.voiceEngineBadge.classList.add('gemini-active');
    } else if (isGeminiVoice && !this.ttsEngine.hasApiKey()) {
      this.voiceEngineBadge.textContent = '⚠️ Key Needed (Tap ⚙️)';
      this.voiceEngineBadge.classList.remove('gemini-active');
    } else {
      this.voiceEngineBadge.textContent = '🌐 Browser Voice';
      this.voiceEngineBadge.classList.remove('gemini-active');
    }
  }

  bindEvents() {
    // Sidebar toggle & backdrop dismiss
    this.btnToggleSidebar.addEventListener('click', () => this.toggleSidebar());
    if (this.btnCloseSidebar) {
      this.btnCloseSidebar.addEventListener('click', () => this.closeSidebar());
    }
    if (this.sidebarBackdrop) {
      this.sidebarBackdrop.addEventListener('click', () => this.closeSidebar());
    }

    // Modal controls
    this.btnImport.addEventListener('click', () => this.showModal(this.modalImport));
    this.btnSettings.addEventListener('click', () => {
      this.inputApiKey.value = this.ttsEngine.apiKey;
      this.selectStylePrompt.value = this.ttsEngine.stylePrompt;
      this.showModal(this.modalSettings);
    });
    this.btnSleepTimer.addEventListener('click', () => this.showModal(this.modalSleep));

    document.querySelectorAll('.modal-close, .modal-backdrop').forEach(el => {
      el.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal');
        if (modal) this.hideModal(modal);
      });
    });

    // Save Settings
    this.btnSaveSettings.addEventListener('click', () => {
      this.ttsEngine.setApiKey(this.inputApiKey.value);
      this.ttsEngine.setStylePrompt(this.selectStylePrompt.value);
      this.updateVoiceBadge();
      this.hideModal(this.modalSettings);

      if (this.pendingExportOnSave) {
        this.pendingExportOnSave = false;
        if (this.ttsEngine.hasApiKey()) {
          this.handleExportAudio();
        }
      }
    });

    const btnForceUpdate = document.getElementById('btn-force-update');
    if (btnForceUpdate) {
      btnForceUpdate.addEventListener('click', () => {
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then(regs => {
            for (let reg of regs) reg.unregister();
          });
        }
        if ('caches' in window) {
          caches.keys().then(names => {
            for (let name of names) caches.delete(name);
          });
        }
        setTimeout(() => {
          window.location.reload(true);
        }, 300);
      });
    }

    // Font Toggle (Serif vs Sans)
    this.btnFontToggle.addEventListener('click', () => {
      document.body.classList.toggle('font-serif');
    });

    // Playback Controls
    this.btnPlayPause.addEventListener('click', () => this.togglePlayPause());
    this.btnNextSentence.addEventListener('click', () => this.skipSentence(1));
    this.btnPrevSentence.addEventListener('click', () => this.skipSentence(-1));
    this.btnNextPara.addEventListener('click', () => this.skipParagraph(1));
    this.btnPrevPara.addEventListener('click', () => this.skipParagraph(-1));

    // Voice Selector
    this.voiceSelect.addEventListener('change', (e) => {
      const selected = e.target.value;
      localStorage.setItem('selected_voice', selected);
      this.player.selectedVoice = selected;
      this.ttsEngine.invalidateCache(); // Flush audio cache & cancel in-flight old voice pre-fetches
      this.updateVoiceBadge();

      if (this.isPlaybackRequested || this.player.isPlaying) {
        this.player.stopCurrent();
        this.startPlayback();
      }
    });

    // Re-sync UI & smooth scroll when screen is unlocked
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.currentDoc) {
        this.updateActiveSentenceUI(this.currentSentenceIndex);
      }
    });

    // Speed Controls (- / + / Click label to reset)
    this.btnSpeedDown = document.getElementById('btn-speed-down');
    this.btnSpeedUp = document.getElementById('btn-speed-up');
    this.btnSpeedLabel = document.getElementById('btn-speed-label');

    if (this.btnSpeedDown) {
      this.btnSpeedDown.addEventListener('click', () => this.changeSpeed(-1));
    }
    if (this.btnSpeedUp) {
      this.btnSpeedUp.addEventListener('click', () => this.changeSpeed(1));
    }
    if (this.btnSpeedLabel) {
      this.btnSpeedLabel.addEventListener('click', () => this.changeSpeed(0));
    }

    // Progress Bar Seeking
    this.progressTrack.addEventListener('click', (e) => {
      if (!this.currentDoc || !this.currentDoc.totalSentences) return;
      const rect = this.progressTrack.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      const targetSentence = Math.floor(pct * this.currentDoc.totalSentences);
      this.jumpToSentence(targetSentence);
    });



    document.querySelectorAll('.sleep-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const minutes = parseInt(e.target.dataset.minutes, 10);
        this.player.startSleepTimer(minutes, () => {
          this.updatePlayPauseUI(false);
        });
        if (minutes > 0) {
          this.sleepBadge.classList.remove('hidden');
        } else {
          this.sleepBadge.classList.add('hidden');
        }
        this.hideModal(this.modalSleep);
      });
    });

    // Empty state handlers
    this.btnLoadSample.addEventListener('click', () => this.loadSampleDoc());
    this.btnImportEmpty.addEventListener('click', () => this.showModal(this.modalImport));
    this.btnNewDoc.addEventListener('click', () => this.showModal(this.modalImport));

    // Tab switching in import modal
    document.querySelectorAll('.import-tabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.import-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        e.target.classList.add('active');
        const tabId = e.target.dataset.tab;
        document.getElementById(tabId).classList.remove('hidden');
      });
    });

    // File Drag & Drop & Direct Native Touch Selection
    if (this.dropZone) {
      this.dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        this.dropZone.classList.add('drag-over');
      });
      this.dropZone.addEventListener('dragleave', () => this.dropZone.classList.remove('drag-over'));
      this.dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        this.dropZone.classList.remove('drag-over');
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
          await this.handleFileImport(e.dataTransfer.files[0]);
        }
      });
    }

    if (this.fileInput) {
      this.fileInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files.length > 0) {
          const file = e.target.files[0];
          await this.handleFileImport(file);
          this.fileInput.value = '';
        }
      });
    }

    this.btnSubmitImport.addEventListener('click', () => {
      const text = this.pasteInput.value;
      const title = this.docTitleInput.value || 'Pasted Article';
      if (text.trim()) {
        this.pausePlayback();
        const parsed = DocumentParser.parseText(text, title);
        this.loadDocument(parsed);
        this.hideModal(this.modalImport);
        this.pasteInput.value = '';
        this.docTitleInput.value = '';
      }
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlayPause();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.skipSentence(1);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this.skipSentence(-1);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        this.skipParagraph(1);
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        this.skipParagraph(-1);
      } else if (e.key === '-' || e.key === '[') {
        e.preventDefault();
        this.changeSpeed(-1);
      } else if (e.key === '=' || e.key === '+' || e.key === ']') {
        e.preventDefault();
        this.changeSpeed(1);
      }
    });
  }

  /**
   * Adjust playback speed step (-1 = decrease, +1 = increase, 0 = reset to 1.0x)
   */
  changeSpeed(delta) {
    if (delta === 0) {
      this.currentSpeedIdx = 2; // Reset to 1.0x (speedRates[2])
    } else if (delta < 0) {
      this.currentSpeedIdx = Math.max(0, this.currentSpeedIdx - 1);
    } else {
      this.currentSpeedIdx = Math.min(this.speedRates.length - 1, this.currentSpeedIdx + 1);
    }

    const rate = this.speedRates[this.currentSpeedIdx];
    if (this.speedLabel) {
      this.speedLabel.textContent = `${rate}x`;
    }
    this.player.setPlaybackRate(rate);
  }

  populateLocalVoices() {
    if ('speechSynthesis' in window) {
      let localVoicesPopulated = false;

      const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        const group = document.getElementById('local-voices-group');
        if (!group || voices.length === 0) return;

        // Only rebuild local voices once to avoid resetting the select on mobile
        if (localVoicesPopulated) return;
        localVoicesPopulated = true;

        const previousSelection = this.voiceSelect ? this.voiceSelect.value : null;

        group.innerHTML = '';
        
        // Strictly filter to English (en) and French (fr) voices only
        const engOrFr = voices.filter(v => {
          const lang = (v.lang || '').toLowerCase().replace('_', '-');
          return lang.startsWith('en') || lang.startsWith('fr');
        });

        // Filter out low-quality "(Compact)" legacy voices if higher quality version exists
        const filtered = engOrFr.filter(v => {
          if (v.name.includes('(Compact)')) {
            const baseName = v.name.replace(' (Compact)', '').trim();
            const hasHigherQuality = engOrFr.some(other => (other.name.includes('Enhanced') || other.name.includes('Premium') || other.name.includes('Natural') || other.name === baseName) && other.name !== v.name);
            return !hasHigherQuality;
          }
          return true;
        });

        // Sort Neural / Natural / Online / Premium / Enhanced high quality voices to the top
        const sorted = [...filtered].sort((a, b) => {
          const aQuality = a.name.includes('Neural') || a.name.includes('Natural') || a.name.includes('Online') || a.name.includes('Enhanced') || a.name.includes('Premium');
          const bQuality = b.name.includes('Neural') || b.name.includes('Natural') || b.name.includes('Online') || b.name.includes('Enhanced') || b.name.includes('Premium');
          if (aQuality && !bQuality) return -1;
          if (!aQuality && bQuality) return 1;
          return a.name.localeCompare(b.name);
        });

        sorted.forEach(v => {
          const opt = document.createElement('option');
          opt.value = v.name;
          const isQuality = v.name.includes('Neural') || v.name.includes('Natural') || v.name.includes('Online') || v.name.includes('Enhanced') || v.name.includes('Premium');
          opt.textContent = `${isQuality ? '✨ HD ' : ''}${v.name} (${v.lang})`;
          group.appendChild(opt);
        });

        // Restore voice selection after populating local voices
        const targetVoice = localStorage.getItem('selected_voice') || previousSelection;
        if (targetVoice && this.voiceSelect) {
          const optionExists = Array.from(this.voiceSelect.options).some(opt => opt.value === targetVoice);
          if (optionExists) {
            this.voiceSelect.value = targetVoice;
            this.player.selectedVoice = targetVoice;
            this.updateVoiceBadge();
          }
        }
      };

      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;

      // Staggered retries for mobile browsers where getVoices() is async
      [150, 500, 1500, 3000].forEach(delay => setTimeout(loadVoices, delay));
    }
  }

  showModal(modal) {
    if (modal === this.modalExport) {
      if (this.exportStatusBanner) {
        this.exportStatusBanner.classList.add('hidden');
      }
      if (this.exportProgressContainer) {
        this.exportProgressContainer.classList.add('hidden');
      }
      if (!this.ttsEngine.hasApiKey()) {
        if (this.exportApiKeyContainer) {
          this.exportApiKeyContainer.classList.remove('hidden');
          this.exportApiKeyInput.value = this.ttsEngine.apiKey || '';
        }
      } else {
        if (this.exportApiKeyContainer) {
          this.exportApiKeyContainer.classList.add('hidden');
        }
      }
    }
    modal.classList.remove('hidden');
  }

  hideModal(modal) {
    modal.classList.add('hidden');
  }

  async handleFileImport(file) {
    const { text, title } = await DocumentParser.readFile(file);
    const parsed = DocumentParser.parseText(text, title);
    if (parsed) {
      this.loadDocument(parsed);
      this.hideModal(this.modalImport);
    }
  }

  loadSampleDoc() {
    const sample = this.library.getSampleDoc();
    const parsed = DocumentParser.parseText(sample.text, sample.title);
    this.loadDocument(parsed);
  }

  loadInitialDoc() {
    const docs = this.library.getAllDocs();
    if (docs && docs.length > 0) {
      const last = docs[0];
      const parsed = DocumentParser.parseText(
        last.paragraphs.map(p => p.text).join('\n\n'),
        last.title
      );
      parsed.id = last.id;
      this.loadDocument(parsed, last.currentSentenceIndex || 0);
    } else {
      this.renderLibrarySidebar();
    }
  }

  loadDocument(parsedDoc, startSentenceIdx = 0, saveToLibrary = true) {
    if (!parsedDoc) return;

    this.currentDoc = parsedDoc;
    this.currentSentenceIndex = startSentenceIdx;

    if (saveToLibrary) {
      this.library.addOrUpdateDoc(parsedDoc);
    }
    this.renderLibrarySidebar();

    this.currentDocTitle.textContent = parsedDoc.title;
    this.emptyState.classList.add('hidden');
    this.readerContent.classList.remove('hidden');

    this.renderReaderDOM(parsedDoc);
    this.jumpToSentence(startSentenceIdx, false);
  }

  unloadCurrentDoc() {
    this.currentDoc = null;
    this.currentSentenceIndex = 0;
    this.currentDocTitle.textContent = 'No Document';
    this.player.stopCurrent();

    this.readerContent.innerHTML = '';
    this.readerContent.classList.add('hidden');
    this.emptyState.classList.remove('hidden');

    this.renderLibrarySidebar();
  }

  /**
   * Renders paragraphs and interactive sentences to DOM
   */
  renderReaderDOM(doc) {
    this.readerContent.innerHTML = '';

    doc.paragraphs.forEach((para) => {
      const pEl = document.createElement('p');
      pEl.className = 'reader-paragraph';
      pEl.id = `para-${para.index}`;

      para.sentences.forEach((sentence) => {
        const sEl = document.createElement('span');
        sEl.className = 'sentence';
        sEl.id = sentence.id;
        sEl.textContent = sentence.text + ' ';

        // Click / Tap to speak sentence immediately
        sEl.addEventListener('click', () => {
          this.jumpToSentence(sentence.index, true);
        });

        pEl.appendChild(sEl);
      });

      this.readerContent.appendChild(pEl);
    });
  }

  renderLibrarySidebar() {
    const docs = this.library.getAllDocs();
    this.libraryList.innerHTML = '';

    if (docs.length === 0) {
      this.libraryList.innerHTML = '<div class="form-help" style="padding: 1rem;">No saved documents yet.</div>';
      return;
    }

    docs.forEach(d => {
      const item = document.createElement('div');
      item.className = `library-item ${this.currentDoc && this.currentDoc.id === d.id ? 'active' : ''}`;
      item.innerHTML = `
        <div class="library-item-content">
          <div class="library-item-title">${d.title}</div>
          <div class="library-item-meta">
            <span>${d.totalSentences || 0} sentences</span>
            <span>${new Date(d.lastReadAt).toLocaleDateString()}</span>
          </div>
        </div>
        <button class="btn-delete-doc" title="Delete Document" style="display: flex; align-items: center; justify-content: center; background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; padding: 0.4rem 0.6rem; color: #ef4444; font-size: 0.9rem; cursor: pointer; flex-shrink: 0;">
          <span style="font-size: 1rem; margin-right: 0.2rem;">🗑️</span> Delete
        </button>
      `;

      item.querySelector('.library-item-content').addEventListener('click', () => {
        const fullParsed = DocumentParser.parseText(
          d.paragraphs.map(p => p.text).join('\n\n'),
          d.title
        );
        fullParsed.id = d.id;
        this.loadDocument(fullParsed, d.currentSentenceIndex || 0);
        this.closeSidebar();
      });

      const btnDelete = item.querySelector('.btn-delete-doc');
      const handleDelete = (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (confirm(`Delete "${d.title}" from library?`)) {
          this.library.deleteDoc(d.id);
          const remainingDocs = this.library.getAllDocs();

          if (remainingDocs.length === 0) {
            this.unloadCurrentDoc();
          } else if (this.currentDoc && this.currentDoc.id === d.id) {
            this.player.stopCurrent();
            const nextDoc = remainingDocs[0];
            const fullParsed = DocumentParser.parseText(
              nextDoc.paragraphs.map(p => p.text).join('\n\n'),
              nextDoc.title
            );
            fullParsed.id = nextDoc.id;
            this.loadDocument(fullParsed, nextDoc.currentSentenceIndex || 0, false);
          } else {
            this.renderLibrarySidebar();
          }
        }
      };

      btnDelete.addEventListener('click', handleDelete);
      btnDelete.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

      this.libraryList.appendChild(item);
    });
  }

  togglePlayPause() {
    if (!this.currentDoc) {
      this.loadSampleDoc();
      return;
    }

    if (this.isPlaybackRequested || this.player.isPlaying) {
      this.pausePlayback();
    } else {
      this.startPlayback();
    }
  }

  pausePlayback() {
    this.isPlaybackRequested = false;
    this.player.stopCurrent();
    this.player.stopBackgroundKeepAlive();
    this.updatePlayPauseUI(false);
  }

  startPlayback() {
    this.player.unlockMobileAudio();
    this.isPlaybackRequested = true;
    this.playSentence(this.currentSentenceIndex);
  }

  jumpToSentence(index, startPlaying = true) {
    if (!this.currentDoc || index < 0 || index >= this.currentDoc.totalSentences) return;

    this.currentSentenceIndex = index;
    this.library.updateProgress(this.currentDoc.id, index);

    this.updateActiveSentenceUI(index);

    if (startPlaying) {
      this.startPlayback();
    } else {
      this.pausePlayback();
    }
  }

  async playSentence(index) {
    if (!this.isPlaybackRequested || !this.currentDoc || index >= this.currentDoc.totalSentences) {
      this.pausePlayback();
      return;
    }

    this.currentSentenceIndex = index;
    const sentenceObj = this.currentDoc.sentences[index];
    this.updateActiveSentenceUI(index);
    this.updatePlayPauseUI(true);

    this.player.startBackgroundKeepAlive();
    this.player.updateMediaSession(
      this.currentDoc.title,
      index,
      this.currentDoc.totalSentences
    );

    // Pre-fetch upcoming sentences for seamless playback
    this.ttsEngine.prefetchUpcoming(
      this.currentDoc.sentences,
      index + 1,
      3,
      this.voiceSelect.value,
      this.player.audioCtx
    );

    try {
      const audioItem = await this.ttsEngine.getSentenceAudio(
        sentenceObj.text,
        this.voiceSelect.value,
        this.player.audioCtx
      );

      // Check if user paused while audio was fetching
      if (!this.isPlaybackRequested) {
        this.player.stopCurrent();
        this.updatePlayPauseUI(false);
        return;
      }

      this.player.playItem(audioItem, () => {
        // Continuous playback: advance to next sentence if still requested
        if (!this.isPlaybackRequested) {
          this.updatePlayPauseUI(false);
          return;
        }

        if (this.currentSentenceIndex + 1 < this.currentDoc.totalSentences) {
          this.playSentence(this.currentSentenceIndex + 1);
        } else {
          this.pausePlayback();
        }
      });
    } catch (err) {
      console.warn('Sentence audio playback error:', err);
      this.pausePlayback();
    }
  }

  skipSentence(delta) {
    if (!this.currentDoc) return;
    const target = this.currentSentenceIndex + delta;
    if (target >= 0 && target < this.currentDoc.totalSentences) {
      this.jumpToSentence(target, this.player.isPlaying);
    }
  }

  skipParagraph(delta) {
    if (!this.currentDoc) return;
    const currentSentence = this.currentDoc.sentences[this.currentSentenceIndex];
    if (!currentSentence) return;

    const targetParaIdx = currentSentence.paragraphIndex + delta;
    if (targetParaIdx >= 0 && targetParaIdx < this.currentDoc.totalParagraphs) {
      const targetPara = this.currentDoc.paragraphs[targetParaIdx];
      if (targetPara && targetPara.sentences.length > 0) {
        this.jumpToSentence(targetPara.sentences[0].index, this.player.isPlaying);
      }
    }
  }

  updateActiveSentenceUI(index) {
    // Clear previous highlight
    document.querySelectorAll('.sentence.active').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.reader-paragraph.current-paragraph').forEach(el => el.classList.remove('current-paragraph'));

    const sentenceObj = this.currentDoc.sentences[index];
    if (!sentenceObj) return;

    const sentenceEl = document.getElementById(sentenceObj.id);
    if (sentenceEl) {
      sentenceEl.classList.add('active');

      const paraEl = document.getElementById(`para-${sentenceObj.paragraphIndex}`);
      if (paraEl) paraEl.classList.add('current-paragraph');

      // Smooth center scrolling only when screen is visible
      if (!document.hidden) {
        sentenceEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    // Update Progress Bar
    const pct = ((index + 1) / this.currentDoc.totalSentences) * 100;
    this.progressFill.style.width = `${pct}%`;
    this.playerTimeCurrent.textContent = `${index + 1}`;
    this.playerTimeTotal.textContent = `${this.currentDoc.totalSentences}`;
  }

  updatePlayPauseUI(isPlaying) {
    if (isPlaying) {
      this.iconPlay.classList.add('hidden');
      this.iconPause.classList.remove('hidden');
    } else {
      this.iconPlay.classList.remove('hidden');
      this.iconPause.classList.add('hidden');
    }
  }




  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js?v=46').then(reg => {
          reg.update();
        }).catch(err => {
          console.warn('SW registration failed:', err);
        });
      });
    }
  }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new GeminiVoiceReaderApp();
});
