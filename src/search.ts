import { getBrowser } from './browser.js';
import type { SearchResult, SearchOptions } from './types.js';

const SIMULATE_SCROLL = `
(function () {
    function createIntersectionObserverEntry(target, isIntersecting, timestamp) {
        const targetRect = target.getBoundingClientRect();
        const record = {
            target,
            isIntersecting,
            time: timestamp,
            intersectionRect: isIntersecting
                ? targetRect
                : new DOMRectReadOnly(0, 0, 0, 0),
            boundingClientRect: targetRect,
            intersectionRatio: isIntersecting ? 1 : 0,
            rootBounds: new DOMRectReadOnly(
                0,
                0,
                window.innerWidth,
                window.innerHeight
            )
        };
        Object.setPrototypeOf(record, window.IntersectionObserverEntry.prototype);
        return record;
    }
    function cloneIntersectionObserverEntry(entry) {
        const record = {
            target: entry.target,
            isIntersecting: entry.isIntersecting,
            time: entry.time,
            intersectionRect: entry.intersectionRect,
            boundingClientRect: entry.boundingClientRect,
            intersectionRatio: entry.intersectionRatio,
            rootBounds: entry.rootBounds
        };
        Object.setPrototypeOf(record, window.IntersectionObserverEntry.prototype);
        return record;
    }
    const orig = window.IntersectionObserver;
    const kCallback = Symbol('callback');
    const kLastEntryMap = Symbol('lastEntryMap');
    const liveObservers = new Map();
    class MangledIntersectionObserver extends orig {
        constructor(callback, options) {
            super((entries, observer) => {
                const lastEntryMap = observer[kLastEntryMap];
                const lastEntry = entries[entries.length - 1];
                lastEntryMap.set(lastEntry.target, lastEntry);
                return callback(entries, observer);
            }, options);
            this[kCallback] = callback;
            this[kLastEntryMap] = new WeakMap();
            liveObservers.set(this, new Set());
        }
        disconnect() {
            liveObservers.get(this)?.clear();
            liveObservers.delete(this);
            return super.disconnect();
        }
        observe(target) {
            const observer = liveObservers.get(this);
            observer?.add(target);
            return super.observe(target);
        }
        unobserve(target) {
            const observer = liveObservers.get(this);
            observer?.delete(target);
            return super.unobserve(target);
        }
    }
    Object.defineProperty(MangledIntersectionObserver, 'name', { value: 'IntersectionObserver', writable: false });
    window.IntersectionObserver = MangledIntersectionObserver;
    function simulateScroll() {
        for (const [observer, targets] of liveObservers.entries()) {
            const t0 = performance.now();
            for (const target of targets) {
                const entry = createIntersectionObserverEntry(target, true, t0);
                observer[kCallback]([entry], observer);
                setTimeout(() => {
                    const t1 = performance.now();
                    const lastEntry = observer[kLastEntryMap].get(target);
                    if (!lastEntry) {
                        return;
                    }
                    const entry2 = { ...cloneIntersectionObserverEntry(lastEntry), time: t1 };
                    observer[kCallback]([entry2], observer);
                });
            }
        }
    }
    window.simulateScroll = simulateScroll;
})();
`;

const MUTATION_IDLE_WATCH = `
(function () {
    let timeout;
    const sendMsg = ()=> {
        document.dispatchEvent(new CustomEvent('mutationIdle'));
    };

    const cb = () => {
        if (timeout) {
            clearTimeout(timeout);
            timeout = setTimeout(sendMsg, 200);
        }
    };
    const mutationObserver = new MutationObserver(cb);

    document.addEventListener('DOMContentLoaded', () => {
        mutationObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
        timeout = setTimeout(sendMsg, 200);
    }, { once: true })
})();
`;

