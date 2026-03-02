# reader-core

Standalone Node.js library that extracts LLM-friendly markdown from any URL. Built on the same Puppeteer + Readability + Turndown pipeline as [Jina Reader](https://github.com/jina-ai/reader), packaged as a single function call.

## Install

```bash
npm install reader-core
```

Puppeteer will download a Chromium binary automatically during install.

## Quick start

```typescript
import { readUrl, closeBrowser } from 'reader-core';

const result = await readUrl('https://example.com');
console.log(result.markdown);

// Clean up the shared browser instance when done
await closeBrowser();
```

## CLI

```bash
npx tsx src/index.ts https://example.com
npx tsx src/index.ts --search "your query"
```

## HTTP server

Run the built-in Fastify server to expose `readUrl` and `searchGoogle` as JSON API endpoints:

```bash
npm run serve            # listens on port 3000
PORT=8080 npm run serve  # custom port
```

**Endpoints**

| Endpoint | Required | Optional | Returns |
|---|---|---|---|
| `GET /read?url=...` | `url` | `timeout` | `ReadResult` object |
| `GET /search?q=...` | `q` | `num`, `page`, `gl`, `hl` | `{ results: SearchResult[] }` |

**Example**

```bash
curl "http://localhost:3000/read?url=https://example.com"
curl "http://localhost:3000/search?q=nodejs+tutorial&num=3"
```

```python
import httpx

BASE = "http://localhost:3000"

# web_fetch
r = httpx.get(f"{BASE}/read", params={"url": "https://example.com"}, timeout=60)
print(r.json()["markdown"])

# web_search
r = httpx.get(f"{BASE}/search", params={"q": "nodejs tutorial", "num": 5}, timeout=60)
for item in r.json()["results"]:
    print(item["title"], item["link"])
```

You can also start the server programmatically:

```typescript
import { startServer } from 'reader-core';

const app = await startServer(3000);
```

## API

### `readUrl(url, options?)`

Fetches a URL in a headless browser, extracts the page content with Mozilla Readability, and converts it to markdown with Turndown.

```typescript
const result = await readUrl('https://en.wikipedia.org/wiki/Node.js', {
  timeout: 60_000,
  waitUntil: 'networkidle2',
});
```

**Options**

| Option | Type | Default | Description |
|---|---|---|---|
| `timeout` | `number` | `30000` | Navigation timeout in milliseconds |
| `waitUntil` | `string` | `'domcontentloaded'` | When to consider navigation finished. One of `'load'`, `'domcontentloaded'`, `'networkidle0'`, `'networkidle2'` |
| `headless` | `boolean` | `true` | Run the browser in headless mode |

**Return value (`ReadResult`)**

| Field | Type | Description |
|---|---|---|
| `title` | `string` | Page title |
| `description` | `string` | Meta description |
| `url` | `string` | Final URL (after redirects) |
| `markdown` | `string` | LLM-friendly markdown content |
| `text` | `string` | Plain text (`innerText`) |
| `byline` | `string` | Author |
| `excerpt` | `string` | Excerpt |
| `siteName` | `string` | Site name |
| `lang` | `string` | Language |
| `publishedTime` | `string` | Publish date |

### `closeBrowser()`

Closes the shared Puppeteer browser instance. Call this when you're done making requests, or before your process exits.

```typescript
await closeBrowser();
```

### `searchGoogle(query, options?)`

Searches Google and returns structured results.

```typescript
import { searchGoogle, closeBrowser } from 'reader-core';

const results = await searchGoogle('nodejs tutorial', { num: 5 });
console.log(results);
await closeBrowser();
```

**Options**

| Option | Type | Default | Description |
|---|---|---|---|
| `num` | `number` | `10` | Number of results per page |
| `page` | `number` | `1` | Page number |
| `gl` | `string` | — | Country code (e.g. `'us'`) |
| `hl` | `string` | — | Language code (e.g. `'en'`) |
| `timeout` | `number` | `30000` | Navigation timeout in milliseconds |
| `headless` | `boolean` | `true` | Run the browser in headless mode |

**Return value (`SearchResult[]`)**

| Field | Type | Description |
|---|---|---|
| `link` | `string` | Result URL |
| `title` | `string` | Result title |
| `source` | `string?` | Source site name |
| `date` | `string?` | Date string |
| `snippet` | `string?` | Result snippet |
| `imageUrl` | `string?` | Thumbnail URL |
| `siteLinks` | `array?` | Sub-links with `link`, `title`, `snippet` |

### `startServer(port?)`

Starts the Fastify HTTP server. Defaults to port `3000`.

```typescript
import { startServer } from 'reader-core';

const app = await startServer(8080);
```

## How it works

1. **Browser** &mdash; A shared headless Chromium instance is lazily launched on the first call and reused across requests.
2. **Stealth** &mdash; Minimal anti-detection patches (WebGL vendor spoofing, user-agent cleanup) are injected before each page load.
3. **Scroll simulation** &mdash; `IntersectionObserver` is patched to trigger lazy-loaded content without actual scrolling.
4. **Snapshot** &mdash; [Mozilla Readability](https://github.com/mozilla/readability) runs in-page to extract the article content, title, author, and metadata.
5. **Markdown** &mdash; [Turndown](https://github.com/mixmark-io/turndown) converts the HTML to markdown with GFM support (tables, strikethrough, task lists, fenced code blocks). A content-selection heuristic picks Readability's output when it captures at least 30% of the full page, otherwise falls back to the full HTML.

## Project structure

```
reader-core/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts       — readUrl() entry point + CLI
    ├── server.ts      — Fastify HTTP server
    ├── browser.ts     — Shared Puppeteer browser lifecycle
    ├── search.ts      — Google search via Puppeteer
    ├── snapshot.ts     — Scripts injected into the browser page
    ├── formatter.ts   — Turndown markdown conversion pipeline
    └── types.ts       — TypeScript interfaces
```

## License

Apache-2.0
