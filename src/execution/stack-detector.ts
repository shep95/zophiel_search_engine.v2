export type StackLanguage =
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'ruby'
  | 'php'
  | 'java'
  | 'csharp'
  | 'go'
  | 'rust'
  | 'elixir'
  | 'perl'
  | 'unknown';

export type RenderMode = 'server_rendered' | 'hybrid' | 'spa' | 'api_docs';

export interface DetectedStack {
  language: StackLanguage;
  frameworks: string[];
  renderMode: RenderMode;
  confidence: number;
  signals: string[];
}

export interface RenderProfile {
  mode: RenderMode;
  spaWait: boolean;
  spaWaitMs: number;
  mutationQuietMs: number;
  scrollSteps: number;
  interactionSelectors: string[];
  preferStaticParse: boolean;
}

interface StackRule {
  language: StackLanguage;
  framework: string;
  test: (ctx: StackContext) => boolean;
  renderMode: RenderMode;
  weight: number;
}

interface StackContext {
  headers: Record<string, string>;
  html: string;
  cookies: string;
  url: string;
}

const RULES: StackRule[] = [
  // Python
  { language: 'python', framework: 'django', test: (c) => /csrftoken|sessionid|csrfmiddlewaretoken|__admin__/i.test(c.cookies + c.html), renderMode: 'server_rendered', weight: 0.9 },
  { language: 'python', framework: 'django', test: (c) => /django/i.test(c.html.slice(0, 8000)), renderMode: 'server_rendered', weight: 0.7 },
  { language: 'python', framework: 'flask', test: (c) => /werkzeug|flask/i.test(JSON.stringify(c.headers) + c.html.slice(0, 5000)), renderMode: 'server_rendered', weight: 0.85 },
  { language: 'python', framework: 'fastapi', test: (c) => /fastapi|swagger-ui|openapi\.json|redoc/i.test(c.html + c.url), renderMode: 'api_docs', weight: 0.9 },
  { language: 'python', framework: 'uvicorn', test: (c) => /uvicorn/i.test(c.headers['server'] ?? ''), renderMode: 'server_rendered', weight: 0.8 },
  { language: 'python', framework: 'gunicorn', test: (c) => /gunicorn/i.test(c.headers['server'] ?? ''), renderMode: 'server_rendered', weight: 0.8 },
  { language: 'python', framework: 'streamlit', test: (c) => /streamlit|stApp|data-testid="st/i.test(c.html), renderMode: 'hybrid', weight: 0.9 },
  { language: 'python', framework: 'wagtail', test: (c) => /wagtail/i.test(c.html.slice(0, 10000)), renderMode: 'server_rendered', weight: 0.85 },
  { language: 'python', framework: 'pyramid', test: (c) => /pyramid/i.test(c.html.slice(0, 5000)), renderMode: 'server_rendered', weight: 0.7 },
  { language: 'python', framework: 'tornado', test: (c) => /tornado/i.test((c.headers['server'] ?? '') + c.html.slice(0, 3000)), renderMode: 'server_rendered', weight: 0.7 },

  // JavaScript / TypeScript (frontend)
  { language: 'javascript', framework: 'react', test: (c) => /react-dom|data-reactroot|__REACT|react\.production|from ['"]react['"]|id="__next"/i.test(c.html), renderMode: 'spa', weight: 0.85 },
  { language: 'javascript', framework: 'vue', test: (c) => /vue|data-v-|id="__nuxt"/i.test(c.html), renderMode: 'spa', weight: 0.85 },
  { language: 'javascript', framework: 'angular', test: (c) => /ng-version|angular/i.test(c.html), renderMode: 'spa', weight: 0.85 },
  { language: 'javascript', framework: 'nextjs', test: (c) => /__NEXT_DATA__|_next\/static/i.test(c.html), renderMode: 'spa', weight: 0.9 },
  { language: 'typescript', framework: 'nextjs', test: (c) => /__NEXT_DATA__|_next\/static/i.test(c.html), renderMode: 'spa', weight: 0.9 },

  // Node backends
  { language: 'javascript', framework: 'express', test: (c) => /express/i.test((c.headers['x-powered-by'] ?? '') + (c.headers['server'] ?? '')), renderMode: 'server_rendered', weight: 0.75 },
  { language: 'javascript', framework: 'nestjs', test: (c) => /nestjs/i.test(c.html.slice(0, 5000)), renderMode: 'server_rendered', weight: 0.7 },

  // Hybrid (any backend + partial JS)
  { language: 'unknown', framework: 'htmx', test: (c) => /htmx\.org|hx-get|hx-post|hx-trigger/i.test(c.html), renderMode: 'hybrid', weight: 0.85 },
  { language: 'unknown', framework: 'turbo', test: (c) => /turbo-frame|data-turbo|@hotwired\/turbo/i.test(c.html), renderMode: 'hybrid', weight: 0.85 },
  { language: 'unknown', framework: 'alpinejs', test: (c) => /x-data|alpinejs|alpine\.js/i.test(c.html), renderMode: 'hybrid', weight: 0.8 },
  { language: 'unknown', framework: 'jquery', test: (c) => /jquery/i.test(c.html.slice(0, 15000)), renderMode: 'hybrid', weight: 0.5 },

  // Ruby
  { language: 'ruby', framework: 'rails', test: (c) => /rails|csrf-token.*authenticity|action cable|data-turbo/i.test(c.cookies + c.html.slice(0, 10000)), renderMode: 'hybrid', weight: 0.9 },
  { language: 'ruby', framework: 'sinatra', test: (c) => /sinatra/i.test((c.headers['x-powered-by'] ?? '') + c.html.slice(0, 3000)), renderMode: 'server_rendered', weight: 0.75 },

  // PHP
  { language: 'php', framework: 'wordpress', test: (c) => /wp-content|wp-includes|wordpress/i.test(c.html), renderMode: 'server_rendered', weight: 0.9 },
  { language: 'php', framework: 'laravel', test: (c) => /laravel_session|laravel/i.test(c.cookies + c.html.slice(0, 5000)), renderMode: 'server_rendered', weight: 0.85 },
  { language: 'php', framework: 'drupal', test: (c) => /drupal|Drupal\.settings/i.test(c.html), renderMode: 'server_rendered', weight: 0.85 },
  { language: 'php', framework: 'php', test: (c) => /x-powered-by.*php/i.test(JSON.stringify(c.headers)), renderMode: 'server_rendered', weight: 0.8 },

  // Java
  { language: 'java', framework: 'spring', test: (c) => /spring|JSESSIONID|__spring/i.test(c.cookies + c.html.slice(0, 8000)), renderMode: 'server_rendered', weight: 0.85 },
  { language: 'java', framework: 'jsp', test: (c) => /\.jsp|javax\.servlet/i.test(c.url + c.html.slice(0, 5000)), renderMode: 'server_rendered', weight: 0.8 },

  // C# / ASP.NET
  { language: 'csharp', framework: 'aspnet', test: (c) => /__VIEWSTATE|x-aspnet|asp\.net/i.test(c.html + JSON.stringify(c.headers)), renderMode: 'server_rendered', weight: 0.9 },
  { language: 'csharp', framework: 'blazor', test: (c) => /blazor|_framework\/blazor/i.test(c.html), renderMode: 'spa', weight: 0.85 },

  // Go
  { language: 'go', framework: 'go', test: (c) => /\bgo\s|golang|gin-gonic/i.test((c.headers['server'] ?? '') + c.html.slice(0, 3000)), renderMode: 'server_rendered', weight: 0.6 },

  // Rust
  { language: 'rust', framework: 'actix', test: (c) => /actix/i.test(c.headers['server'] ?? ''), renderMode: 'server_rendered', weight: 0.75 },
  { language: 'rust', framework: 'rocket', test: (c) => /rocket/i.test((c.headers['server'] ?? '') + c.html.slice(0, 3000)), renderMode: 'server_rendered', weight: 0.7 },

  // Elixir
  { language: 'elixir', framework: 'phoenix', test: (c) => /data-phx-|phoenix\.js|liveview|csrf-token.*phoenix/i.test(c.html), renderMode: 'hybrid', weight: 0.9 },

  // Perl
  { language: 'perl', framework: 'cgi', test: (c) => /perl|cgi/i.test((c.headers['server'] ?? '') + c.url), renderMode: 'server_rendered', weight: 0.65 },
];

export function detectStack(ctx: StackContext): DetectedStack {
  const matched: Array<{ language: StackLanguage; framework: string; renderMode: RenderMode; weight: number; signal: string }> = [];

  for (const rule of RULES) {
    if (rule.test(ctx)) {
      matched.push({
        language: rule.language,
        framework: rule.framework,
        renderMode: rule.renderMode,
        weight: rule.weight,
        signal: `${rule.language}/${rule.framework}`,
      });
    }
  }

  if (matched.length === 0) {
    const hasHeavyJs = (ctx.html.match(/<script/gi) ?? []).length > 8;
    return {
      language: 'unknown',
      frameworks: [],
      renderMode: hasHeavyJs ? 'spa' : 'server_rendered',
      confidence: 0.4,
      signals: [hasHeavyJs ? 'heuristic:heavy-js' : 'heuristic:static-html'],
    };
  }

  matched.sort((a, b) => b.weight - a.weight);
  const primary = matched[0]!;
  const languages = [...new Set(matched.map((m) => m.language).filter((l) => l !== 'unknown'))];
  const frameworks = [...new Set(matched.map((m) => m.framework))];

  const renderMode = primary.renderMode;

  return {
    language: languages[0] ?? primary.language,
    frameworks,
    renderMode,
    confidence: primary.weight,
    signals: matched.map((m) => m.signal),
  };
}

export function buildRenderProfile(stack: DetectedStack, config: { spaWaitEnabled: boolean; networkIdleTimeoutMs: number; domMutationQuietMs: number }): RenderProfile {
  const base: RenderProfile = {
    mode: stack.renderMode,
    spaWait: config.spaWaitEnabled,
    spaWaitMs: config.networkIdleTimeoutMs,
    mutationQuietMs: config.domMutationQuietMs,
    scrollSteps: 3,
    interactionSelectors: [],
    preferStaticParse: false,
  };

  switch (stack.renderMode) {
    case 'server_rendered':
      return {
        ...base,
        spaWait: false,
        spaWaitMs: 3000,
        mutationQuietMs: 800,
        scrollSteps: 2,
        preferStaticParse: true,
        interactionSelectors: ['details:not([open]) summary'],
      };

    case 'hybrid':
      return {
        ...base,
        spaWait: true,
        spaWaitMs: config.networkIdleTimeoutMs + 3000,
        mutationQuietMs: config.domMutationQuietMs,
        scrollSteps: 4,
        interactionSelectors: [
          '[hx-get]',
          '[data-turbo-frame]',
          '[x-show]',
          'details:not([open]) summary',
          'button:has-text("Load more")',
        ],
      };

    case 'api_docs':
      return {
        ...base,
        spaWait: true,
        spaWaitMs: 8000,
        mutationQuietMs: 1500,
        scrollSteps: 3,
        preferStaticParse: true,
        interactionSelectors: ['.opblock-tag-section', '.try-out__btn', 'button:has-text("Try it out")'],
      };

    case 'spa':
    default:
      return {
        ...base,
        spaWait: config.spaWaitEnabled,
        spaWaitMs: config.networkIdleTimeoutMs + 12000,
        mutationQuietMs: config.domMutationQuietMs,
        scrollSteps: 5,
        interactionSelectors: [
          'button:has-text("Load more")',
          '[aria-expanded="false"]',
          '.tab:not(.active)',
        ],
      };
  }
}

export function normalizeHeaders(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k.toLowerCase()] = v;
  return out;
}
