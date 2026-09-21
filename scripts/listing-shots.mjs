// Store-listing screenshots, rendered from the real popup rather than drawn.
//
// The Chrome Web Store wants 1280×800 JPEGs, and the popup is a 380px-wide
// HTML page, so this loads the built `dist/chrome/popup.html` in headless
// Chrome with the `chrome.*` APIs stubbed and invented data behind them,
// photographs it, and composes each shot onto a 1280×800 canvas with a
// caption. Everything you see in the result is the shipped markup and CSS:
// when the UI changes, re-run this and the listing is right again.
//
//   npm run listing:shots                 # English, into listing/en/
//   npm run listing:shots -- --locales all
//   npm run listing:shots -- --locale de --out /tmp/shots
//
// The data is fictional on purpose (Northwind, Acme, Fern & Co). Never point
// this at a real workspace: store listings are public forever.
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'chrome');

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const i = args.indexOf(`--${name}`);

    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const OUT = resolve(arg('out', join(ROOT, 'listing')));
const LOCALE_ARG = arg('locales', arg('locale', 'en'));

// ---------------------------------------------------------------------------
// Chrome: whichever one is already on this machine
// ---------------------------------------------------------------------------

function findChrome() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;

    // Whatever puppeteer downloaded for another project (zebu-app renders PDFs
    // with it), newest build first.
    const cache = join(homedir(), '.cache', 'puppeteer', 'chrome');
    if (existsSync(cache)) {
        const builds = readdirSync(cache).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
        for (const build of builds) {
            for (const suffix of [
                'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
                'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
                'chrome-linux64/chrome',
            ]) {
                const path = join(cache, build, suffix);
                if (existsSync(path)) return path;
            }
        }
    }

    for (const path of [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
    ]) {
        if (existsSync(path)) return path;
    }

    throw new Error('no Chrome found — set PUPPETEER_EXECUTABLE_PATH to a Chrome or Chromium binary');
}

// ---------------------------------------------------------------------------
// The invented workspace
// ---------------------------------------------------------------------------

// Every render pretends it is this moment: a Thursday afternoon. Fixing it
// keeps the screenshots reproducible (regenerating must not change the
// picture) and guarantees the week strip has days behind it, which a run on a
// Monday morning would not.
const NOW = new Date('2026-09-17T15:20:00');

const pad = (n) => String(n).padStart(2, '0');
const dateString = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shiftDays = (d, by) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + by);

