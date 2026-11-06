/**
 * Tokenizer & Analyzer Engine
 * High-precision multilingual token estimation for OpenAI (o200k/cl100k),
 * Anthropic Claude, and Google Gemini, plus live Gemini API countTokens support.
 */

class TokenizerEngine {
  constructor() {
    this.geminiApiKey = localStorage.getItem('llm_gemini_api_key') || '';
    this.openaiApiKey = localStorage.getItem('llm_openai_api_key') || '';
    this.claudeApiKey = localStorage.getItem('llm_claude_api_key') || '';
  }

  /**
   * Analyze raw text characteristics
   */
  analyzeText(text) {
    if (!text || text.length === 0) {
      return {
        charsTotal: 0,
        charsNoSpaces: 0,
        words: 0,
        lines: 0,
        hangulCount: 0,
        cjkCount: 0,
        latinCount: 0,
        digitCount: 0,
        punctCount: 0,
        spaceCount: 0,
      };
    }

    const charsTotal = text.length;
    const charsNoSpaces = text.replace(/\s/g, '').length;
    const words = (text.trim().match(/\S+/g) || []).length;
    const lines = text.split(/\r\n|\r|\n/).length;

    // Detailed character breakdowns
    const hangulMatches = text.match(/[\uac00-\ud7a3\u3131-\u318e\u1100-\u11ff]/g);
    const hangulCount = hangulMatches ? hangulMatches.length : 0;

    const cjkMatches = text.match(/[\u4e00-\u9fff\u3040-\u30ff]/g);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;

    const latinMatches = text.match(/[a-zA-Z]/g);
    const latinCount = latinMatches ? latinMatches.length : 0;

    const digitMatches = text.match(/[0-9]/g);
    const digitCount = digitMatches ? digitMatches.length : 0;

    const spaceMatches = text.match(/\s/g);
    const spaceCount = spaceMatches ? spaceMatches.length : 0;

    const punctCount = charsTotal - (hangulCount + cjkCount + latinCount + digitCount + spaceCount);

    return {
      charsTotal,
      charsNoSpaces,
      words,
      lines,
      hangulCount,
      cjkCount,
      latinCount,
      digitCount,
      punctCount: Math.max(0, punctCount),
      spaceCount,
    };
  }

  /**
   * Estimate token count for a specific provider
   * @param {string} text
   * @param {string} provider 'gemini' | 'claude' | 'openai'
   * @param {string} modelId
   */
  estimateTokens(text, provider = 'openai', modelId = '') {
    if (!text || text.trim().length === 0) return 0;

    const stats = this.analyzeText(text);

    let tokens = 0;

    if (provider === 'gemini') {
      // Gemini: SentencePiece 256k vocabulary
      // Very high compression efficiency on Korean and multilingual text
      const hangulTokens = stats.hangulCount * 1.22;
      const cjkTokens = stats.cjkCount * 1.35;
      const latinTokens = stats.latinCount * 0.28; // ~3.6 chars per token
      const digitTokens = stats.digitCount * 0.75;
      const punctTokens = stats.punctCount * 0.95;
      const spaceTokens = Math.ceil(stats.spaceCount * 0.35);

      tokens = Math.ceil(hangulTokens + cjkTokens + latinTokens + digitTokens + punctTokens + spaceTokens);
    } else if (provider === 'claude') {
      // Claude (3.5 Sonnet / Haiku): ~65k-100k BPE vocab
      // Good Korean representation, slightly different word boundaries
      const hangulTokens = stats.hangulCount * 1.38;
      const cjkTokens = stats.cjkCount * 1.45;
      const latinTokens = stats.latinCount * 0.29; // ~3.45 chars per token
      const digitTokens = stats.digitCount * 0.85;
      const punctTokens = stats.punctCount * 1.05;
      const spaceTokens = Math.ceil(stats.spaceCount * 0.40);

      tokens = Math.ceil(hangulTokens + cjkTokens + latinTokens + digitTokens + punctTokens + spaceTokens);
    } else {
      // OpenAI ChatGPT
      const isO200k = !modelId.includes('gpt-4-turbo') && !modelId.includes('gpt-3.5');
      if (isO200k) {
        // o200k_base (GPT-4o, GPT-4o-mini, o1, o3-mini)
        // Significantly improved Korean efficiency compared to old cl100k
        const hangulTokens = stats.hangulCount * 1.42;
        const cjkTokens = stats.cjkCount * 1.48;
        const latinTokens = stats.latinCount * 0.28;
        const digitTokens = stats.digitCount * 0.70;
        const punctTokens = stats.punctCount * 1.00;
        const spaceTokens = Math.ceil(stats.spaceCount * 0.38);

        tokens = Math.ceil(hangulTokens + cjkTokens + latinTokens + digitTokens + punctTokens + spaceTokens);
      } else {
        // cl100k_base (Legacy models)
        const hangulTokens = stats.hangulCount * 2.25;
        const cjkTokens = stats.cjkCount * 2.10;
        const latinTokens = stats.latinCount * 0.29;
        const digitTokens = stats.digitCount * 0.80;
        const punctTokens = stats.punctCount * 1.10;
        const spaceTokens = Math.ceil(stats.spaceCount * 0.45);

        tokens = Math.ceil(hangulTokens + cjkTokens + latinTokens + digitTokens + punctTokens + spaceTokens);
      }
    }

    // Minimum 1 token for non-empty text
    return Math.max(1, tokens);
  }

  /**
   * Live Gemini countTokens API query (if API key provided)
   */
  async fetchLiveGeminiTokens(text, model = 'gemini-1.5-flash') {
    const apiKey = this.geminiApiKey || localStorage.getItem('llm_gemini_api_key');
    if (!apiKey) return null;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:countTokens?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: text }] }]
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      return data.totalTokens;
    } catch (err) {
      console.warn('Gemini live token count failed:', err);
      return null;
    }
  }

  /**
   * Optimize and compact text to reduce token footprint
   */
  optimizePrompt(text) {
    if (!text) return { original: '', optimized: '', diffTokens: 0, percentSaved: 0 };

    let cleaned = text;

    // 1. Normalize line breaks to \n
    cleaned = cleaned.replace(/\r\n/g, '\n');

    // 2. Remove trailing spaces from each line
    cleaned = cleaned.replace(/[ \t]+$/gm, '');

    // 3. Collapse 3 or more consecutive newlines into 2
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // 4. Collapse multiple spaces (except indentation at start of lines)
    cleaned = cleaned.split('\n').map(line => {
      const leadingSpaceMatch = line.match(/^([ \t]+)/);
      const leading = leadingSpaceMatch ? leadingSpaceMatch[1] : '';
      const rest = line.substring(leading.length);
      return leading + rest.replace(/[ \t]{2,}/g, ' ');
    }).join('\n');

    // 5. Trim leading and trailing whitespace
    cleaned = cleaned.trim();

    return cleaned;
  }
}

// Global instance
window.tokenizerEngine = new TokenizerEngine();
