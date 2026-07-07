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
  'manage/change existing business',
  'mind your sunbizness',
  'library and information services',
  'the division of corporations is the state',
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

  if (input.url.includes('sunbiz.org') && isSunbizShell(text, input.bodyTextLength)) {
    return { kind: 'shell_redirect', confidence: 0.9, signature: 'sunbiz nav shell', recoverable: true };
  }

  if (SHELL_MARKERS.filter((m) => text.includes(m)).length >= 2 && input.bodyTextLength < 2500) {
    return { kind: 'shell_redirect', confidence: 0.8, signature: 'boilerplate shell', recoverable: true };
  }

  if (input.textBlockCount < 3 && input.bodyTextLength < 400 && input.antiBotSignatures.length > 0) {
    return { kind: 'empty_shell', confidence: 0.75, signature: 'anti-bot empty shell', recoverable: true };
  }

  return { kind: 'none', confidence: 0, signature: '', recoverable: false };
}

function isSunbizShell(text: string, bodyLength: number): boolean {
  const hasShell = text.includes('manage/change existing business') || text.includes('mind your sunbizness');
  const hasEntity =
    text.includes('detail by entity name') ||
    text.includes('document number') ||
    text.includes('registered agent name') ||
    text.includes('newton, asher') ||
    text.includes('zorakcorp');
  return hasShell && !hasEntity && bodyLength < 4000;
}

export function isMissionUsefulContent(body: string, title: string, url: string): boolean {
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
    if (block.kind === 'shell_redirect' || block.kind === 'captcha_gate' || block.kind === 'empty_shell') return false;
    if (block.confidence > 0.85 && block.kind !== 'http_403') return false;
  }

  if (url.includes('sunbiz.org') && isSunbizShell(text, text.length)) return false;

  const personSignals = /newton|asher|zorakcorp|cape coral|registered agent/i.test(text);
  const orgSignals = /llc|document number|principal address|officer/i.test(text);
  const directorySignals = /residents|profile|people named/i.test(text);

  if (url.includes('bisprofiles.com') || url.includes('bizapedia.com')) {
    return personSignals || orgSignals;
  }
  if (url.includes('sunbiz.org')) {
    return orgSignals || personSignals;
  }
  if (url.includes('floridaresidentsdirectory.com')) {
    return directorySignals || personSignals;
  }

  return text.length > 200;
}
