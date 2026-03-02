import fs from 'fs';

const READABILITY_JS = fs.readFileSync(
    require.resolve('@mozilla/readability/Readability.js'),
    'utf-8'
);

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

const GIVE_SNAPSHOT_SCRIPT = `
(function(){
function briefImgs(elem) {
    const imageTags = Array.from((elem || document).querySelectorAll('img[src],img[data-src]'));

    return imageTags.map((x)=> {
        let linkPreferredSrc = x.src;
        if (linkPreferredSrc.startsWith('data:')) {
            if (typeof x.dataset?.src === 'string' && !x.dataset.src.startsWith('data:')) {
                linkPreferredSrc = x.dataset.src;
            }
        }

        return {
            src: new URL(linkPreferredSrc, document.baseURI).toString(),
            loaded: x.complete,
            width: x.width,
            height: x.height,
            naturalWidth: x.naturalWidth,
            naturalHeight: x.naturalHeight,
            alt: x.alt || x.title,
        };
    });
}
function getMaxDepthAndElemCountUsingTreeWalker(root=document.documentElement) {
  let maxDepth = 0;
  let currentDepth = 0;
  let elementCount = 0;

  const treeWalker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    (node) => {
      const nodeName = node.nodeName?.toLowerCase();
      return (nodeName === 'svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
    false
  );

  while (true) {
    maxDepth = Math.max(maxDepth, currentDepth);
    elementCount++;

    if (treeWalker.firstChild()) {
      currentDepth++;
    } else {
      while (!treeWalker.nextSibling() && currentDepth > 0) {
        treeWalker.parentNode();
        currentDepth--;
      }

      if (currentDepth <= 0) {
        break;
      }
    }
  }

  return {
    maxDepth: maxDepth + 1,
    elementCount: elementCount
  };
}

let lastMutationIdle = 0;
let initialAnalytics;
document.addEventListener('mutationIdle', ()=> lastMutationIdle = Date.now());

function giveSnapshot(stopActiveSnapshot, overrideDomAnalysis) {
    if (stopActiveSnapshot) {
        window.haltSnapshot = true;
    }
    let parsed;
    try {
        parsed = new Readability(document.cloneNode(true)).parse();
    } catch (err) {
        void 0;
    }
    const domAnalysis = overrideDomAnalysis || getMaxDepthAndElemCountUsingTreeWalker(document.documentElement);
    initialAnalytics = initialAnalytics || domAnalysis;

    const thisElemCount = domAnalysis.elementCount;
    const initialElemCount = initialAnalytics.elementCount;
    const r = {
        title: document.title,
        description: document.head?.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
        href: document.location.href,
        html: document.documentElement?.outerHTML,
        htmlSignificantlyModifiedByJs: Boolean(Math.abs(thisElemCount - initialElemCount) / (initialElemCount + Number.EPSILON) > 0.05),
        text: document.body?.innerText,
        parsed: parsed,
        imgs: [],
        maxElemDepth: domAnalysis.maxDepth,
        elemCount: domAnalysis.elementCount,
        lastMutationIdle,
    };
    if (document.baseURI !== r.href) {
        r.rebase = document.baseURI;
    }
    r.imgs = briefImgs();

    return r;
}
window.giveSnapshot = giveSnapshot;
})();
`;

export function getInjectedScript(): string {
    return `
${READABILITY_JS}
${SIMULATE_SCROLL}
${MUTATION_IDLE_WATCH}
${MINIMAL_STEALTH}
${GIVE_SNAPSHOT_SCRIPT}
`;
}
