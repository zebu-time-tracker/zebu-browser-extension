// The workspace address normaliser, the same rules as the desktop app's
// tests/workspace.test.ts (board #270).
import { isWorkspaceName, migrateWorkspaceOrigin, resolveWorkspace, workspaceName, workspaceUrl } from '../src/workspace';

test('a bare name is completed with the hosted domain', () => {
    expect(workspaceUrl('studio')).toBe('https://studio.zebu.work');
    expect(workspaceUrl('  Studio  ')).toBe('https://studio.zebu.work');
    expect(workspaceUrl('my-team')).toBe('https://my-team.zebu.work');
});

test('a host or full URL is reduced to its origin', () => {
    expect(workspaceUrl('studio.zebu.work')).toBe('https://studio.zebu.work');
    expect(workspaceUrl('Studio.Zebu.Work/login?x=1#y')).toBe('https://studio.zebu.work');
    expect(workspaceUrl('https://studio.zebu.work/')).toBe('https://studio.zebu.work');
    expect(workspaceUrl('https://studio.zebu.work/time')).toBe('https://studio.zebu.work');
});

test('the old {sub}.app.zebu.work layout is never produced for bare names', () => {
    expect(workspaceUrl('studio').includes('.app.zebu.work')).toBe(false);
    expect(workspaceUrl('studio').includes('zebu.app')).toBe(false);
});

test('plain http is fine for loopback hosts, refused elsewhere', () => {
    expect(workspaceUrl('http://127.0.0.1:8003/')).toBe('http://127.0.0.1:8003');
    expect(workspaceUrl('http://localhost:8000')).toBe('http://localhost:8000');
    expect(workspaceUrl('http://zebu.localhost')).toBe('http://zebu.localhost');
    expect(workspaceUrl('http://studio.zebu.test')).toBe('http://studio.zebu.test');
    expect(resolveWorkspace('http://studio.zebu.work')).toEqual({ ok: false, reason: 'insecure' });
    expect(workspaceUrl('http://studio.zebu.work', { allowInsecure: true })).toBe('http://studio.zebu.work');
});

test('the central site is not a workspace', () => {
    for (const input of ['zebu.work', 'app.zebu.work', 'https://app.zebu.work/login', 'www.zebu.work']) {
        expect(resolveWorkspace(input), input).toEqual({ ok: false, reason: 'central' });
    }
});

test('junk is rejected', () => {
    expect(resolveWorkspace('')).toEqual({ ok: false, reason: 'empty' });
    expect(resolveWorkspace('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(resolveWorkspace('stu dio')).toEqual({ ok: false, reason: 'invalid' });
    expect(resolveWorkspace('ftp://studio.zebu.work')).toEqual({ ok: false, reason: 'invalid' });
    expect(resolveWorkspace('https://user:pw@studio.zebu.work')).toEqual({ ok: false, reason: 'invalid' });
    expect(resolveWorkspace('http://')).toEqual({ ok: false, reason: 'invalid' });
});

test('stored origins from the old layout migrate to zebu.work', () => {
    expect(migrateWorkspaceOrigin('https://studio.app.zebu.work')).toBe('https://studio.zebu.work');
    expect(migrateWorkspaceOrigin('https://studio.zebu.work')).toBe('https://studio.zebu.work');
    expect(migrateWorkspaceOrigin('http://127.0.0.1:8003')).toBe('http://127.0.0.1:8003');
});

test('the workspace field takes a name, and reduces whatever was pasted to one', () => {
    expect(workspaceName('studio')).toBe('studio');
    expect(workspaceName('  Studio ')).toBe('studio');
    expect(workspaceName('studio.zebu.work')).toBe('studio');
    expect(workspaceName('https://Studio.zebu.work/login?x=1')).toBe('studio');
    expect(workspaceName('my-team.zebu.work')).toBe('my-team');
});

test('a name is letters, digits and dashes, and never the central site', () => {
    expect(isWorkspaceName('studio')).toBe(true);
    expect(isWorkspaceName('my-team2')).toBe(true);
    expect(isWorkspaceName('')).toBe(false);
    expect(isWorkspaceName('stu dio')).toBe(false);
    expect(isWorkspaceName('studio.zebu.work')).toBe(false);
    expect(isWorkspaceName('app')).toBe(false);
    expect(isWorkspaceName('www')).toBe(false);
});
