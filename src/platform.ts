// What this build is running on, and what that browser cannot do.
//
// One code base ships to Chrome, Firefox and Safari (board #287). The
// differences that matter are small and known, so they live here as plain
// facts rather than as `typeof chrome.x` sniffing scattered through the
// worker: build.mjs bakes `__TARGET__` in, and everything else asks these
// functions. Each takes the target as an argument so the decisions can be
// tested for all three browsers from one test file.

declare const __TARGET__: string | undefined;

export type Target = 'chrome' | 'firefox' | 'safari';

export const TARGET: Target = typeof __TARGET__ === 'string' && isTarget(__TARGET__) ? __TARGET__ : 'chrome';

export function isTarget(value: string): value is Target {
    return value === 'chrome' || value === 'firefox' || value === 'safari';
}

/**
 * Whether the browser watches the machine for idleness (chrome.idle). Safari
 * has no idle API at all; the manifest for it does not even ask for the
 * permission, so the worker must not register the listener there.
 */
export const hasIdle = (target: Target = TARGET): boolean => target !== 'safari';

/**
 * Whether the browser shows notifications from an extension. Safari does not,
 * which together with the missing idle API means the idle prompt is simply a
 * Chrome and Firefox feature; the options page hides its switch elsewhere.
 */
export const hasNotifications = (target: Target = TARGET): boolean => target !== 'safari';

/**
 * Whether a notification may carry buttons. Firefox rejects the whole
 * notification when `buttons` is present rather than ignoring the field, so
 * on Firefox the idle prompt is shown without them: clicking it adds the idle
 * time as a new entry, closing it keeps the time (board #333).
 */
export const hasNotificationButtons = (target: Target = TARGET): boolean => target === 'chrome';

/** The options for a notification, with the buttons only where they are allowed. */
export function notificationOptions<T extends object>(base: T, buttons: { title: string }[], target: Target = TARGET): T & { buttons?: { title: string }[] } {
    return hasNotificationButtons(target) ? { ...base, buttons } : { ...base };
}

/**
 * Whether the workspace host permission has to be asked for at runtime.
 * Chrome grants `host_permissions` at install; Firefox treats every MV3 host
 * permission as optional until the user says yes, so the options page asks
 * when connecting (inside the click, as the API requires).
 */
export const hostPermissionIsOptional = (target: Target = TARGET): boolean => target === 'firefox';

/** Where the shortcuts can be changed; only Chrome has a page for it. */
export const shortcutsPage = (target: Target = TARGET): string | null => (target === 'chrome' ? 'chrome://extensions/shortcuts' : null);