/** Fixtures are built fresh each run so the day header and week strip read as today. */
function fixtures() {
    const now = NOW;
    const today = dateString(now);
    // The week strip starts on Monday.
    const monday = shiftDays(now, -((now.getDay() + 6) % 7));

    const projects = [
        {
            id: 'p-web',
            name: 'Website redesign',
            code: 'WEB',
            client: 'Northwind',
            tasks: [
                { id: 't-design', name: 'Design' },
                { id: 't-build', name: 'Development' },
            ],
        },
        {
            id: 'p-app',
            name: 'Mobile app',
            code: 'APP',
            client: 'Acme',
            tasks: [
                { id: 't-build', name: 'Development' },
                { id: 't-qa', name: 'Testing' },
            ],
        },
        {
            id: 'p-brand',
            name: 'Brand identity',
            code: 'BRD',
            client: 'Fern & Co',
            tasks: [{ id: 't-design', name: 'Design' }],
        },
    ];

    const entry = (over) => ({
        notes: null,
        task: null,
        task_id: null,
        is_billable: true,
        locked: false,
        timer_started_at: null,
        ...over,
    });

    // The one that is running: started 47 minutes ago, nothing banked yet.
    const running = entry({
        id: 'e-running',
        date: today,
        minutes: 0,
        notes: 'WEB-214 Checkout flow — the address step',
        project: 'Website redesign',
        project_id: 'p-web',
        task: 'Development',
        task_id: 't-build',
        timer_started_at: new Date(now.getTime() - 47 * 60_000).toISOString(),
    });

    const entries = [
        running,
        entry({
            id: 'e-standup',
            date: today,
            minutes: 25,
            notes: 'Standup and planning',
            project: 'Mobile app',
            project_id: 'p-app',
            task: 'Development',
            task_id: 't-build',
        }),
        entry({
            id: 'e-review',
            date: today,
            minutes: 95,
            notes: 'APP-88 Offline sync review',
            project: 'Mobile app',
            project_id: 'p-app',
            task: 'Testing',
            task_id: 't-qa',
        }),
        entry({
            id: 'e-logo',
            date: today,
            minutes: 60,
            notes: 'Logo lockups for the deck',
            project: 'Brand identity',
            project_id: 'p-brand',
            task: 'Design',
            task_id: 't-design',
            is_billable: false,
        }),
    ];

    // A few earlier days so the week strip is not a row of zeroes.
    const earlier = [
        [1, 415, 'p-web', 'Website redesign', 'WEB-201 Product grid'],
        [2, 380, 'p-app', 'Mobile app', 'APP-71 Push notifications'],
        [3, 455, 'p-web', 'Website redesign', 'WEB-198 Design review'],
        [4, 300, 'p-brand', 'Brand identity', 'Type exploration'],
    ]
        .map(([back, minutes, projectId, project, notes], i) => {
            const date = shiftDays(now, -back);
            if (date < monday) return null;

            return entry({ id: `e-earlier-${i}`, date: dateString(date), minutes, notes, project, project_id: projectId });
        })
        .filter(Boolean);

    const projectStats = {
        'p-web': { total_minutes: 4820, uninvoiced_minutes: 615, budget_pct: 68 },
        'p-app': { total_minutes: 2610, uninvoiced_minutes: 480, budget_pct: 41 },
        'p-brand': { total_minutes: 940, uninvoiced_minutes: 120, budget_pct: null },
    };

    const state = {
        connected: true,
        running,
        projects,
        entries,
        weekStart: dateString(monday),
        weekLocked: false,
        projectStats,
        fetchedAt: now.getTime(),
        pulseToken: 'demo-token',
        skewMs: 0,
        downUntil: null,
        live: true,
    };

    const sheet = {
        entries: [...entries, ...earlier],
        weekStart: dateString(monday),
        weekLocked: false,
        projectStats,
    };

    // A month that looks worked-in: weekdays full, weekends mostly empty.
    const monthByDay = Array.from({ length: 30 }, (_, i) => {
        const day = shiftDays(now, -(29 - i));
        const weekend = day.getDay() === 0 || day.getDay() === 6;
        if (day > now) return 0;

        return weekend ? (i % 7 === 6 ? 95 : 0) : 330 + ((i * 37) % 180);
    });

    const summary = {
        today: 180,
        yesterday: 415,
        this_week: 1550,
        last_week: 2180,
        this_month: 7460,
        last_month: 8920,
        billable_pct_month: 82,
        month_by_day: monthByDay,
        year_by_month: [6100, 7200, 8400, 7900, 8150, 7600, 5200, 6800, 7460, 0, 0, 0],
        uninvoiced_minutes: 1215,
        // Minor units: 486000 reads as 4,860 EUR.
        uninvoiced_amounts: { EUR: 486_000 },
        uninvoiced_total: 486_000,
        base_currency: 'EUR',
        live_included: true,
    };

    const settings = {
        workspace: 'northwind',
        token: 'demo-token',
        user: { name: 'Alex Rivera', email: 'alex@northwind.example' },
        noteFormat: 'identifier_title_url',
        customSites: [],
        idleEnabled: true,
        idleMinutes: 10,
        broadcast: null,
        appearance: 'system',
    };

    const presets = [
        { name: 'Standup', projectId: 'p-app', taskId: 't-build', notes: 'Standup and planning' },
        { name: 'Code review', projectId: 'p-web', taskId: 't-build', notes: 'Review' },
    ];

    return { state, sheet, summary, settings, presets };
}

// ---------------------------------------------------------------------------
// The stub: chrome.* as the popup expects it, backed by the fixtures
// ---------------------------------------------------------------------------

