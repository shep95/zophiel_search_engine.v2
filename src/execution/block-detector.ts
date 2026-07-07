export type BlockKind =
  | 'none'
  | 'http_403'
  | 'http_429'
  | 'robots_denied'
  | 'captcha_gate'
  | 'shell_redirect'
  | 'empty_shell'
  | 'login_wall';

export interface BlockSignal {
  kind: BlockKind;
  confidence: number;
  signature: string;
  recoverable: boolean;
}

const CAPTCHA_MARKERS = [
  'cf-browser-verification',
  'challenge-platform',
  'turnstile',
  'recaptcha',
  'hcaptcha',
  'uiabshield',
  'gate a tech',
  'ab-shield',
  'captcha',
];

const SHELL_MARKERS = [
  'library and information services',
  'the division of corporations is the state',
  'page not found',
  'access denied',
];

const LOGIN_MARKERS = ['you must log in', 'login_form', 'checkpoint'];

export function detectBlock(input: {
  status: number;
  html: string;
  title: string;
  url: string;
  antiBotSignatures: string[];
  textBlockCount: number;
  bodyTextLength: number;
}): BlockSignal {
  const lower = input.html.toLowerCase();
  const titleLower = input.title.toLowerCase();
  const text = `${titleLower} ${lower}`;

  if (input.status === 403) {
    return { kind: 'http_403', confidence: 0.95, signature: 'HTTP 403', recoverable: true };
  }
  if (input.status === 429) {
    return { kind: 'http_429', confidence: 0.95, signature: 'HTTP 429', recoverable: true };
  }

  if (CAPTCHA_MARKERS.some((m) => text.includes(m))) {
    return { kind: 'captcha_gate', confidence: 0.9, signature: 'captcha/challenge', recoverable: true };
  }

  if (LOGIN_MARKERS.some((m) => text.includes(m)) && input.bodyTextLength < 800) {
    return { kind: 'login_wall', confidence: 0.85, signature: 'login wall', recoverable: false };
  }

  if (isRegistryShell(text, input.bodyTextLength)) {
    return { kind: 'shell_redirect', confidence: 0.85, signature: 'registry nav shell', recoverable: true };
  }

  if (SHELL_MARKERS.filter((m) => text.includes(m)).length >= 2 && input.bodyTextLength < 2500) {
    return { kind: 'shell_redirect', confidence: 0.8, signature: 'boilerplate shell', recoverable: true };
  }

  if (input.textBlockCount < 3 && input.bodyTextLength < 400 && input.antiBotSignatures.length > 0) {
    return { kind: 'empty_shell', confidence: 0.75, signature: 'anti-bot empty shell', recoverable: true };
  }

  return { kind: 'none', confidence: 0, signature: '', recoverable: false };
}

function isRegistryShell(text: string, bodyLength: number): boolean {
  const hasShell =
    text.includes('manage/change existing business') ||
    text.includes('search by entity name') ||
    text.includes('corporate registry');
  const hasRecord =
    text.includes('document number') ||
    text.includes('registered office') ||
    text.includes('principal address') ||
    text.includes('date of birth') ||
    bodyLength > 5000;
  return hasShell && !hasRecord && bodyLength < 4000;
}

export function isMissionUsefulContent(
  body: string,
  title: string,
  url: string,
  subjectTokens: string[] = [],
): boolean {
  const text = `${title}\n${body}`.toLowerCase();
  if (text.length < 80) return false;

  const block = detectBlock({
    status: 200,
    html: body,
    title,
    url,
    antiBotSignatures: [],
    textBlockCount: body.split('\n').filter((l) => l.trim().length > 20).length,
    bodyTextLength: text.length,
  });

  if (block.kind !== 'none') {
    if (block.kind === 'shell_redirect' || block.kind === 'captcha_gate' || block.kind === 'empty_shell') {
      return false;
    }
    if (block.confidence > 0.85 && block.kind !== 'http_403') return false;
  }

  if (subjectTokens.length > 0) {
    const hits = subjectTokens.filter((t) => t.length > 1 && text.includes(t)).length;
    if (hits >= Math.min(2, subjectTokens.length)) return true;
  }

  const signalWords = /profile|directory|officer|director|biography|linkedin|resume|cv|company|address/i;
  return signalWords.test(text) || text.length > 400;
}
