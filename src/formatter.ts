import TurndownService from 'turndown';
import type { Rule } from 'turndown';
import _ from 'lodash';
import type { PageSnapshot } from './types.js';

const gfmPlugin = require('turndown-plugin-gfm');

const highlightRegExp = /highlight-(?:text|source)-([a-z0-9]+)/;

function cleanAttribute(attribute: string | null): string {
    return attribute ? attribute.replace(/(\n+\s*)+/g, '\n') : '';
}

function highlightedCodeBlock(turndownService: TurndownService) {
    turndownService.addRule('highlightedCodeBlock', {
        filter: (node) => {
            return (
                node.nodeName === 'DIV' &&
                node.firstChild?.nodeName === 'PRE' &&
                highlightRegExp.test(node.className)
            );
        },
        replacement: (_content, node, options) => {
            const className = (node as any).className || '';
            const language = (className.match(highlightRegExp) || [null, ''])[1];

            return (
                '\n\n' + options.fence + language + '\n' +
                node.firstChild!.textContent +
                '\n' + options.fence + '\n\n'
            );
        }
    });
}

function getTurndown(options?: {
    noRules?: boolean;
    url?: string | URL;
}) {
    const turnDownService = new TurndownService({
        codeBlockStyle: 'fenced' as any,
        preformattedCode: true,
    } as any);

    if (!options?.noRules) {
        turnDownService.addRule('remove-irrelevant', {
            filter: ['meta', 'style', 'script', 'noscript', 'link', 'textarea', 'select'] as any,
            replacement: () => ''
        });
        turnDownService.addRule('truncate-svg', {
            filter: 'svg' as any,
            replacement: () => ''
        });
        turnDownService.addRule('title-as-h1', {
            filter: ['title'] as any,
            replacement: (innerText: string) => `${innerText}\n===============\n`
        });
    }

    turnDownService.addRule('improved-heading', {
        filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as any,
        replacement: (content, node, options) => {
            const hLevel = Number(node.nodeName.charAt(1));
            if (options.headingStyle === 'setext' && hLevel < 3) {
                const underline = _.repeat((hLevel === 1 ? '=' : '-'), Math.min(128, content.length));
                return '\n\n' + content + '\n' + underline + '\n\n';
            } else {
                return '\n\n' + _.repeat('#', hLevel) + ' ' + content + '\n\n';
            }
        }
    });

    turnDownService.addRule('improved-paragraph', {
        filter: 'p',
        replacement: (innerText: string) => {
            const trimmed = innerText.trim();
            if (!trimmed) {
                return '';
            }
            return `${trimmed.replace(/\n{3,}/g, '\n\n')}\n\n`;
        }
    });

    turnDownService.addRule('improved-link', {
        filter: function (node, _options) {
            return Boolean(
                node.nodeName === 'A' &&
                node.getAttribute('href')
            );
        },
        replacement: function (content, node: any) {
            let href = node.getAttribute('href');
            const title = cleanAttribute(node.getAttribute('title'));
            const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
            const fixedContent = content.replace(/\s+/g, ' ').trim();
            let fixedHref = href;
            if (options?.url) {
                try {
                    fixedHref = new URL(fixedHref, options.url).toString();
                } catch (_err) {
                    void 0;
                }
            }
            return `[${fixedContent}](${fixedHref}${titlePart})`;
        }
    });

    turnDownService.addRule('improved-code', {
        filter: function (node: any) {
            const hasSiblings = node.previousSibling || node.nextSibling;
            const isCodeBlock = node.parentNode.nodeName === 'PRE' && !hasSiblings;
            return node.nodeName === 'CODE' && !isCodeBlock;
        },
        replacement: function (inputContent: any) {
            if (!inputContent) return '';
            const content = inputContent;

            let delimiter = '`';
            const matches = content.match(/`+/gm) || [];
            while (matches.indexOf(delimiter) !== -1) delimiter = delimiter + '`';
            if (content.includes('\n')) {
                delimiter = '```';
            }

            const extraSpace = delimiter === '```' ? '\n' : /^`|^ .*?[^ ].* $|`$/.test(content) ? ' ' : '';

            return delimiter + extraSpace + content + (delimiter === '```' && !content.endsWith(extraSpace) ? extraSpace : '') + delimiter;
        }
    });

    return turnDownService;
}

function isPoorlyTransformed(content?: string, node?: any): boolean {
    if (!content) {
        return true;
    }
    if (content.startsWith('<') && content.endsWith('>')) {
        return true;
    }
    if (content.includes('<table') && content.includes('</table>')) {
        if (node?.textContent && content.length > node.textContent.length * 0.8) {
            return true;
        }
        const tableElms = node?.querySelectorAll('table') || [];
        const deepTableElms = node?.querySelectorAll('table table');
        if (node && tableElms.length) {
            const wrappingTables = _.without(Array.from(tableElms) as any[], ...Array.from(deepTableElms || []));
            const tableTextsLength = _.sum(wrappingTables.map((x: any) => (x.innerHTML?.length || 0)));
            if (tableTextsLength / content.length > 0.6) {
                return true;
            }
        }
        const tbodyElms = node?.querySelectorAll('tbody') || [];
        const deepTbodyElms = node?.querySelectorAll('tbody tbody');
        if ((deepTbodyElms?.length || 0) / tbodyElms.length > 0.6) {
            return true;
        }
    }
    return false;
}

export function snippetToElement(linkedom: any, snippet?: string, url?: string) {
    const parsed = linkedom.parseHTML(snippet || '<html><body></body></html>');

    // Hack for turndown gfm table plugin
    parsed.window.document.querySelectorAll('table').forEach((x: any) => {
        Object.defineProperty(x, 'rows', { value: Array.from(x.querySelectorAll('tr')), enumerable: true });
    });
    Object.defineProperty(parsed.window.document.documentElement, 'cloneNode', {
        value: function () { return this; },
    });

    return parsed.window.document.documentElement;
}

export function toMarkdown(snapshot: PageSnapshot, linkedom: any, nominalUrl?: string): string {
    const url = snapshot.rebase || nominalUrl || snapshot.href;

    const jsDomElementOfHTML = snippetToElement(linkedom, snapshot.html, snapshot.href);
    let toBeTurnedToMd = jsDomElementOfHTML;
    let turnDownService = getTurndown({ url });

    if (snapshot.parsed?.content) {
        const jsDomElementOfParsed = snippetToElement(linkedom, snapshot.parsed.content, snapshot.href);
        const par1 = turnDownService.turndown(jsDomElementOfHTML);
        const par2 = snapshot.parsed.content ? turnDownService.turndown(jsDomElementOfParsed) : '';

        // If Readability content >= 30% of full HTML markdown length, use it
        if (par2.length >= 0.3 * par1.length) {
            turnDownService = getTurndown({ noRules: true, url });
            if (snapshot.parsed.content) {
                toBeTurnedToMd = jsDomElementOfParsed;
            }
        }
    }

    const gfmPlugins = [gfmPlugin.tables, highlightedCodeBlock, gfmPlugin.strikethrough, gfmPlugin.taskListItems];
    turnDownService = turnDownService.use(gfmPlugins);

    let contentText = '';
    try {
        contentText = turnDownService.turndown(toBeTurnedToMd).trim();
    } catch (_err) {
        // Retry without plugins
        const vanillaTurnDownService = getTurndown({ url });
        try {
            contentText = vanillaTurnDownService.turndown(toBeTurnedToMd).trim();
        } catch (_err2) {
            // give up
        }
    }

    if (
        isPoorlyTransformed(contentText, toBeTurnedToMd) &&
        toBeTurnedToMd !== jsDomElementOfHTML
    ) {
        toBeTurnedToMd = jsDomElementOfHTML;
        const retryService = getTurndown({ url }).use(gfmPlugins);
        try {
            contentText = retryService.turndown(jsDomElementOfHTML).trim();
        } catch (_err) {
            const vanillaTurnDownService = getTurndown({ url });
            try {
                contentText = vanillaTurnDownService.turndown(jsDomElementOfHTML).trim();
            } catch (_err2) {
                // give up
            }
        }
    }

    if (isPoorlyTransformed(contentText, toBeTurnedToMd)) {
        contentText = (snapshot.text || '').trimEnd();
    }

    return contentText;
}
