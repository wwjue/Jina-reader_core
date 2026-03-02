import puppeteer, { Browser } from 'puppeteer';

let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;

export async function getBrowser(headless: boolean = true): Promise<Browser> {
    if (browser?.connected) {
        return browser;
    }

    if (launching) {
        return launching;
    }

    launching = puppeteer.launch({
        timeout: 10_000,
        headless,
        args: [
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
        ],
    }).then((b) => {
        browser = b;
        launching = null;
        b.once('disconnected', () => {
            browser = null;
        });
        return b;
    }).catch((err) => {
        launching = null;
        throw err;
    });

    return launching;
}

export async function closeBrowser(): Promise<void> {
    if (browser?.connected) {
        await browser.close();
    }
    browser = null;
    launching = null;
}

// Kill Chromium on abrupt exit (Windows Ctrl+C doesn't run async SIGINT handlers)
process.on('exit', () => {
    if (browser?.connected) {
        browser.process()?.kill();
    }
});
