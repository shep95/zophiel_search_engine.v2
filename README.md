<div align="center">

# Zophiel Search Engine v2

### Ghost Chain Protocol — Universal Intelligence Crawler & Custom Search

[![Node.js](https://img.shields.io/badge/Node.js-≥20-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Playwright](https://img.shields.io/badge/Playwright-Chromium-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)](https://playwright.dev/)
[![SQLite FTS5](https://img.shields.io/badge/Search-SQLite%20FTS5-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/fts5.html)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

**Stack-aware rendering · Multi-language site support · Identity synthesis · Production-grade crawl pipeline**

[Quick Start](#-quick-start) · [Architecture](#-architecture) · [Investigate Mode](#-investigate-mode) · [Stack Detection](#-universal-stack-detection) · [API](#-api)

</div>

---

## Overview

**Zophiel v2** is a TypeScript search engine and intelligence crawler that goes beyond link ranking. It discovers targets from natural-language queries, renders pages across **any web stack** (Python/Django, Ruby/Rails, PHP/WordPress, ASP.NET, React SPAs, HTMX hybrids), distills structured findings, and synthesizes identity-linked reports.

Where traditional search engines return ten blue links, Zophiel returns **resolved identity, corporate filings, addresses, and cross-source evidence** — assembled from public records the index never connects for you.

```mermaid
flowchart LR
    subgraph Input
        Q["Natural language query"]
    end

    subgraph GhostChain["Ghost Chain Protocol"]
        I["① Ingress"]
        E["② Execution"]
        D["③ Distillation"]
        L["④ Learning"]
        O["⑤ Output"]
    end

    subgraph Artifacts
        R["Intelligence Report"]
        S["SQLite FTS5 Index"]
        M["Immune Memory"]
    end

    Q --> I --> E --> D --> L --> O
    O --> R
    O --> S
    L --> M
```

---

## Architecture

Five-phase pipeline inspired by the Ghost Chain Protocol — each phase is independently observable, retryable, and mission-scoped.

```mermaid
flowchart TB
    subgraph Discovery["Discovery Layer"]
        QP[Query Parser]
        SERP[SERP Discovery]
        SB[Sunbiz Adapter]
        QP --> SERP
        QP --> SB
    end

    subgraph Ingress["① Ingress"]
        UV[URL Validator / SSRF Guard]
        RBT[Robots.txt]
        RL[Rate Limiter]
        CQ[Crawl Queue]
        UV --> RBT --> RL --> CQ
    end

    subgraph Execution["② Execution"]
        SD[Stack Detector]
        BS[Browser Sandbox<br/>Playwright Chromium]
        SH[Static HTML Scraper<br/>Cheerio SSR path]
        CSS[CSS Scraper]
        JS[JS / SPA Scraper]
        SW[Stack Wait<br/>HTMX · Turbo · Swagger]
        SD --> BS
        SD --> SH
        BS --> CSS
        BS --> JS
        BS --> SW
    end

    subgraph Distillation["③ Distillation"]
        KE[Keyword Extractor]
        EE[Entity Extractor]
        PS[PII Scrubber]
        KE --> EE --> PS
    end

    subgraph Learning["④ Learning"]
        IM[Immune Memory<br/>domain fingerprints]
        FT[Freshness Tracker]
    end

    subgraph Output["⑤ Output"]
        IDX[FTS5 Search Index]
        IR[Identity Resolver]
        SYN[Intelligence Synthesis]
        DQ[Durable Output Queue]
        IDX --> IR --> SYN --> DQ
    end

    Discovery --> Ingress --> Execution --> Distillation --> Learning --> Output
```

### Mission orchestrator flow

```mermaid
sequenceDiagram
    actor User
    participant CLI
    participant Mission as Mission Orchestrator
    participant Disc as Discovery
    participant Crawl as Crawler Workers
    participant Synth as Synthesis
    participant Out as Durable Queue

    User->>CLI: investigate "person + location"
    CLI->>Mission: run(query)
    Mission->>Disc: SERP + Sunbiz + curated seeds
    Disc-->>Mission: 12 ranked targets
    Mission->>Crawl: enqueue mission URLs
    loop Each target
        Crawl->>Crawl: detect stack → adapt render → extract
        Crawl->>Crawl: index + immune memory update
    end
    Crawl-->>Mission: crawl complete
    Mission->>Synth: identity resolve + report
    Synth-->>Out: JSON report + metrics
    Out-->>User: findings + sources
```

---

## Universal stack detection

Zophiel does not execute Python, Ruby, or PHP — it **detects the stack** and adapts rendering strategy automatically.

```mermaid
flowchart TD
    START[HTTP Response] --> DET{Stack Detector}
    DET -->|Django Flask Rails WordPress| SSR["server_rendered<br/>Cheerio fast path + light browser"]
    DET -->|HTMX Turbo Alpine| HYB["hybrid<br/>DOM settle + partial JS wait"]
    DET -->|React Vue Next Blazor| SPA["spa<br/>network idle + mutation stability"]
    DET -->|FastAPI Swagger ReDoc| API["api_docs<br/>OpenAPI UI wait"]

    SSR --> MERGE[Merge text blocks]
    HYB --> MERGE
    SPA --> MERGE
    API --> MERGE
    MERGE --> OUT[RenderedPage + stackIntel]
```

| Language | Frameworks detected | Render mode |
|----------|---------------------|-------------|
| **Python** | Django, Flask, FastAPI, Streamlit, Wagtail, Gunicorn, Uvicorn | SSR / hybrid / API docs |
| **JavaScript/TS** | React, Vue, Angular, Next.js, Express, NestJS | SPA / SSR |
| **Ruby** | Rails, Sinatra | Hybrid / SSR |
| **PHP** | WordPress, Laravel, Drupal | SSR |
| **C#** | ASP.NET, Blazor | SSR / SPA |
| **Java** | Spring, JSP | SSR |
| **Go · Rust · Elixir · Perl** | Gin, Rocket, Phoenix, CGI | SSR / hybrid |
| **Hybrid libs** | HTMX, Turbo, Alpine.js, jQuery | Hybrid |

---

## Investigate mode

One command runs the full intelligence pipeline:

```bash
npm run investigate -- "asher shepherd newton who lives in cape coral florida"
```

```mermaid
flowchart LR
    subgraph Findings["Example synthesized output"]
        F1["Identity: Asher Shepherd Newton"]
        F2["Alias: Asher S Newton / NEWTON, ASHER S"]
        F3["Org: ZORAKCORP LLC"]
        F4["Location: 2004 SW 23rd Ct, Cape Coral FL"]
        F5["Link: middle name Shepherd = initial S"]
    end

    Q2[Query] --> P[Parse person + location]
    P --> C[Cross-source crawl]
    C --> F1
    C --> F2
    C --> F3
    C --> F4
    C --> F5
```

**What Zophiel finds that generic search often misses:**

- Corporate registered-agent address linked to a person query (via [bisprofiles](https://bisprofiles.com) + Sunbiz cross-reference)
- Middle-name ↔ public-record initial resolution (`Shepherd` → `S`)
- Florida LLC entity graph (ZORAKCORP, BOSLEY.SOCIAL)
- Sunbiz name-search traps (full name matches wrong entities — surfaced as negative intelligence)

Reports are saved to `data/reports/<mission-id>.json` with stage timings and at-least-once delivery guarantees.

---

## Quick start

### Prerequisites

- **Node.js ≥ 20**
- **Chromium** (via Playwright)

### Install

```bash
git clone https://github.com/shep95/zophiel_search_engine.v2.git
cd zophiel_search_engine.v2
npm install
npm run playwright:install
npm run build
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run investigate -- "<query>"` | Full discovery → crawl → intelligence report |
| `npm run crawl` | Start persistent crawler workers |
| `npm run seed -- <url> [url...]` | Enqueue seed URLs |
| `npm run search -- "<query>"` | Search the local FTS5 index |
| `npm run api` | Start REST API on `:3847` |
| `npm run dev` | Watch mode for CLI development |

### Example session

```bash
# Run an intelligence mission
npm run investigate -- "company name officer florida"

# Search indexed corpus
npm run search -- "registered agent cape coral"

# Crawl specific targets
npm run seed -- https://example.com
npm run crawl
```

---

## Project structure

```
zophiel_search_engine.v2/
├── src/
│   ├── ingress/          # URL validation, robots, rate limits, queue
│   ├── execution/        # Browser sandbox, stack detection, CSS/JS scrapers
│   ├── discovery/        # Query parser, SERP discovery
│   ├── adapters/         # Sunbiz and domain-specific adapters
│   ├── distillation/     # Keywords, entities, PII scrubbing
│   ├── learning/         # Immune memory (per-domain fingerprints)
│   ├── search/           # SQLite FTS5 index
│   ├── synthesis/        # Identity resolver + intelligence reports
│   ├── mission/          # Mission orchestrator
│   ├── observability/    # Stage metrics
│   ├── output/           # Durable JSONL queue
│   └── cli.ts            # CLI entry point
├── scripts/              # Test and utility scripts
└── data/                 # Runtime DB, reports (gitignored)
```

---

## Execution layer detail

```mermaid
graph TB
    subgraph Browser["Playwright Chromium"]
        GOTO[page.goto]
        HDR[Capture headers + cookies]
        STACK[detectStack]
        WAIT[waitForStackHydration]
        SPA[waitForSpaContent]
        HUMAN[Scroll + reveal hidden]
        EXTRACT[in-page extract bundle]
    end

    subgraph Extractors
        STATIC[parseStaticHtml]
        CSS2[cssIntel]
        JS2[jsIntel]
    end

    GOTO --> HDR --> STACK
    STACK --> WAIT
    STACK --> SPA
    WAIT --> HUMAN --> EXTRACT
    STACK --> STATIC
    EXTRACT --> CSS2
    EXTRACT --> JS2
    STATIC --> MERGE[mergeTextBlocks]
    CSS2 --> MERGE
    JS2 --> MERGE
```

**CSS scraping:** stylesheet URLs, fetched `.css` content, hidden rules, computed visibility, `::before`/`::after` pseudo text.

**JS / SPA scraping:** framework detection, JSON-LD, `__NEXT_DATA__`, API JSON capture, shadow DOM traversal, DOM mutation quiet period.

---

## Configuration

Key options in `src/config/index.ts`:

| Option | Default | Purpose |
|--------|---------|---------|
| `spaWaitEnabled` | `true` | Wait for SPA hydration |
| `fetchExternalStylesheets` | `true` | Pull linked CSS for hidden-content analysis |
| `domMutationQuietMs` | `2000` | DOM stability window |
| `piiScrubMode` | `sensitive_only` | Scrub SSN/email/phone; keep names/addresses |
| `respectRobotsTxt` | `true` | Honor robots.txt |
| `concurrency` | `3` | Parallel crawl workers |

---

## API

```bash
npm run api
# → http://127.0.0.1:3847
```

Fastify server with CORS — exposes search and crawl endpoints for integration into larger pipelines.

---

## Observability

Every mission emits structured stage metrics:

```mermaid
xychart-beta
    title "Typical mission stage timing (ms)"
    x-axis ["Discovery", "Ingress", "Render", "Distill", "Synthesis"]
    y-axis "Milliseconds" 0 --> 150000
    bar [1250, 184, 136862, 242, 16]
```

| Metric | Description |
|--------|-------------|
| `pagesCrawled` | Successfully indexed pages |
| `pagesFailed` | HTTP / render failures |
| `pagesBlocked` | robots.txt / policy blocks |
| `antiBotDetections` | Captcha / bot-wall hits |
| `findingsCount` | Structured intelligence findings |

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+, ESM |
| Language | TypeScript 5.7 |
| Browser automation | Playwright (Chromium) |
| HTML parsing | Cheerio |
| Search index | better-sqlite3 + FTS5 |
| API | Fastify 5 |
| Validation | Zod |
| Logging | Pino |

---

## Roadmap

- [ ] Sunbiz ASP.NET entity detail drill-down (session-aware)
- [ ] Force-refresh high-value sources on investigate missions
- [ ] CAPTCHA / proxy lane for gated sites (Bizapedia, LinkedIn)
- [ ] Address extraction in synthesis pipeline from CSS pseudo-text
- [ ] Web UI for investigate results

---

## License

MIT © [shep95](https://github.com/shep95)

---

<div align="center">

**Zophiel Search Engine v2** — *Search that understands how the web is built.*

[github.com/shep95/zophiel_search_engine.v2](https://github.com/shep95/zophiel_search_engine.v2)

</div>
