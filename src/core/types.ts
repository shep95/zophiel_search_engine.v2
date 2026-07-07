export type CrawlStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'blocked';

export interface CrawlJob {
  id: string;
  url: string;
  urlHash: string;
  domain: string;
  rootDomain: string;
  depth: number;
  priority: number;
  status: CrawlStatus;
  attempts: number;
  signalScore: number;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string;
  lastError?: string;
}

export interface ExtractedEntity {
  text: string;
  type: 'person' | 'organization' | 'location' | 'product' | 'event' | 'other';
  confidence: number;
}

export interface KeywordCluster {
  theme: string;
  keywords: string[];
  score: number;
}

export interface ContentSegment {
  text: string;
  entropy: number;
  selector?: string;
  isBoilerplate: boolean;
  source?: 'dom' | 'css-pseudo' | 'shadow-dom' | 'js-embedded' | 'meta';
}

export interface CrawlResult {
  jobId: string;
  url: string;
  canonicalUrl: string;
  title: string;
  description?: string;
  correlationId: string;
  crawledAt: string;
  confidence: number;
  freshnessScore: number;
  segments: ContentSegment[];
  keywords: string[];
  entities: ExtractedEntity[];
  clusters: KeywordCluster[];
  links: string[];
  fingerprint: StructuralFingerprint;
  screenshotPath?: string;
  rawTextLength: number;
  cleanedTextLength: number;
}

export interface StructuralFingerprint {
  domain: string;
  version: number;
  domPatterns: string[];
  cssClasses: string[];
  jsLibraries: string[];
  backendStacks: string[];
  primaryLanguage: string;
  renderMode: string;
  antiBotSignatures: string[];
  interactionHints: InteractionHint[];
  updatedAt: string;
}

export interface InteractionHint {
  selector: string;
  action: 'click' | 'scroll' | 'hover';
  successRate: number;
}

export interface SearchDocument {
  id: string;
  url: string;
  title: string;
  snippet: string;
  keywords: string[];
  entities: string[];
  crawledAt: string;
  confidence: number;
  freshnessScore: number;
  body: string;
}

export interface SearchHit {
  document: SearchDocument;
  score: number;
  highlights: string[];
}

export interface SeedRequest {
  urls: string[];
  priority?: number;
  depth?: number;
}

export interface CrawlStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  blocked: number;
  totalIndexed: number;
}

export class GhostChainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable = false,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'GhostChainError';
  }
}
