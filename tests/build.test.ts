import { describe, expect, test } from 'vitest';
import chromeOverlay from '../browsers/chrome.json';
import firefoxOverlay from '../browsers/firefox.json';
import safariOverlay from '../browsers/safari.json';
import base from '../manifest.base.json';
// @ts-expect-error plain ESM without types: the build script's own module
import { manifestFor, packageName, TARGETS } from '../scripts/manifest.mjs';

// One source, three manifests (board #287). These read the real
// manifest.base.json and browsers/*.json, so a change to either that would
// ship a broken store package fails here before it is packaged.

const overlays: Record<string, object> = { chrome: chromeOverlay, firefox: firefoxOverlay, safari: safariOverlay };
const build = (target: string) => manifestFor(target, base, overlays[target], '1.2.3');

describe('the manifest for each browser', () => {
    test('every target stamps the package version and keeps the shared shape', () => {
        for (const target of TARGETS) {
            const m = build(target);
            expect(m.version).toBe('1.2.3');
            expect(m.manifest_version).toBe(3);
            expect(m.action.default_popup).toBe('popup.html');
            expect(m.options_page).toBe('options.html');
            expect(m.content_scripts[0].js).toEqual(['content.js']);
            expect(m.permissions).toContain('storage');
            expect(m.host_permissions).toEqual(['https://*.zebu.work/*']);
        }
    });

    test('chrome runs a service worker and names its minimum version', () => {
        const m = build('chrome');
        expect(m.background).toEqual({ service_worker: 'background.js' });
        expect(m.minimum_chrome_version).toBe('120');
        expect(m.browser_specific_settings).toBeUndefined();
        expect(m.permissions).toContain('idle');
        expect(m.permissions).toContain('notifications');
    });

    test('firefox runs an event page, carries its gecko id and updates from addons.mozilla.org', () => {
        const m = build('firefox');
        expect(m.background).toEqual({ scripts: ['background.js'] });
        expect(m.background.service_worker).toBeUndefined();
        expect(m.minimum_chrome_version).toBeUndefined();
        expect(m.browser_specific_settings.gecko.id).toBe('extension@zebu.work');
        // The listing on AMO is where Firefox updates from; the linter rejects a
        // listed package that names its own update_url (MANIFEST_UPDATE_URL), and
        // the gecko id is what ties the copies installed from our bucket to it.
        expect(m.browser_specific_settings.gecko.update_url).toBeUndefined();
        expect(Number(m.browser_specific_settings.gecko.strict_min_version.split('.')[0])).toBeGreaterThanOrEqual(128);
    });

    test('safari asks for no permission it cannot use', () => {
        const m = build('safari');
        expect(m.permissions).not.toContain('idle');
        expect(m.permissions).not.toContain('notifications');
        expect(m.permissions).toEqual(expect.arrayContaining(['storage', 'alarms', 'scripting', 'activeTab', 'contextMenus']));
        expect(m.browser_specific_settings.safari.strict_min_version).toBe('17.0');
    });

    test('the base is not changed by building an overlay', () => {
        const before = JSON.stringify(base);
        build('safari');
        build('firefox');
        expect(JSON.stringify(base)).toBe(before);
    });

    test('an unknown target or a non-semver version is refused', () => {
        expect(() => manifestFor('edge', base, {}, '1.0.0')).toThrow(/unknown target/);
        expect(() => manifestFor('chrome', base, {}, 'v1.0')).toThrow(/X\.Y\.Z/);
    });

    test('packages are named for their target and version', () => {
        expect(packageName('firefox', '0.3.0')).toBe('zebu-firefox-0.3.0.zip');
        expect(packageName('firefox', '0.3.0', 'xpi')).toBe('zebu-firefox-0.3.0.xpi');
    });
});

// What is actually in icons/, enumerated by the bundler rather than read
// from disk, so this needs no filesystem types.
const shipped = new Set(Object.keys(import.meta.glob('../icons/*.png')).map((path) => path.replace('../', '')));

describe('the icons the manifest promises', () => {
    // A manifest that names a file Chrome cannot find shows a blank square in
    // the toolbar and says nothing about it, on every browser, silently.
    test('every icon the manifest names is a real file', () => {
        for (const target of TARGETS) {
            const m = build(target);
            for (const path of [...Object.values(m.action.default_icon ?? {}), ...Object.values(m.icons ?? {})]) {
                expect(shipped.has(path as string), `${target}: ${path}`).toBe(true);
            }
        }
    });

    test('the toolbar starts on the hollow mark, so a filled square only ever means a timer', () => {
        // Board #353: the icon Chrome shows before the worker wakes is the
        // same one the worker sets while nothing runs.
        expect(build('chrome').action.default_icon).toEqual({
            16: 'icons/idle-16.png',
            32: 'icons/idle-32.png',
            48: 'icons/idle-48.png',
        });
    });
});