/** Runs inside the page, before any of the extension's own scripts. */
function installStub(data) {
    const { state, sheet, summary, settings, presets, messages } = data;

    const store = { settings, presets, mappings: {}, lastTimer: null };
    const session = {};
    const area = (bag) => ({
        get: async (keys) => {
            if (keys === undefined || keys === null) return { ...bag };
            const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
            const out = {};
            for (const key of list) if (bag[key] !== undefined) out[key] = bag[key];

            return out;
        },
        set: async (values) => Object.assign(bag, values),
        remove: async (keys) => {
            for (const key of typeof keys === 'string' ? [keys] : keys) delete bag[key];
        },
        clear: async () => {
            for (const key of Object.keys(bag)) delete bag[key];
        },
    });

    const answers = {
        'state:get': () => state,
        'state:refresh': () => state,
        'state:pulse': () => ({ token: state.pulseToken, changed: false }),
        'sheet:get': () => sheet,
        'summary:get': () => summary,
        'issue:pending:get': () => null,
        'issue:pending:clear': () => null,
        'page:issue': () => null,
    };

    // The popup reads the clock to decide what "today" is and how long the
    // running timer has been going. Freeze it on the same instant the
    // fixtures were built around.
    const RealDate = Date;
    globalThis.Date = class extends RealDate {
        constructor(...args) {
            super(...(args.length ? args : [data.now]));
        }
        static now() {
            return data.now;
        }
    };

    globalThis.chrome = {
        runtime: {
            id: 'listing-shots',
            getURL: (path) => path,
            getManifest: () => ({ version: '0.0.0', name: 'Zebu' }),
            sendMessage: async (message) => {
                const answer = answers[message?.type];

                return { ok: true, result: answer ? answer(message) : null };
            },
            onMessage: { addListener() {}, removeListener() {} },
            lastError: undefined,
        },
        storage: {
            local: area(store),
            session: area(session),
            sync: area({}),
            onChanged: { addListener() {}, removeListener() {} },
        },
        i18n: {
            getUILanguage: () => data.locale.replace('_', '-'),
            getMessage: (key, subs) => {
                const entry = messages[key];
                if (!entry) return '';
                let text = entry.message;
                const list = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs];
                // Named placeholders resolve to $1-style positions first.
                for (const [name, placeholder] of Object.entries(entry.placeholders ?? {})) {
                    text = text.replace(new RegExp(`\\$${name}\\$`, 'gi'), placeholder.content ?? '');
                }
                text = text.replace(/\$(\d)/g, (_, n) => list[Number(n) - 1] ?? '');

                return text.replace(/\$\$/g, '$');
            },
        },
        permissions: {
            contains: async () => true,
            request: async () => true,
            remove: async () => true,
            getAll: async () => ({ origins: [], permissions: [] }),
        },
        commands: {
            getAll: async () => [
                { name: '_execute_action', description: 'Open Zebu', shortcut: 'Ctrl+Shift+U' },
                { name: 'toggle-timer', description: 'Start or stop the timer', shortcut: 'Ctrl+Shift+Y' },
            ],
        },
        tabs: { create: async () => ({}), query: async () => [], sendMessage: async () => null },
        windows: { create: async () => ({}), getCurrent: async () => ({ id: 1 }) },
        action: { setIcon() {}, setBadgeText() {}, setBadgeBackgroundColor() {} },
        alarms: { create() {}, clear: async () => true, onAlarm: { addListener() {} } },
        idle: { onStateChanged: { addListener() {} }, setDetectionInterval() {} },
        notifications: { create: async () => '', onClicked: { addListener() {} } },
    };
}

// ---------------------------------------------------------------------------
// The shots
// ---------------------------------------------------------------------------

const captions = JSON.parse(readFileSync(join(ROOT, 'scripts', 'listing-captions.json'), 'utf8'));

/**
 * `prepare` runs in the page after it has settled: it clicks the extension's
 * own buttons rather than forcing state, so a shot can only show something a
 * user could actually reach.
 */
