import { durationToSave, isApplePlatform, isSaveShortcut, saveShortcutHint, type KeyPress } from '../src/entryForm';

const press = (key: string, mods: Partial<Omit<KeyPress, 'key'>> = {}): KeyPress => ({ key, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, ...mods });

test('a running timer at 0:00 saves its notes without sending a duration (board #398)', () => {
    expect(durationToSave({ typed: '0:00', opened: '0:00', mode: 'running', today: true })).toEqual({ ok: true, minutes: null });
    // cleared, it still leaves the clock alone
    expect(durationToSave({ typed: '', opened: '0:12', mode: 'running', today: true })).toEqual({ ok: true, minutes: null });
    // untouched on a timer opened yesterday, too
    expect(durationToSave({ typed: '1:05', opened: '1:05', mode: 'running', today: false })).toEqual({ ok: true, minutes: null });
});

test('a duration typed into a running timer is sent, zero included, and nonsense is refused', () => {
    expect(durationToSave({ typed: '1:30', opened: '0:00', mode: 'running', today: true })).toEqual({ ok: true, minutes: 90 });
    expect(durationToSave({ typed: '0', opened: '0:20', mode: 'running', today: true })).toEqual({ ok: true, minutes: 0 });
    expect(durationToSave({ typed: 'soon', opened: '0:00', mode: 'running', today: true })).toEqual({ ok: false });
});

test('a stopped entry is still refused a duration of nothing', () => {
    expect(durationToSave({ typed: '0:00', opened: '1:00', mode: 'stopped', today: true })).toEqual({ ok: false });
    expect(durationToSave({ typed: '0:00', opened: '0:00', mode: 'stopped', today: true })).toEqual({ ok: false });
    expect(durationToSave({ typed: 'abc', opened: '1:00', mode: 'stopped', today: true })).toEqual({ ok: false });
});

test('a stopped entry sends only a changed duration', () => {
    expect(durationToSave({ typed: '1:00', opened: '1:00', mode: 'stopped', today: true })).toEqual({ ok: true, minutes: null });
    expect(durationToSave({ typed: '1:15', opened: '1:00', mode: 'stopped', today: false })).toEqual({ ok: true, minutes: 75 });
});

test('a new entry starts a timer today, logs a block otherwise, and refuses a zero block', () => {
    expect(durationToSave({ typed: '', opened: '', mode: 'new', today: true })).toEqual({ ok: true, minutes: null });
    expect(durationToSave({ typed: '', opened: '', mode: 'new', today: false })).toEqual({ ok: false });
    expect(durationToSave({ typed: '45m', opened: '', mode: 'new', today: false })).toEqual({ ok: true, minutes: 45 });
    expect(durationToSave({ typed: '0:00', opened: '', mode: 'new', today: true })).toEqual({ ok: false });
});

test('⌘↵ saves on a Mac and Ctrl+↵ elsewhere; a plain Enter is a newline', () => {
    expect(isSaveShortcut(press('Enter', { metaKey: true }), true)).toBe(true);
    expect(isSaveShortcut(press('Enter', { ctrlKey: true }), false)).toBe(true);
    expect(isSaveShortcut(press('Enter'), true)).toBe(false);
    expect(isSaveShortcut(press('Enter'), false)).toBe(false);
    // the other platform's modifier is not it
    expect(isSaveShortcut(press('Enter', { ctrlKey: true }), true)).toBe(false);
    expect(isSaveShortcut(press('Enter', { metaKey: true }), false)).toBe(false);
    expect(isSaveShortcut(press('Enter', { metaKey: true, altKey: true }), true)).toBe(false);
    expect(isSaveShortcut(press('s', { metaKey: true }), true)).toBe(false);
    // Enter confirming an input method's candidate is not a save
    expect(isSaveShortcut(press('Enter', { metaKey: true, isComposing: true }), true)).toBe(false);
});

test('the hint follows the platform and the locale', () => {
    expect(isApplePlatform('MacIntel')).toBe(true);
    expect(isApplePlatform('macOS')).toBe(true);
    expect(isApplePlatform('Win32')).toBe(false);
    expect(isApplePlatform('Linux x86_64')).toBe(false);
    expect(saveShortcutHint(true, 'Ctrl')).toBe('⌘↵');
    expect(saveShortcutHint(false, 'Strg')).toBe('Strg+↵');
});
