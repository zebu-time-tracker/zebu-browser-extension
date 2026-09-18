import { cleanSelection, pageIssue, siteOf, withSelection } from '../src/page';
import { composeNotes, entryMatchesIssue, mappingKey } from '../src/suggest';
import type { Issue } from '../src/types';

test('a plain web page becomes an issue keyed on its site', () => {
    const issue = pageIssue({ url: 'https://www.acme.io/docs/billing?tab=2#top', title: 'Billing — Acme docs' });
    expect(issue).toMatchObject({
        site: 'page',
        key: 'page:https://www.acme.io/docs/billing',
        container: 'acme.io',
        identifier: '',
        title: 'Billing — Acme docs',
        url: 'https://www.acme.io/docs/billing?tab=2',
    });
    expect(issue?.containerHints).toEqual(['acme', 'Billing — Acme docs']);
    expect(mappingKey(issue!)).toBe('page:acme io');
});

test('the selection is the title, collapsed and capped', () => {
    const issue = pageIssue({ url: 'https://example.com/a', title: 'Example', selection: '  Fix the\n  VAT   rounding  ' });
    expect(issue?.title).toBe('Fix the VAT rounding');
    expect(composeNotes(issue!, 'identifier_title_url')).toBe('Fix the VAT rounding\nhttps://example.com/a');
    expect(composeNotes(issue!, 'title')).toBe('Fix the VAT rounding');

    const capped = cleanSelection('x'.repeat(300));
    expect(capped.length).toBe(200);
    expect(capped.endsWith('…')).toBe(true);
});

test('what is not a web page gives nothing; a bare host is its own title', () => {
    expect(pageIssue({ url: 'chrome://extensions', title: 'Extensions' })).toBeNull();
    expect(pageIssue({ url: 'not a url', title: '' })).toBeNull();
    expect(siteOf('file:///tmp/a.html')).toBe('');
    expect(pageIssue({ url: 'https://localhost:8003/time', title: '' })).toMatchObject({ title: 'localhost', containerHints: [] });
});

test('a selection overrides a tracker issue title but keeps its identity', () => {
    const tracker: Issue = { site: 'github', key: 'github:acme/api#1', container: 'acme/api', containerHints: [], identifier: '#1', title: 'Original', url: 'https://github.com/acme/api/issues/1' };
    expect(withSelection(tracker, ' chosen words ')).toMatchObject({ key: 'github:acme/api#1', identifier: '#1', title: 'chosen words' });
    expect(withSelection(tracker, '   ')).toBe(tracker);
    expect(withSelection(null, 'x')).toBeNull();
    expect(entryMatchesIssue('#1 chosen words\nhttps://github.com/acme/api/issues/1', withSelection(tracker, 'chosen words')!)).toBe(true);
});