const SHOTS = [
    // As the popup opens with a clock running: the header, the week strip and
    // the running row at the top of the day.
    { id: '1-timer', page: 'popup.html', width: 380, settle: 1400 },
    {
        // The same day with nothing running, so the list itself is the subject
        // and every row shows its ▶ to pick the work back up.
        id: '2-day',
        page: 'popup.html',
        width: 380,
        mutate: (data) => {
            data.state.running = null;
            data.state.entries = data.state.entries.map((e) => (e.timer_started_at ? { ...e, timer_started_at: null, minutes: 47 } : e));
            data.sheet.entries = data.sheet.entries.map((e) => (e.timer_started_at ? { ...e, timer_started_at: null, minutes: 47 } : e));
        },
    },
    {
        id: '3-insights',
        page: 'popup.html',
        width: 380,
        prepare: async (page) => {
            const opened = await page.evaluate(() => {
                const chart = document.querySelector('svg.icon-chart')?.closest('button');
                if (!chart) return false;
                chart.click();

                return true;
            });
            if (!opened) throw new Error('could not find the insights button in the popup header');
        },
        settle: 2000,
    },
    // Cropped at a section boundary rather than squeezing the whole page in:
    // the workspace, the note format and idle detection are the parts that
    // say what the extension does.
    { id: '4-options', page: 'options.html', width: 760, height: 520, layout: 'stacked' },
];

// ---------------------------------------------------------------------------
// Composing a 1280 × 800 canvas around a screenshot
// ---------------------------------------------------------------------------

const BRAND = { ground: '#4ca154', ink: '#d0ffc5', deep: '#2f6b36' };

function composerHtml({ image, title, body, layout }) {
    const side = layout !== 'stacked';

    return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @import url('https://fonts.bunny.net/css?family=figtree:400,600,700');
  * { box-sizing: border-box; margin: 0; }
  body {
      width: 1280px; height: 800px; overflow: hidden;
      font-family: Figtree, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: ${BRAND.ink};
      background: radial-gradient(120% 120% at 15% 10%, ${BRAND.ground} 0%, ${BRAND.deep} 100%);
      display: flex; align-items: center; gap: 64px;
      padding: ${side ? '0 88px' : '56px 88px'};
      flex-direction: ${side ? 'row' : 'column'};
      justify-content: ${side ? 'space-between' : 'flex-start'};
  }
  .copy { max-width: ${side ? '460px' : '100%'}; text-align: ${side ? 'left' : 'center'}; }
  h1 { font-size: ${side ? '46px' : '40px'}; line-height: 1.14; font-weight: 700; letter-spacing: -0.02em; }
  p { margin-top: 18px; font-size: ${side ? '21px' : '19px'}; line-height: 1.5; opacity: 0.86; font-weight: 400; }
  .shot { border-radius: 14px; overflow: hidden; box-shadow: 0 30px 70px rgba(0,0,0,0.42), 0 2px 8px rgba(0,0,0,0.3); flex: none; }
  .shot img { display: block; }
</style></head>
<body>
  <div class="copy"><h1>${title}</h1><p>${body}</p></div>
  <div class="shot"><img id="shot" src="${image}"></div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function localeMessages(locale) {
    const path = join(ROOT, '_locales', locale, 'messages.json');
    if (!existsSync(path)) throw new Error(`no _locales/${locale}/messages.json`);

    return JSON.parse(readFileSync(path, 'utf8'));
}

async function shoot(browser, { locale, messages, data, shot }) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(installStub, { ...data, messages, locale, now: NOW.getTime() });
    await page.setViewport({ width: shot.width, height: shot.height ?? 640, deviceScaleFactor: 2 });
    await page.goto(`file://${join(DIST, shot.page)}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('#app, body')?.textContent?.trim().length > 0, { timeout: 10_000 });
    if (shot.prepare) await shot.prepare(page);
    await new Promise((r) => setTimeout(r, shot.settle ?? 900));

    // Photograph exactly as tall as the page turned out to be.
    const height = shot.height ?? (await page.evaluate(() => Math.min(document.body.scrollHeight, 760)));
    await page.setViewport({ width: shot.width, height, deviceScaleFactor: 2 });
    await new Promise((r) => setTimeout(r, 250));
    const png = await page.screenshot({ type: 'png', encoding: 'base64' });
    await page.close();

    return { png: `data:image/png;base64,${png}`, width: shot.width, height };
}

async function compose(browser, { image, caption, layout, out }) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.setContent(composerHtml({ image: image.png, title: caption.title, body: caption.body, layout }), { waitUntil: 'networkidle0' });

    // Fit the shot to the canvas: tall popup shots get the height, the wide
    // options page gets the width.
    await page.evaluate(
        ({ w, h, stacked }) => {
            const img = document.getElementById('shot');
            // The wide options page is deliberately allowed to run off the
            // bottom edge: a panel cut short with a gap under it looks like a
            // mistake, one that bleeds off the canvas reads as "more below".
            const maxH = stacked ? 660 : 680;
            const maxW = stacked ? 980 : 520;
            const scale = Math.min(maxW / w, maxH / h);
            img.style.width = `${Math.round(w * scale)}px`;
            img.style.height = `${Math.round(h * scale)}px`;
        },
        { w: image.width, h: image.height, stacked: layout === 'stacked' },
    );
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: out, type: 'jpeg', quality: 92 });
    await page.close();
}

async function promoTile(browser, { caption, out }) {
    const page = await browser.newPage();
    // Exactly 440 x 280: the Web Store rejects anything else for the tile.
    await page.setViewport({ width: 440, height: 280, deviceScaleFactor: 1 });
    const mark = readFileSync(join(ROOT, 'icons', '128.png')).toString('base64');
    await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><style>
        @import url('https://fonts.bunny.net/css?family=figtree:600,700');
        *{box-sizing:border-box;margin:0}
        body{width:440px;height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;
             font-family:Figtree,-apple-system,sans-serif;color:${BRAND.ink};
             background:radial-gradient(120% 120% at 20% 10%, ${BRAND.deep} 0%, #1f4a25 100%)}
        img{width:84px;height:84px;border-radius:18px;box-shadow:0 10px 26px rgba(0,0,0,.35)}
        h1{font-size:32px;font-weight:700;letter-spacing:-.02em}
        p{font-size:16px;opacity:.85;font-weight:600}
        </style></head><body>
        <img src="data:image/png;base64,${mark}"><h1>Zebu</h1><p>${caption.tile}</p>
        </body></html>`,
        { waitUntil: 'networkidle0' },
    );
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: out, type: 'jpeg', quality: 92 });
    await page.close();
}

