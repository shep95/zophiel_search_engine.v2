import type { IntelligenceFinding, ParsedQuery } from '../core/taxonomy.js';
import { buildPersonPatterns, textMatchesSubject } from './subject-match.js';

export interface ResolvedPerson {
  canonicalName: string;
  aliases: string[];
  confidence: number;
  linkedMiddleName?: string;
}

export class IdentityResolver {
  resolve(parsed: ParsedQuery, rawFindings: string[]): ResolvedPerson {
    const aliases = new Set<string>(parsed.identity.variants);

    for (const text of rawFindings) {
      if (!textMatchesSubject(text, parsed)) continue;

      for (const pattern of buildPersonPatterns(parsed)) {
        for (const match of text.match(pattern) ?? []) {
          aliases.add(normalizeName(match));
        }
      }
    }

    const canonical = parsed.identity.displayName || 'Unknown';
    const corpusHits = rawFindings.filter((t) => textMatchesSubject(t, parsed)).length;
    const confidence = Math.min(0.95, 0.55 + corpusHits * 0.08 + aliases.size * 0.03);

    return {
      canonicalName: canonical,
      aliases: [...aliases],
      confidence,
      linkedMiddleName:
        parsed.personTokens.length > 2 ? parsed.personTokens[1] : undefined,
    };
  }

  enrichFindings(person: ResolvedPerson, existing: IntelligenceFinding[]): IntelligenceFinding[] {
    const findings = [...existing];
    const sourceUrl = existing.find((f) => f.sourceUrl)?.sourceUrl ?? '';

    findings.push({
      category: 'identity',
      claim: `Canonical identity: ${person.canonicalName} (aliases: ${person.aliases.slice(0, 5).join(', ')})`,
      sourceUrl,
      confidence: person.confidence,
      evidence: 'Identity resolution across indexed crawl corpus',
    });

    if (person.linkedMiddleName) {
      findings.push({
        category: 'identity',
        claim: `Middle name on record: ${person.linkedMiddleName}`,
        sourceUrl,
        confidence: 0.75,
        evidence: 'Parsed from multi-token query name',
      });
    }

    return dedupeFindings(findings);
  }
}

function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function dedupeFindings(findings: IntelligenceFinding[]): IntelligenceFinding[] {
  const seen = new Set<string>();
  return findings
    .filter((f) => {
      const key = `${f.category}:${f.claim.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence);
}
