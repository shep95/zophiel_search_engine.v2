const PII_PATTERNS: Array<{ type: string; regex: RegExp; replacement: string }> = [
  {
    type: 'email',
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    type: 'phone',
    regex: /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: '[REDACTED_PHONE]',
  },
  {
    type: 'ssn',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[REDACTED_SSN]',
  },
  {
    type: 'credit_card',
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    replacement: '[REDACTED_CARD]',
  },
];

const BOILERPLATE_PATTERNS = [
  /cookie(s)? policy/i,
  /privacy policy/i,
  /terms of (service|use)/i,
  /subscribe to our newsletter/i,
  /all rights reserved/i,
  /skip to (main )?content/i,
];

export function scrubPii(text: string, mode: 'full' | 'sensitive_only' = 'sensitive_only'): string {
  let result = text;
  for (const pattern of PII_PATTERNS) {
    if (mode === 'sensitive_only' && pattern.type === 'phone') continue;
    result = result.replace(pattern.regex, pattern.replacement);
  }
  return result;
}

export function isBoilerplate(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 30) return true;
  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function normalizeText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
