// The project picker's client grouping, the same rules as the desktop's tests/picker.test.ts.
import { groupByClient } from '../src/picker';
import type { ProjectOption } from '../src/types';

const project = (id: string, client: string | null): ProjectOption => ({ id, name: id, code: null, client, tasks: [] });

test('a client group sits where its best-ranked project ranked, and keeps that order inside', () => {
    const groups = groupByClient([project('a1', 'Acme'), project('b1', 'Bob'), project('a2', 'Acme'), project('b2', 'Bob')]);

    expect(groups.map((g) => [g.client, g.projects.map((p) => p.id)])).toEqual([
        ['Acme', ['a1', 'a2']],
        ['Bob', ['b1', 'b2']],
    ]);
});

test('offsets index the flattened rows, so keyboard navigation walks the groups as rendered', () => {
    const groups = groupByClient([project('a1', 'Acme'), project('b1', 'Bob'), project('a2', 'Acme')]);
    const rows = groups.flatMap((g) => g.projects);

    expect(groups.map((g) => g.offset)).toEqual([0, 2]);
    expect(rows.map((p) => p.id)).toEqual(['a1', 'a2', 'b1']);
    for (const g of groups) for (const [i, p] of g.projects.entries()) expect(rows[g.offset + i]).toBe(p);
});

test('projects without a client land in one group of their own', () => {
    const groups = groupByClient([project('loose', null), project('a1', 'Acme'), project('other', null)]);

    expect(groups.map((g) => [g.client, g.projects.map((p) => p.id)])).toEqual([
        ['', ['loose', 'other']],
        ['Acme', ['a1']],
    ]);
});

test('no projects means no groups', () => {
    expect(groupByClient([])).toEqual([]);
});