const MINIMAL_STEALTH = `
(function(){
    const utils = {};

    utils.init = () => {
        utils.preloadCache();
    };

    utils.stripProxyFromErrors = (handler = {}) => {
        const newHandler = {
            setPrototypeOf: function (target, proto) {
                if (proto === null)
                    throw new TypeError('Cannot convert object to primitive value');
                if (Object.getPrototypeOf(target) === Object.getPrototypeOf(proto)) {
                    throw new TypeError('Cyclic __proto__ value');
                }
                return Reflect.setPrototypeOf(target, proto);
            }
        };
        const traps = Object.getOwnPropertyNames(handler);
        traps.forEach(trap => {
            newHandler[trap] = function () {
                try {
                    return handler[trap].call(this, ...(arguments || []));
                } catch (err) {
                    if (!err || !err.stack || !err.stack.includes('at ')) {
                        throw err;
                    }
                    const stripWithBlacklist = (stack, stripFirstLine = true) => {
                        const blacklist = [
                            'at Reflect.' + trap + ' ',
                            'at Object.' + trap + ' ',
                            'at Object.newHandler.<computed> [as ' + trap + '] '
                        ];
                        return (
                            err.stack
                                .split('\\n')
                                .filter((line, index) => !(index === 1 && stripFirstLine))
                                .filter(line => !blacklist.some(bl => line.trim().startsWith(bl)))
                                .join('\\n')
                        );
                    };
                    const stripWithAnchor = (stack, anchor) => {
                        const stackArr = stack.split('\\n');
                        anchor = anchor || 'at Object.newHandler.<computed> [as ' + trap + '] ';
                        const anchorIndex = stackArr.findIndex(line =>
                            line.trim().startsWith(anchor)
                        );
                        if (anchorIndex === -1) {
                            return false;
                        }
                        stackArr.splice(1, anchorIndex);
                        return stackArr.join('\\n');
                    };
                    err.stack = err.stack.replace(
                        'at Object.toString (',
                        'at Function.toString ('
                    );
                    if ((err.stack || '').includes('at Function.toString (')) {
                        err.stack = stripWithBlacklist(err.stack, false);
                        throw err;
                    }
                    err.stack = stripWithAnchor(err.stack) || stripWithBlacklist(err.stack);
                    throw err;
                }
            };
        });
        return newHandler;
    };

    utils.replaceProperty = (obj, propName, descriptorOverrides = {}) => {
        return Object.defineProperty(obj, propName, {
            ...(Object.getOwnPropertyDescriptor(obj, propName) || {}),
            ...descriptorOverrides
        });
    };

    utils.preloadCache = () => {
        if (utils.cache) {
            return;
        }
        utils.cache = {
            Reflect: {
                get: Reflect.get.bind(Reflect),
                apply: Reflect.apply.bind(Reflect)
            },
            nativeToStringStr: Function.toString + ''
        };
    };

    utils.patchToString = (obj, str = '') => {
        Object.defineProperty(obj, 'toString', {
            value: ()=> str,
            enumerable: false,
            writable: true,
            configurable: true,
        });
    };

    utils.redirectToString = (proxyObj, originalObj) => {
        Object.defineProperty(proxyObj, 'toString', {
            value: ()=> originalObj.toString(),
            enumerable: false,
            writable: true,
            configurable: true,
        });
    };

    utils.replaceWithProxy = (obj, propName, handler) => {
        const originalObj = obj[propName];
        const proxyObj = new Proxy(obj[propName], utils.stripProxyFromErrors(handler));
        utils.replaceProperty(obj, propName, { value: proxyObj });
        utils.redirectToString(proxyObj, originalObj);
        return true;
    };

    utils.init();

    const getParameterProxyHandler = {
        apply: function (target, ctx, args) {
            const param = (args || [])[0];
            const result = utils.cache.Reflect.apply(target, ctx, args);
            if (param === 37445) {
                return 'Intel Inc.';
            }
            if (param === 37446) {
                return 'Intel Iris OpenGL Engine';
            }
            return result;
        }
    };

    const addProxy = (obj, propName) => {
        utils.replaceWithProxy(obj, propName, getParameterProxyHandler);
    };
    addProxy(WebGLRenderingContext.prototype, 'getParameter');
    addProxy(WebGL2RenderingContext.prototype, 'getParameter');
})();
`;

const WAIT_FOR_SELECTOR = `
(function(){
    function waitForSelector(selectorText) {
        return new Promise((resolve) => {
            const existing = document.querySelector(selectorText);
            if (existing) {
                resolve(existing);
                return;
            }
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    const observer = new MutationObserver(() => {
                        const elem = document.querySelector(selectorText);
                        if (elem) {
                            resolve(document.querySelector(selectorText));
                            observer.disconnect();
                        }
                    });
                    observer.observe(document.documentElement, {
                        childList: true,
                        subtree: true
                    });
                });
                return;
            }
            const observer = new MutationObserver(() => {
                const elem = document.querySelector(selectorText);
                if (elem) {
                    resolve(document.querySelector(selectorText));
                    observer.disconnect();
                }
            });
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
        });
    }
    window.waitForSelector = waitForSelector;
})();
`;

function getSerpInjectedScript(): string {
    return `
${SIMULATE_SCROLL}
${MUTATION_IDLE_WATCH}
${MINIMAL_STEALTH}
${WAIT_FOR_SELECTOR}
`;
}

function buildSearchUrl(query: string, options: SearchOptions = {}): string {
    const url = new URL('https://www.google.com/search');
    url.searchParams.set('q', query);

    const num = options.num || 10;
    // Request extra results since Google may return fewer organic results
    // than requested due to featured snippets, filters, etc.
    url.searchParams.set('num', `${num + 6}`);

    if (options.page && options.page > 1) {
        url.searchParams.set('start', `${(options.page - 1) * num}`);
    }
    if (options.gl) {
        url.searchParams.set('gl', options.gl);
    }
    if (options.hl) {
        url.searchParams.set('hl', options.hl);
    }

    return url.toString();
}

