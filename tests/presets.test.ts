import { defaultPresetName, filterPresets, hasPreset, newPresetId, presetRows, presetsFor, readPresets, removePreset, renamePreset, savePreset, type Preset } from '../src/presets';
import type { ProjectOption } from '../src/types';

const preset = (over: Partial<Preset> = {}): Preset => ({ id: 'p1', name: 'Website', project_id: 'proj-1', task_id: '', workspace: 'https://studio.zebu.work', ...over });
const project = (over: Partial<ProjectOption> = {}): ProjectOption => ({ id: 'proj-1', name: 'Website', code: null, client: null, tasks: [], ...over });
const ids = () => {
    let n = 0;
    return () => `id-${++n}`;
};

test('stored presets are read back defensively', () => {
    expect(readPresets(undefined)).toEqual([]);
    expect(readPresets('[]')).toEqual([]);
    expect(readPresets([null, 7, {}, { id: 'p1' }, { id: 'p1', name: 'x' }, { name: 'x', project_id: 'a' }])).toEqual([]);
    expect(readPresets([{ id: 'p1', name: ' Website ', project_id: 'proj-1' }])).toEqual([{ id: 'p1', name: 'Website', project_id: 'proj-1', task_id: '', workspace: '' }]);
});

test('a preset only counts on the workspace it was saved from, and the others are kept', () => {
    const all = [preset(), preset({ id: 'p2', workspace: 'https://other.zebu.work' })];
    expect(presetsFor(all, 'https://studio.zebu.work').map((p) => p.id)).toEqual(['p1']);
    expect(presetsFor(all, 'https://other.zebu.work').map((p) => p.id)).toEqual(['p2']);
    expect(presetsFor(all, 'https://nobody.zebu.work')).toEqual([]);
    expect(all).toHaveLength(2);
});

test('the same project and task is the same starting point, so saving it twice changes nothing', () => {
    const list = [preset()];
    const same = { name: 'Renamed by hand', project_id: 'proj-1', task_id: '', workspace: 'https://studio.zebu.work' };
    expect(hasPreset(list, same)).toBe(true);
    expect(savePreset(list, same, ids())).toBe(list);
    for (const draft of [{ ...same, task_id: 'task-1' }, { ...same, project_id: 'proj-2' }, { ...same, workspace: 'https://other.zebu.work' }]) {
        expect(hasPreset(list, draft)).toBe(false);
        expect(savePreset(list, draft, ids())).toHaveLength(2);
    }
});

test('saving appends a named preset and refuses a nameless or projectless one', () => {
    expect(savePreset([], { name: '  Design  ', project_id: 'proj-9', task_id: 'task-3', workspace: 'w' }, ids())).toEqual([{ id: 'id-1', name: 'Design', project_id: 'proj-9', task_id: 'task-3', workspace: 'w' }]);
    expect(savePreset([], { name: '   ', project_id: 'proj-9', task_id: '', workspace: 'w' }, ids())).toEqual([]);
    expect(savePreset([], { name: 'Design', project_id: '', task_id: '', workspace: 'w' }, ids())).toEqual([]);
});

test('renaming trims, an empty name leaves the row as it was, deleting takes only the row asked for', () => {
    const list = [preset(), preset({ id: 'p2', name: 'Other' })];
    expect(renamePreset(list, 'p1', '  Client calls  ').map((p) => p.name)).toEqual(['Client calls', 'Other']);
    expect(renamePreset(list, 'p1', '   ')).toBe(list);
    expect(removePreset(list, 'p1').map((p) => p.id)).toEqual(['p2']);
    expect(removePreset(list, 'gone')).toEqual(list);
    expect(newPresetId()).not.toBe(newPresetId());
});

test('a fresh preset is named after its project, and its task when it has one', () => {
    const withTasks = project({ tasks: [{ id: 'task-1', name: 'Design' }] });
    expect(defaultPresetName(withTasks, '')).toBe('Website');
    expect(defaultPresetName(withTasks, 'task-1')).toBe('Website · Design');
    expect(defaultPresetName(withTasks, 'task-gone')).toBe('Website');
    expect(defaultPresetName(null, 'task-1')).toBe('');
});

test('a row reads its client, code, project and task from the live project list, or says the project is gone', () => {
    const rows = presetRows([preset({ task_id: 'task-1' })], [project({ code: 'ACME-1', client: 'Acme', tasks: [{ id: 'task-1', name: 'Design' }] })]);
    expect(rows[0]).toMatchObject({ subtitle: 'Acme · ACME-1: Website · Design', missing: false });
    expect(rows[0].preset.name).toBe('Website');
    expect(presetRows([preset()], [project({ id: 'somewhere-else' })])[0]).toMatchObject({ missing: true, subtitle: '' });
});

test('searching matches the name the user gave and what the row resolves to', () => {
    const rows = presetRows(
        [preset({ id: 'p1', name: 'Morning standup', project_id: 'proj-1' }), preset({ id: 'p2', name: 'Invoices', project_id: 'proj-2' })],
        [project({ id: 'proj-1', name: 'Website', client: 'Acme' }), project({ id: 'proj-2', name: 'Bookkeeping', client: 'Beta Co' })],
    );
    expect(filterPresets(rows, 'stand').map((r) => r.preset.id)).toEqual(['p1']);
    expect(filterPresets(rows, 'beta').map((r) => r.preset.id)).toEqual(['p2']);
    expect(filterPresets(rows, 'nothing here')).toEqual([]);
    expect(filterPresets(rows, '  ')).toHaveLength(2);
});
