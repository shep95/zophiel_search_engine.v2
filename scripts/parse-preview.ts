import { parseQuery } from '../src/discovery/query-parser.js';
import { parseSearchQuery } from '../src/search/query-operators.js';

const queries = [
  'who is asher shepherd newton in cape coral florida',
  'who is Jan Fang who improve public and personal health',
];

for (const q of queries) {
  const p = parseQuery(parseSearchQuery(q).freeText || q);
  console.log('---', q);
  console.log(
    JSON.stringify(
      {
        displayName: p.identity.displayName,
        personTokens: p.personTokens,
        locationTokens: p.locationTokens,
        locationPhrase: p.locationPhrase,
        objective: p.objective,
      },
      null,
      2,
    ),
  );
}
