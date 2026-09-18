import { composeNotes, dice, entryMatchesIssue, mappingKey, normalize, remember, suggest, tokens } from '../src/suggest';
import type { Issue, ProjectOption } from '../src/types';

const issue: Issue = {
    site: 'github',
    key: 'github:acme-corp/billing-api#123',
    container: 'acme-corp/billing-api',
    containerHints: ['billing-api', 'acme-corp'],
    identifier: '#123',
    title: 'Fix VAT rounding on credit notes',
    url: 'https://github.com/acme-corp/billing-api/issues/123',
};

const projects: ProjectOption[] = [
    { id: 'p1', name: 'Website redesign', code: null, client: 'Globex', tasks: [] },
    { id: 'p2', name: 'Billing API', code: null, client: 'Acme Corp', tasks: [{ id: 't1', name: 'Development' }] },
    { id: 'p3', name: 'Internal', code: null, client: null, tasks: [] },
    { id: 'p4', name: 'Acme retainer', code: null, client: 'Acme Corp', tasks: [] },
];

test('normalize splits camelCase, kebab and paths into plain words', () => {
    expect(normalize('acme-corp/BillingApi_v2')).toBe('acme corp billing api v2');
    expect(tokens('The Acme Corp — billing project')).toEqual(['acme', 'corp', 'billing']);
});

test('dice is 1 for identical strings and small for unrelated ones', () => {
    expect(dice('billing api', 'Billing API')).toBe(1);
    expect(dice('billing api', 'website redesign')).toBeLessThan(0.2);
});

test('the repo name finds the matching project by name and client', () => {
    const ranked = suggest(issue, projects, {});
    expect(ranked[0].project.id).toBe('p2');
    expect(ranked[0].reason).toBe('name');
    expect(ranked[0].score).toBeGreaterThan(0.45);
    // The other Acme project comes next thanks to the org hint; unrelated ones are "recent"-only.
    expect(ranked[1].project.id).toBe('p4');
    expect(ranked.find((s) => s.project.id === 'p1')?.reason).toBe('recent');
});

test('a remembered choice beats any name match and carries its task', () => {
    const mappings = remember({}, issue, 'p3', null);
    const ranked = suggest(issue, projects, mappings);
    expect(ranked[0].project.id).toBe('p3');
    expect(ranked[0].reason).toBe('remembered');
    expect(mappings[mappingKey(issue)].count).toBe(1);
    expect(remember(mappings, issue, 'p3', 't1')[mappingKey(issue)].count).toBe(2);
    // Switching projects resets the count.
    expect(remember(mappings, issue, 'p2', null)[mappingKey(issue)].count).toBe(1);
});

test('without an issue, recently used projects come first, then alphabetical', () => {
    const ranked = suggest(null, projects, {}, ['p3', 'p1']);
    expect(ranked.map((s) => s.project.id)).toEqual(['p3', 'p1', 'p4', 'p2']);
});

test('notes carry identifier, title and link by default', () => {
    expect(composeNotes(issue, 'identifier_title_url')).toBe('#123 Fix VAT rounding on credit notes\nhttps://github.com/acme-corp/billing-api/issues/123');
    expect(composeNotes(issue, 'title_url')).toBe('Fix VAT rounding on credit notes\nhttps://github.com/acme-corp/billing-api/issues/123');
    expect(composeNotes(issue, 'title')).toBe('Fix VAT rounding on credit notes');
});

test('a running entry is recognised as this issue by its link', () => {
    expect(entryMatchesIssue(composeNotes(issue, 'identifier_title_url'), issue)).toBe(true);
    expect(entryMatchesIssue('#123 Fix VAT rounding on credit notes', issue)).toBe(true);
    expect(entryMatchesIssue('Something else entirely', issue)).toBe(false);
    expect(entryMatchesIssue(null, issue)).toBe(false);
});