export async function searchGoogle(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const {
        timeout = 30_000,
        headless = true,
    } = options || {};

    const browser = await getBrowser(headless);
    const ua = await browser.userAgent();
    const effectiveUA = ua
        .replace(/Headless/i, '')
        .replace('Mozilla/5.0 (X11; Linux x86_64)', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

    const searchUrl = buildSearchUrl(query, options);
    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    try {
        await Promise.all([
            page.setUserAgent(effectiveUA),
            page.setBypassCSP(true),
            page.setViewport({ width: 1024, height: 1024 }),
            page.evaluateOnNewDocument(getSerpInjectedScript()),
        ]);

        // Block unnecessary resources to speed up SERP loading
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (req.isInterceptResolutionHandled()) return;
            const typ = req.resourceType();
            if (typ === 'media' || typ === 'font' || typ === 'image' || typ === 'stylesheet') {
                return req.abort('blockedbyclient');
            }
            return req.continue();
        });

        await page.goto(searchUrl, {
            waitUntil: 'domcontentloaded',
            timeout,
        });

        const results = await page.evaluate(() => {
            if (location.pathname.startsWith('/sorry') || location.pathname.startsWith('/error')) {
                throw new Error('Google returned an error page. This may happen due to rate limiting or CAPTCHA.');
            }

            // @ts-ignore
            return Promise.race([window.waitForSelector('div[data-async-context^="query"]'), window.waitForSelector('#botstuff .mnr-c')])
                .then(() => {
                    const wrapper1 = document.querySelector('div[data-async-context^="query"]');

                    if (!wrapper1) {
                        return [];
                    }

                    const query = decodeURIComponent(wrapper1.getAttribute('data-async-context')?.split('query:')[1] || '');
                    if (!query) {
                        return [];
                    }

                    const candidates = Array.from(wrapper1.querySelectorAll('div[lang],div[data-surl]'));

                    return candidates.map((x) => {
                        const primaryLink = x.querySelector('a:not([href="#"])');
                        if (!primaryLink) {
                            return undefined;
                        }
                        const url = primaryLink.getAttribute('href');

                        if (primaryLink.querySelector('div[role="heading"]')) {
                            return undefined;
                        }

                        const title = primaryLink.querySelector('h3')?.textContent;
                        const source = Array.from(primaryLink.querySelectorAll('span')).find((s) => s.textContent)?.textContent;
                        const cite = primaryLink.querySelector('cite[role=text]')?.textContent;
                        const date = cite?.split('·')[1]?.trim() || undefined;
                        const snippetSpans = Array.from(x.querySelectorAll('div[data-sncf*="1"] span'))
                            .map((s) => s.textContent?.trim())
                            .filter((t): t is string => !!t && t.length > 20);
                        let snippet: string | null | undefined = snippetSpans[snippetSpans.length - 1];
                        if (!snippet) {
                            snippet = x.querySelector('div.IsZvec')?.textContent?.trim() || null;
                        }
                        const imageUrl = x.querySelector('div[data-sncf*="1"] img[src]:not(img[src^="data"])')?.getAttribute('src');
                        let siteLinks = Array.from(x.querySelectorAll('div[data-sncf*="3"] a[href]')).map((l) => {
                            return {
                                link: l.getAttribute('href')!,
                                title: l.textContent!,
                            };
                        });
                        const perhapsParent = x.parentElement?.closest('div[data-hveid]');
                        if (!siteLinks?.length && perhapsParent) {
                            const tdCandidates = Array.from(perhapsParent.querySelectorAll('td h3'));
                            if (tdCandidates.length) {
                                siteLinks = tdCandidates.map((l) => {
                                    const link = l.querySelector('a');
                                    if (!link) {
                                        return undefined;
                                    }
                                    const snip = l.nextElementSibling?.textContent;
                                    return {
                                        link: link.getAttribute('href')!,
                                        title: link.textContent!,
                                        snippet: snip || undefined,
                                    };
                                }).filter(Boolean) as { link: string; title: string; snippet?: string }[];
                            }
                        }

                        return {
                            link: url,
                            title,
                            source,
                            date,
                            snippet: snippet ?? undefined,
                            imageUrl: imageUrl?.startsWith('data:') ? undefined : imageUrl,
                            siteLinks: siteLinks.length ? siteLinks : undefined,
                        };
                    }).filter(Boolean);
                });
        }) as SearchResult[];

        return (results || []).slice(0, options?.num || 10);
    } finally {
        await page.close().catch(() => {});
        await context.close().catch(() => {});
    }
}
