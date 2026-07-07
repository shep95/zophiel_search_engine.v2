import assert from 'node:assert/strict';
import {
  buildFtsFromParsed,
  matchesUrlOperators,
  parseSearchQuery,
} from '../src/search/query-operators.js';

const parsed = parseSearchQuery('site:github.com intitle:react typescript hooks');
assert.deepEqual(parsed.operators.site, ['github.com']);
assert.deepEqual(parsed.operators.intitle, ['react']);
assert.equal(parsed.freeText, 'typescript hooks');

const fts = buildFtsFromParsed(parsed, 'or');
assert.match(fts!, /title:"react"\*/);
assert.match(fts!, /"typescript"\*/);

assert.equal(
  matchesUrlOperators('https://www.github.com/facebook/react', { site: ['github.com'], filetype: [], inurl: [], intitle: [] }),
  true,
);
assert.equal(
  matchesUrlOperators('https://gitlab.com/foo', { site: ['github.com'], filetype: [], inurl: [], intitle: [] }),
  false,
);
assert.equal(
  matchesUrlOperators('https://example.com/docs/guide.pdf', { site: [], filetype: ['pdf'], inurl: [], intitle: [] }),
  true,
);
assert.equal(
  matchesUrlOperators('https://example.com/blog?id=report.pdf', { site: [], filetype: ['pdf'], inurl: [], intitle: [] }),
  false,
);
assert.equal(
  matchesUrlOperators('https://example.com/api/v1/users', { site: [], filetype: [], inurl: ['api'], intitle: [] }),
  true,
);

const quoted = parseSearchQuery('intitle:"annual report" filetype:pdf site:sec.gov');
assert.deepEqual(quoted.operators.intitle, ['annual report']);
assert.deepEqual(quoted.operators.filetype, ['pdf']);
assert.equal(quoted.freeText, '');

console.log('query-operators: all assertions passed');
