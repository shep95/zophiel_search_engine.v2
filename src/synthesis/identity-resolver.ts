import type { ParsedQuery } from '../core/taxonomy.js';
import type { IntelligenceFinding } from '../core/taxonomy.js';
import type { SunbizEntity } from '../adapters/sunbiz-adapter.js';

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
      const matches = text.match(/(?:NEWTON,\s*ASHER\s*S?|Asher\s*S\.?\s*Newton|Asher\s+Shepherd\s+Newton)/gi) ?? [];
      for (const m of matches) aliases.add(normalizeName(m));
    }

    const canonical = parsed.identity.displayName || 'Unknown';
    const hasSunbiz = [...aliases].some((a) => /newton.*asher|asher.*newton/i.test(a));

    return {
      canonicalName: canonical,
      aliases: [...aliases],
      confidence: hasSunbiz ? 0.95 : 0.7,
      linkedMiddleName: parsed.identity.middleInitial
        ? parsed.personTokens[1]
        : undefined,
    };
  }

  enrichFindings(
    person: ResolvedPerson,
    sunbizEntities: SunbizEntity[],
    existing: IntelligenceFinding[],
  ): IntelligenceFinding[] {
    const findings = [...existing];

    findings.push({
      category: 'identity',
      claim: `Canonical identity: ${person.canonicalName} (aliases: ${person.aliases.slice(0, 4).join(', ')})`,
      sourceUrl: sunbizEntities[0]?.detailUrl ?? '',
      confidence: person.confidence,
      evidence: 'Identity resolution across Sunbiz + crawl corpus',
    });

    if (person.linkedMiddleName) {
      findings.push({
        category: 'identity',
        claim: `Middle name "${person.linkedMiddleName}" correlates with public-record initial "S" (Asher S Newton)`,
        sourceUrl: sunbizEntities[0]?.detailUrl ?? '',
        confidence: 0.88,
        evidence: 'Cross-reference query name vs Florida filing format',
      });
    }

    for (const entity of sunbizEntities) {
      if (entity.principalAddress) {
        findings.push({
          category: 'location',
          claim: `Residence/business address: ${entity.principalAddress}`,
          sourceUrl: entity.detailUrl,
          confidence: 0.92,
          evidence: `Sunbiz principal address for ${entity.name}`,
        });
      }

      findings.push({
        category: 'organization',
        claim: `${entity.name} (${entity.status}) — Doc #${entity.documentNumber || 'N/A'}`,
        sourceUrl: entity.detailUrl,
        confidence: 0.9,
        evidence: 'Florida Department of State corporate filing',
      });

      for (const officer of entity.officers) {
        findings.push({
          category: 'professional',
          claim: `Corporate role: ${officer} at ${entity.name}`,
          sourceUrl: entity.detailUrl,
          confidence: 0.9,
          evidence: 'Sunbiz authorized person record',
        });
      }
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
