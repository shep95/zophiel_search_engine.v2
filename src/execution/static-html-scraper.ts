import * as cheerio from 'cheerio';
import type { TextBlock } from './browser-sandbox.js';

const SSR_SELECTORS = [
  'main',
  'article',
  '[role="main"]',
  '.content',
  '#content',
  '.post',
  '.entry-content',
  'table',
  'dl',
  'pre',
  'code',
];

export function parseStaticHtml(html: string, url: string): {
  title: string;
  textBlocks: TextBlock[];
  links: string[];
} {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim() || url;
  const textBlocks: TextBlock[] = [];
  const links: string[] = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      try {
        links.push(new URL(href, url).toString());
      } catch {
        // skip
      }
    }
  });

  for (const sel of SSR_SELECTORS) {
    $(sel).each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text.length < 20) return;
      const tag = String($(el).prop('tagName') ?? sel).toLowerCase();
      const id = $(el).attr('id');
      const cls = $(el).attr('class')?.split(/\s+/)[0];
      let selector = tag;
      if (id) selector += `#${id}`;
      else if (cls) selector += `.${cls}`;

      textBlocks.push({
        text,
        selector,
        visible: true,
        prominence: tag.startsWith('h') ? 0.85 : 0.65,
        source: 'dom',
      });
    });
  }

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html()?.trim();
    if (raw && raw.length > 20) {
      textBlocks.push({
        text: raw.slice(0, 4000),
        selector: 'script[type="application/ld+json"]',
        visible: true,
        prominence: 0.75,
        source: 'js-embedded',
      });
    }
  });

  $('meta[name="description"], meta[property="og:description"]').each((_, el) => {
    const content = $(el).attr('content')?.trim();
    if (content && content.length > 10) {
      textBlocks.push({
        text: content,
        selector: 'meta[description]',
        visible: true,
        prominence: 0.7,
        source: 'meta',
      });
    }
  });

  return {
    title,
    textBlocks: dedupeBlocks(textBlocks).slice(0, 200),
    links: [...new Set(links)],
  };
}

function dedupeBlocks(blocks: TextBlock[]): TextBlock[] {
  const seen = new Set<string>();
  return blocks.filter((b) => {
    const key = b.text.slice(0, 120);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
