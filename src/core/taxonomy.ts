/**
 * Ghost Chain Taxonomy v2
 *
 * Layer 0 — Configuration & Contracts
 * Layer 1 — Ingress (URL validation, queue, rate limits, robots)
 * Layer 2 — Discovery (query → candidate URLs)          [NEW]
 * Layer 3 — Execution (headless render, interaction)
 * Layer 4 — Distillation (segments, entities, keywords)
 * Layer 5 — Learning (fingerprints, freshness)
 * Layer 6 — Index (FTS storage)
 * Layer 7 — Synthesis (mission-scored intelligence)     [NEW]
 * Layer 8 — Mission Orchestration (end-to-end loop)   [NEW]
 */

export type MissionPhase =
  | 'created'
  | 'discovering'
  | 'crawling'
  | 'indexing'
  | 'synthesizing'
  | 'completed'
  | 'failed';

export type MissionObjective = 'person_lookup' | 'domain_recon' | 'topic_research' | 'general';

export interface ParsedQuery {
  raw: string;
  tokens: string[];
  phrases: string[];
  objective: MissionObjective;
  personTokens: string[];
  locationTokens: string[];
  identity: {
    displayName: string;
    variants: string[];
    /** Name order variants for public-registry style lookups (Last First, First Last, etc.). */
    registryNameVariants: string[];
    middleInitial?: string;
  };
  locationPhrase: string;
}

export interface DiscoveredTarget {
  url: string;
  title: string;
  snippet: string;
  source: 'serp' | 'manual' | 'link_expansion';
  relevanceScore: number;
}

export interface IntelligenceMission {
  id: string;
  query: string;
  parsed: ParsedQuery;
  phase: MissionPhase;
  correlationId: string;
  createdAt: string;
  updatedAt: string;
  discoveredUrls: DiscoveredTarget[];
  crawledUrls: string[];
  error?: string;
}

export interface IntelligenceFinding {
  category: 'identity' | 'location' | 'organization' | 'professional' | 'contact' | 'other';
  claim: string;
  sourceUrl: string;
  confidence: number;
  evidence: string;
}

export interface IntelligenceReport {
  missionId: string;
  query: string;
  generatedAt: string;
  findings: IntelligenceFinding[];
  sources: Array<{ url: string; title: string; confidence: number }>;
  searchHits: number;
  summary: string;
  resolvedIdentity?: {
    canonicalName: string;
    aliases: string[];
    confidence: number;
    linkedMiddleName?: string;
  };
}

export interface PipelineStageResult<T> {
  stage: string;
  durationMs: number;
  output: T;
}

export interface StageTimings {
  ingress: number;
  render: number;
  distill: number;
  learn: number;
  index: number;
}
