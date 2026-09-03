import { ADAPTERS, adapterFor } from '../src/content/adapters';

const detect = (id: string, href: string, title: string, html = '') => {
    document.title = title;
    document.body.innerHTML = html;
    const adapter = ADAPTERS.find((a) => a.id === id)!;
    return adapter.detect(new URL(href), document);
};

test('hosts map to adapters, custom origins override', () => {
    expect(adapterFor('github.com')?.id).toBe('github');
    expect(adapterFor('acme.atlassian.net')?.id).toBe('jira');
    expect(adapterFor('git.example.com')).toBeNull();
    expect(adapterFor('git.example.com', [{ origin: 'https://git.example.com', adapter: 'gitlab' }], 'https://git.example.com')?.id).toBe('gitlab');
});

test('github issues and pull requests, from the DOM or the tab title', () => {
    const fromDom = detect('github', 'https://github.com/acme/api/issues/123?foo=1', 'ignored', '<h1><bdi class="js-issue-title">Fix login</bdi></h1>');
    expect(fromDom).toMatchObject({ site: 'github', key: 'github:acme/api#123', container: 'acme/api', identifier: '#123', title: 'Fix login', url: 'https://github.com/acme/api/issues/123' });
    expect(fromDom?.containerHints).toEqual(['api', 'acme']);

    const fromTitle = detect('github', 'https://github.com/acme/api/pull/7', 'Speed up CI · Pull Request #7 · acme/api');
    expect(fromTitle).toMatchObject({ key: 'github:acme/api#7', title: 'Speed up CI' });

    expect(detect('github', 'https://github.com/acme/api/tree/main', 'acme/api')).toBeNull();
});

test('gitlab issues and merge requests, including nested groups', () => {
    const issue = detect('gitlab', 'https://gitlab.com/group/sub/project/-/issues/42', 'Broken export (#42) · Issues · group / sub / project · GitLab');
    expect(issue).toMatchObject({ key: 'gitlab:group/sub/project#42', container: 'group/sub/project', identifier: '#42', title: 'Broken export' });
    expect(issue?.containerHints[0]).toBe('project');

    const mr = detect('gitlab', 'https://gitlab.com/group/project/-/merge_requests/9/diffs', 'x', '<h1 class="title">Add SEPA</h1>');
    expect(mr).toMatchObject({ identifier: '!9', title: 'Add SEPA' });
});

test('jira keys from the browse URL or the board selection', () => {
    const browse = detect('jira', 'https://acme.atlassian.net/browse/BILL-12', '[BILL-12] Refund rounding - Jira');
    expect(browse).toMatchObject({ key: 'jira:acme:BILL-12', identifier: 'BILL-12', container: 'BILL', title: 'Refund rounding', url: 'https://acme.atlassian.net/browse/BILL-12' });
    expect(browse?.containerHints).toEqual(['BILL', 'acme']);

    const board = detect('jira', 'https://acme.atlassian.net/jira/software/projects/BILL/boards/1?selectedIssue=BILL-13', 'Board - Jira');
    expect(board?.identifier).toBe('BILL-13');
});

test('linear, trello, bitbucket, asana, clickup and basecamp', () => {
    expect(detect('linear', 'https://linear.app/zebu/issue/ZEB-101/fix-the-thing', 'ZEB-101 Fix the thing – Linear')).toMatchObject({
        key: 'linear:zebu:ZEB-101',
        container: 'ZEB',
        identifier: 'ZEB-101',
        title: 'Fix the thing',
    });

    expect(detect('trello', 'https://trello.com/c/abc123/45-write-docs', 'Write docs on Marketing | Trello')).toMatchObject({
        key: 'trello:abc123',
        container: 'Marketing',
        identifier: '#45',
        title: 'Write docs',
    });

    expect(detect('bitbucket', 'https://bitbucket.org/acme/api/pull-requests/3/overview', 'Pull Request #3: Tidy up — Bitbucket')).toMatchObject({
        key: 'bitbucket:acme/api#3',
        identifier: '#3',
        title: 'Tidy up',
    });

    expect(
        detect('asana', 'https://app.asana.com/0/1200/1201', 'x', '<textarea class="TaskName-input">Draft proposal</textarea><span class="TaskProjectToken-projectName">Globex site</span>'),
    ).toMatchObject({ key: 'asana:1201', container: 'Globex site', title: 'Draft proposal', identifier: '' });

    expect(detect('clickup', 'https://app.clickup.com/t/86abc', 'x', '<a class="breadcrumbs__link">Acme</a><a class="breadcrumbs__link">Sprint 4</a><div class="task-name__overlay">Ship it</div>')).toMatchObject({
        key: 'clickup:86abc',
        container: 'Sprint 4',
        containerHints: ['Acme'],
        title: 'Ship it',
    });

    expect(detect('basecamp', 'https://3.basecamp.com/999/buckets/12/todos/34', 'x', '<h1 class="perma-title">Order stickers</h1><span class="project-header__title">Launch</span>')).toMatchObject({
        key: 'basecamp:999/12/34',
        container: 'Launch',
        title: 'Order stickers',
    });
});