async function main() {
    if (!existsSync(join(DIST, 'popup.html'))) {
        console.error('dist/chrome is missing — run `npm run build` first');
        process.exit(1);
    }

    const locales = LOCALE_ARG === 'all' ? readdirSync(join(ROOT, '_locales')).sort() : LOCALE_ARG.split(',').map((l) => l.trim());
    const browser = await puppeteer.launch({
        executablePath: findChrome(),
        headless: true,
        args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars', '--font-render-hinting=none'],
    });

    try {
        for (const locale of locales) {
            const messages = localeMessages(locale);
            const text = captions[locale] ?? captions.en;
            const dir = join(OUT, locale);
            mkdirSync(dir, { recursive: true });

            for (const shot of SHOTS) {
                // Fresh fixtures per shot: `mutate` edits them, and one shot's
                // edits must not leak into the next.
                const data = fixtures();
                shot.mutate?.(data);
                const image = await shoot(browser, { locale, messages, data, shot });
                const out = join(dir, `${shot.id}.jpg`);
                await compose(browser, { image, caption: text[shot.id], layout: shot.layout, out });
                console.log(`${locale}/${shot.id}.jpg  (from a ${image.width}×${image.height} render)`);
            }

            await promoTile(browser, { caption: text, out: join(dir, 'promo-440x280.jpg') });
            console.log(`${locale}/promo-440x280.jpg`);
        }
    } finally {
        await browser.close();
    }

    console.log(`\nDone: ${OUT}`);
    console.log('Chrome Web Store: screenshots must be 1280×800 JPEG or 24-bit PNG, up to five per listing.');
}

await main();
