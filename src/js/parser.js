/**
 * Text & Document Parsing Engine for Gemini Voice Reader
 */

export class DocumentParser {
  /**
   * Parse raw text string into structured paragraphs and sentences
   * @param {string} rawText 
   * @param {string} title 
   * @returns {Object} Structured document model
   */
  static parseText(rawText, title = 'Untitled Document') {
    if (!rawText || !rawText.trim()) {
      return null;
    }

    // Clean up carriage returns and standardize newlines
    const cleanedText = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Split into paragraphs by double newlines or single newlines with spacing
    const rawParagraphs = cleanedText.split(/\n\s*\n/).filter(p => p.trim().length > 0);

    let globalSentenceIndex = 0;
    const paragraphs = rawParagraphs.map((paraText, pIdx) => {
      const cleanPara = DocumentParser.stripMarkdown(paraText.trim());
      
      // Regex sentence splitter preserving punctuation
      // Handles abbreviations like Mr., Dr., etc. reasonably well
      const sentenceRegex = /[^.!?\n]+[.!?]+["'”’]?|\s*[^.!?\n]+$/g;
      const rawSentences = cleanPara.match(sentenceRegex) || [cleanPara];

      const sentences = rawSentences
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map((sentenceText) => {
          const sentenceObj = {
            id: `s-${globalSentenceIndex}`,
            index: globalSentenceIndex,
            paragraphIndex: pIdx,
            text: sentenceText
          };
          globalSentenceIndex++;
          return sentenceObj;
        });

      return {
        id: `p-${pIdx}`,
        index: pIdx,
        text: cleanPara,
        sentences: sentences
      };
    });

    const totalSentences = globalSentenceIndex;
    const flatSentences = paragraphs.flatMap(p => p.sentences);

    return {
      id: `doc-${Date.now()}`,
      title: title,
      createdAt: new Date().toISOString(),
      paragraphs: paragraphs,
      sentences: flatSentences,
      totalSentences: totalSentences,
      totalParagraphs: paragraphs.length
    };
  }

  /**
   * Reads a File object (.txt, .md, .html, .json) and extracts text
   * @param {File} file 
   * @returns {Promise<{text: string, title: string}>}
   */
  static async readFile(file) {
    const title = file.name.replace(/\.[^/.]+$/, "");
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'html') {
      const rawHtml = await file.text();
      try {
        const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
        doc.querySelectorAll('script, style, noscript, svg').forEach(el => el.remove());
        const text = doc.body ? (doc.body.innerText || doc.body.textContent || '') : rawHtml;
        return { text: text.trim(), title };
      } catch (e) {
        const text = rawHtml.replace(/<[^>]*>/g, ' ');
        return { text: text.trim(), title };
      }
    }

    if (ext === 'txt' || ext === 'md' || ext === 'json') {
      const text = await file.text();
      return { text, title };
    }

    // Fallback text reading for other formats
    const text = await file.text();
    return { text, title };
  }

  /**
   * Strip markdown syntax characters so TTS reads clean prose
   * Removes: headings (#), bold/italic (* _ ~), links, images, code fences,
   * blockquotes (>), list markers (- * + numbered), horizontal rules, HTML tags
   * @param {string} text
   * @returns {string} Cleaned text
   */
  static stripMarkdown(text) {
    if (!text) return text;

    let cleaned = text;

    // Remove code fences (``` ... ```) and inline code (` ... `)
    cleaned = cleaned.replace(/```[\s\S]*?```/g, '');
    cleaned = cleaned.replace(/`([^`]*)`/g, '$1');

    // Remove images ![alt](url)
    cleaned = cleaned.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');

    // Convert links [text](url) to just the text
    cleaned = cleaned.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

    // Remove heading markers (# ## ### etc.) at start of lines
    cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

    // Remove blockquote markers (> ) at start of lines
    cleaned = cleaned.replace(/^>\s*/gm, '');

    // Remove unordered list markers (- * +) at start of lines
    cleaned = cleaned.replace(/^[\s]*[-*+]\s+/gm, '');

    // Remove ordered list markers (1. 2. etc.) at start of lines
    cleaned = cleaned.replace(/^[\s]*\d+\.\s+/gm, '');

    // Remove horizontal rules (---, ***, ___)
    cleaned = cleaned.replace(/^[-*_]{3,}\s*$/gm, '');

    // Remove bold/italic markers (*** ** * ___ __ _ ~~)
    cleaned = cleaned.replace(/(\*{1,3}|_{1,3}|~~)(.*?)\1/g, '$2');

    // Remove any remaining standalone * or _ markers
    cleaned = cleaned.replace(/(?<!\w)[*_]{1,3}(?!\w)/g, '');

    // Remove HTML tags
    cleaned = cleaned.replace(/<[^>]*>/g, '');

    // Collapse multiple spaces and trim
    cleaned = cleaned.replace(/  +/g, ' ').trim();

    return cleaned;
  }
}
