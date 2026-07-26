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
      const cleanPara = paraText.trim();
      
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

    if (ext === 'txt' || ext === 'md' || ext === 'json' || ext === 'html') {
      const text = await file.text();
      return { text, title };
    }

    // Fallback text reading for other formats
    const text = await file.text();
    return { text, title };
  }
}
