import { describe, expect, test } from 'vitest';
import { hasIdle, hasNotificationButtons, hasNotifications, hostPermissionIsOptional, isTarget, notificationOptions, shortcutsPage, TARGET } from '../src/platform';

// What each browser can do (board #287): the decisions the worker and the
// options page make, checked for all three targets from one place.

describe('what each browser can do', () => {
    test('the test build counts as chrome', () => {
        expect(TARGET).toBe('chrome');
        expect(isTarget('edge')).toBe(false);
    });

    test('safari has neither idle detection nor notifications', () => {
        expect(hasIdle('safari')).toBe(false);
        expect(hasNotifications('safari')).toBe(false);
        expect(hasIdle('chrome')).toBe(true);
        expect(hasIdle('firefox')).toBe(true);
        expect(hasNotifications('firefox')).toBe(true);
    });

    test('only chrome may put buttons on a notification', () => {
        const base = { type: 'basic', title: 'Away for 12 minutes', message: 'Keep the time?' };
        const buttons = [{ title: 'Remove' }, { title: 'Remove and stop' }];
        expect(notificationOptions(base, buttons, 'chrome')).toEqual({ ...base, buttons });
        // Firefox rejects the whole notification when the field is present
        expect(notificationOptions(base, buttons, 'firefox')).toEqual(base);
        expect('buttons' in notificationOptions(base, buttons, 'firefox')).toBe(false);
        expect(hasNotificationButtons('safari')).toBe(false);
    });

    test('firefox has to be asked for the workspace host, chrome was at install', () => {
        expect(hostPermissionIsOptional('firefox')).toBe(true);
        expect(hostPermissionIsOptional('chrome')).toBe(false);
        expect(hostPermissionIsOptional('safari')).toBe(false);
    });

    test('only chrome has a page where shortcuts are changed', () => {
        expect(shortcutsPage('chrome')).toBe('chrome://extensions/shortcuts');
        expect(shortcutsPage('firefox')).toBeNull();
        expect(shortcutsPage('safari')).toBeNull();
    });
});
