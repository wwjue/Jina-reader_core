import { getBrowser, closeBrowser } from './browser.js';
import { getInjectedScript } from './snapshot.js';
import { toMarkdown } from './formatter.js';
import type { ReadResult, ReadOptions, PageSnapshot } from './types.js';

export type { ReadResult, ReadOptions };
export type { SearchResult, SearchOptions } from './types.js';
export { closeBrowser };
export { searchGoogle } from './search.js';
export { startServer } from './server.js';

const pLinkedom = import('linkedom');

export async function readUrl(url: string, options?: ReadOptions): Promise<ReadResult> {
    const {
        timeout = 30_000,
        waitUntil = 'domcontentloaded',
        headless = true,
    } = options || {};

    const browser = await getBrowser(headless);
    const linkedom = await pLinkedom;

    const ua = await browser.userAgent();
    const effectiveUA = ua
        .replace(/Headless/i, '')
        .replace('Mozilla/5.0 (X11; Linux x86_64)', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    try {
        await Promise.all([
            page.setUserAgent(effectiveUA),
            page.setBypassCSP(true),
            page.setViewport({ width: 1024, height: 1024 }),
            page.evaluateOnNewDocument(getInjectedScript()),
        ]);

        const response = await page.goto(url, {
            waitUntil,
            timeout,
        });

        // Wait a bit for dynamic content to settle
        await page.evaluate(() => {
            return new Promise<void>((resolve) => {
                if (typeof (window as any).simulateScroll === 'function') {
                    (window as any).simulateScroll();
                }
                setTimeout(resolve, 500);
            });
        });

        const snapshot: PageSnapshot = await page.evaluate(() => {
            return (window as any).giveSnapshot(true);
        });

        if (response) {
            (snapshot as any).status = response.status();
            (snapshot as any).statusText = response.statusText();
        }

        const markdown = toMarkdown(snapshot, linkedom, url);

        return {
            title: (snapshot.parsed?.title || snapshot.title || '').trim(),
            description: (snapshot.description || '').trim(),
            url: snapshot.href?.trim() || url,
            markdown,
            text: (snapshot.text || '').trim(),
            byline: (snapshot.parsed?.byline || '').trim(),
            excerpt: (snapshot.parsed?.excerpt || '').trim(),
            siteName: (snapshot.parsed?.siteName || '').trim(),
            lang: (snapshot.parsed?.lang || '').trim(),
            publishedTime: (snapshot.parsed?.publishedTime || '').trim(),
        };
    } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
    }
}

// CLI entry point
if (require.main === module || process.argv[1]?.endsWith('index.ts')) {
    const isSearch = process.argv[2] === '--search';
    const arg = isSearch ? process.argv[3] : process.argv[2];

    if (!arg) {
        console.error('Usage: npx tsx src/index.ts <url>');
        console.error('       npx tsx src/index.ts --search <query>');
        process.exit(1);
    }

    if (isSearch) {
        import('./search.js').then(({ searchGoogle }) =>
            searchGoogle(arg)
                .then((results) => {
                    console.log(JSON.stringify(results, null, 2));
                })
                .catch((err) => {
                    console.error('Error:', err);
                    process.exit(1);
                })
                .finally(() => closeBrowser())
        );
    } else {
        readUrl(arg)
            .then((result) => {
                console.log(`Title: ${result.title}`);
                console.log(`URL: ${result.url}`);
                if (result.description) console.log(`Description: ${result.description}`);
                if (result.byline) console.log(`Author: ${result.byline}`);
                if (result.publishedTime) console.log(`Published: ${result.publishedTime}`);
                if (result.lang) console.log(`Language: ${result.lang}`);
                console.log(`\nMarkdown Content:\n${result.markdown}`);
            })
            .catch((err) => {
                console.error('Error:', err);
                process.exit(1);
            })
            .finally(() => closeBrowser());
    }
}
