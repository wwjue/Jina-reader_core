export interface ReadResult {
    title: string;
    description: string;
    url: string;
    markdown: string;
    text: string;
    byline: string;
    excerpt: string;
    siteName: string;
    lang: string;
    publishedTime: string;
}

export interface ReadOptions {
    /** Navigation timeout in milliseconds (default: 30000) */
    timeout?: number;
    /** When to consider navigation finished (default: 'domcontentloaded') */
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    /** Run browser in headless mode (default: true) */
    headless?: boolean;
}

export interface ReadabilityParsed {
    title: string;
    content: string;
    textContent: string;
    length: number;
    excerpt: string;
    byline: string;
    dir: string;
    siteName: string;
    lang: string;
    publishedTime: string;
}

export interface SearchResult {
    link: string;
    title: string;
    source?: string;
    date?: string;
    snippet?: string;
    imageUrl?: string;
    siteLinks?: { link: string; title: string; snippet?: string }[];
}

export interface SearchOptions {
    /** Number of results per page (default: 10) */
    num?: number;
    /** Page number (default: 1) */
    page?: number;
    /** Country code (e.g. 'us') */
    gl?: string;
    /** Language code (e.g. 'en') */
    hl?: string;
    /** Navigation timeout in milliseconds (default: 30000) */
    timeout?: number;
    /** Run browser in headless mode (default: true) */
    headless?: boolean;
}

export interface PageSnapshot {
    title: string;
    description?: string;
    href: string;
    rebase?: string;
    html: string;
    text: string;
    parsed?: Partial<ReadabilityParsed> | null;
    imgs?: { src: string; alt?: string }[];
    maxElemDepth?: number;
    elemCount?: number;
    shadowExpanded?: string;
    lastMutationIdle?: number;
    htmlSignificantlyModifiedByJs?: boolean;
}
