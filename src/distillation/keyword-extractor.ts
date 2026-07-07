import type { ContentSegment } from '../core/types.js';
import { isBoilerplate, normalizeText, scrubPii } from './pii-scrubber.js';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do',
  'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall',
  'this', 'that', 'these', 'those', 'it', 'its', 'as', 'if', 'then', 'than', 'so', 'not',
]);

export function computeEntropy(text: string): number {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0;

  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / tokens.length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

export function extractKeywords(text: string, limit = 20): string[] {
  const tokens = tokenize(text);
  const tf = new Map<string, number>();

  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }

  const scored = Array.from(tf.entries())
    .map(([term, count]) => ({
      term,
      score: count * (1 + Math.log2(term.length)),
    }))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.term);
}

export function buildSegments(
  blocks: Array<{ text: string; selector: string; visible: boolean; prominence?: number; source?: string }>,
  piiMode: 'full' | 'sensitive_only' = 'sensitive_only',
): ContentSegment[] {
  return blocks
    .map((block) => {
      const cleaned = scrubPii(normalizeText(block.text), piiMode);
      const prominence = block.prominence ?? 0.5;
      const fromCssJs = block.source === 'css-pseudo' || block.source === 'js-embedded' || block.source === 'meta';
      return {
        text: cleaned,
        selector: block.selector,
        entropy: computeEntropy(cleaned) * (0.5 + prominence * 0.5) * (fromCssJs ? 1.1 : 1),
        isBoilerplate: isBoilerplate(cleaned) || (!block.visible && !fromCssJs) || prominence < 0.1,
        source: block.source as ContentSegment['source'],
      };
    })
    .filter((s) => s.text.length >= 3);
}

export function distillSignal(segments: ContentSegment[]): {
  body: string;
  keywords: string[];
  snippet: string;
} {
  const signalSegments = segments
    .filter((s) => !s.isBoilerplate)
    .sort((a, b) => b.entropy - a.entropy);

  const body = signalSegments.map((s) => s.text).join('\n\n');
  const keywords = extractKeywords(body);
  const snippet = signalSegments[0]?.text.slice(0, 280) ?? '';

  return { body, keywords, snippet };
}
