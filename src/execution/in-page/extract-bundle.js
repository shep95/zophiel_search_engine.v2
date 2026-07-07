(includeHiddenContent) => {
  const isElementVisible = (el) => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) < 0.05) return false;
    if (style.contentVisibility === 'hidden') return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (rect.width <= 0 || rect.height <= 0) return false;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.bottom < -50 || rect.top > vh + 50) return false;
    if (rect.right < -50 || rect.left > vw + 50) return false;
    return true;
  };

  const prominenceOf = (el, style) => {
    const rect = el.getBoundingClientRect();
    const fontSize = parseFloat(style.fontSize) || 14;
    const area = rect.width * rect.height;
    const tagBoost = ['H1', 'H2', 'H3', 'MAIN', 'ARTICLE'].includes(el.tagName) ? 1.5 : 1;
    const weight = parseInt(style.fontWeight, 10);
    const weightBoost = weight >= 600 ? 1.2 : 1;
    return Math.min(1, (fontSize / 24) * tagBoost * weightBoost * Math.min(1, area / 50000));
  };

  const selectorOf = (el) => {
    let sel = el.tagName.toLowerCase();
    if (el.id) sel += '#' + el.id;
    else if (el.classList.length) sel += '.' + el.classList[0];
    return sel;
  };

  const pseudoTexts = [];
  const textBlocks = [];
  const hiddenSelectors = [];
  const fontSizeSamples = [];
  const stylesheetUrls = [];
  let inlineStyleBytes = 0;
  let hiddenRuleCount = 0;

  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.href) stylesheetUrls.push(sheet.href);
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
          const display = rule.style.display;
          const visibility = rule.style.visibility;
          if (display === 'none' || visibility === 'hidden') {
            hiddenRuleCount++;
            if (hiddenSelectors.length < 30) hiddenSelectors.push(rule.selectorText);
          }
        }
      }
    } catch (e) {
      /* cross-origin */
    }
  }

  for (const el of Array.from(document.querySelectorAll('style'))) {
    inlineStyleBytes += (el.textContent || '').length;
  }

  const contentSelectors =
    'main, article, section, p, h1, h2, h3, h4, h5, h6, li, td, th, span, div, [role="main"], [role="article"], label, figcaption';

  const processElement = (el, source = 'dom') => {
    const style = window.getComputedStyle(el);
    const visible = isElementVisible(el);
    if (!visible && !includeHiddenContent) return;

    const fontSize = parseFloat(style.fontSize) || 14;
    if (fontSizeSamples.length < 40) fontSizeSamples.push(fontSize);

    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length >= 15) {
      textBlocks.push({ text, selector: selectorOf(el), visible, prominence: prominenceOf(el, style), source });
    }

    for (const pseudo of ['::before', '::after']) {
      const content = window.getComputedStyle(el, pseudo).content;
      if (!content || content === 'none' || content === 'normal' || content === '""' || content === "''") continue;
      const cleaned = content.replace(/^["']|["']$/g, '').replace(/\\A/g, ' ').trim();
      if (cleaned.length < 2 || cleaned === 'none') continue;
      pseudoTexts.push(cleaned);
      textBlocks.push({
        text: cleaned,
        selector: selectorOf(el) + pseudo,
        visible,
        prominence: prominenceOf(el, style) * 0.8,
        source: 'css-pseudo',
      });
    }
  };

  for (const el of Array.from(document.querySelectorAll(contentSelectors))) {
    processElement(el, 'dom');
    if (textBlocks.length >= 250) break;
  }

  const walkShadow = (root, depth = 0) => {
    if (depth > 4) return;
    const nodes = root instanceof ShadowRoot ? root.querySelectorAll('*') : root.querySelectorAll('*');
    for (const el of Array.from(nodes)) {
      if (el.shadowRoot) walkShadow(el.shadowRoot, depth + 1);
      if (el.matches('p, span, h1, h2, h3, li, td, div')) processElement(el, 'shadow-dom');
    }
  };
  walkShadow(document.body);

  const scriptUrls = [];
  let inlineScriptCount = 0;
  const embeddedPayloads = [];
  const jsonLdBlocks = [];
  const libraries = [];
  const w = window;

  for (const script of Array.from(document.querySelectorAll('script[src]'))) {
    if (script.src) scriptUrls.push(script.src);
  }

  for (const script of Array.from(document.querySelectorAll('script:not([src])'))) {
    inlineScriptCount++;
    const code = (script.textContent || '').trim();
    if (code.length < 20) continue;
    const jsonMatches = code.match(/\{[\s\S]{20,8000}?\}/g) || [];
    for (const chunk of jsonMatches.slice(0, 5)) {
      if (/"[@\w]+"\s*:/.test(chunk)) {
        embeddedPayloads.push({ source: 'inline-script', preview: chunk.slice(0, 500) });
      }
    }
  }

  for (const node of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    const raw = (node.textContent || '').trim();
    if (raw) jsonLdBlocks.push(raw.slice(0, 4000));
  }

  const globalKeys = ['__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__APOLLO_STATE__', '__remixContext'];
  for (const key of globalKeys) {
    if (w[key]) {
      try {
        embeddedPayloads.push({ source: key, preview: JSON.stringify(w[key]).slice(0, 8000) });
      } catch (e) {
        embeddedPayloads.push({ source: key, preview: String(w[key]).slice(0, 500) });
      }
    }
  }

  if (w.jQuery || w.$) libraries.push('jquery');
  if (w.React) libraries.push('react');
  if (w.Vue) libraries.push('vue');
  if (w.angular) libraries.push('angular');
  if (w.__NEXT_DATA__) libraries.push('nextjs');
  if (document.querySelector('[data-reactroot], [data-reactid], #__next')) libraries.push('react');
  if (document.querySelector('#app[data-v-], [data-v-app]')) libraries.push('vue');
  if (document.querySelector('#__nuxt')) libraries.push('nuxt');

  // Backend / multi-language stack markers (from HTML/headers rendered in page)
  const htmlLower = document.documentElement.outerHTML.slice(0, 50000).toLowerCase();
  if (/csrfmiddlewaretoken|django|__admin__/.test(htmlLower)) libraries.push('django');
  if (/werkzeug|flask/.test(htmlLower)) libraries.push('flask');
  if (/swagger-ui|fastapi|redoc|openapi\.json/.test(htmlLower)) libraries.push('fastapi');
  if (/streamlit|stapp/.test(htmlLower)) libraries.push('streamlit');
  if (/wagtail/.test(htmlLower)) libraries.push('wagtail');
  if (/htmx\.org|hx-get|hx-post/.test(htmlLower)) libraries.push('htmx');
  if (/data-turbo|turbo-frame|hotwired/.test(htmlLower)) libraries.push('turbo');
  if (/x-data|alpinejs/.test(htmlLower)) libraries.push('alpinejs');
  if (/wp-content|wordpress/.test(htmlLower)) libraries.push('wordpress');
  if (/laravel/.test(htmlLower)) libraries.push('laravel');
  if (/drupal/.test(htmlLower)) libraries.push('drupal');
  if (/rails|action cable|authenticity_token/.test(htmlLower)) libraries.push('rails');
  if (/__viewstate|asp\.net|blazor/.test(htmlLower)) libraries.push('aspnet');
  if (/jsessionid|spring/.test(htmlLower)) libraries.push('spring');
  if (/data-phx|phoenix/.test(htmlLower)) libraries.push('phoenix');

  const isSpa = ['react', 'vue', 'angular', 'nextjs', 'nuxt', 'blazor'].some((l) => libraries.includes(l))
    || (scriptUrls.length > 8 && !['django', 'flask', 'rails', 'wordpress'].some((l) => libraries.includes(l)));

  for (const meta of Array.from(document.querySelectorAll('meta[name], meta[property]'))) {
    const name = meta.getAttribute('name') || meta.getAttribute('property') || '';
    const content = meta.getAttribute('content') || '';
    if (!content || content.length < 5) continue;
    if (/description|title|og:|twitter:/i.test(name)) {
      textBlocks.push({ text: content, selector: 'meta[' + name + ']', visible: true, prominence: 0.7, source: 'meta' });
    }
  }

  const links = Array.from(document.querySelectorAll('a[href]'))
    .map((a) => a.href)
    .filter(Boolean);

  return {
    textBlocks: textBlocks.slice(0, 300),
    css: {
      stylesheetUrls: [...new Set(stylesheetUrls)].slice(0, 50),
      inlineStyleBytes,
      hiddenRuleCount,
      hiddenSelectors: hiddenSelectors.slice(0, 30),
      pseudoTexts: [...new Set(pseudoTexts)].slice(0, 40),
      fontSizeSamples,
    },
    js: {
      scriptUrls: [...new Set(scriptUrls)].slice(0, 60),
      inlineScriptCount,
      libraries: [...new Set(libraries)],
      embeddedPayloads: embeddedPayloads.slice(0, 15),
      jsonLdBlocks: jsonLdBlocks.slice(0, 10),
      isSpa,
    },
    links: [...new Set(links)],
  };
}
