import { lastTimerFor, lastTimerFrom, resumeLabelKey, resumeWork } from '../src/lastTimer';
import type { Entry, ProjectOption } from '../src/types';

const entry: Entry = { id: 'e1', date: '2026-09-18', minutes: 5, notes: 'Footer', project: 'Billing API', project_id: 'p2', task: 'Development', task_id: 't1', is_billable: true, locked: false, timer_started_at: null };

test('an entry is remembered with its workspace, and read back only there', () => {
    const last = lastTimerFrom(entry, 'https://studio.zebu.work');
    expect(last).toMatchObject({ entry_id: 'e1', project_id: 'p2', task_id: 't1', notes: 'Footer', project: 'Billing API', task: 'Development', date: '2026-09-18', workspace: 'https://studio.zebu.work' });
    expect(lastTimerFor(last, 'https://studio.zebu.work')).toEqual(last);
    expect(lastTimerFor(last, 'https://other.zebu.work')).toBeNull();
    expect(lastTimerFor(last, '')).toBeNull();
});

test('junk in storage is nothing to resume', () => {
    expect(lastTimerFor(null, 'w')).toBeNull();
    expect(lastTimerFor('x', 'w')).toBeNull();
    expect(lastTimerFor({ entry_id: 'e1' }, 'w')).toBeNull();
    expect(lastTimerFor({ entry_id: 'e1', project_id: 'p', date: '2026-09-18', workspace: 'w', task_id: 7 }, 'w')).toMatchObject({ task_id: null, notes: null });
});

test('the bar resumes a timer from today and starts afresh on an older one (board #361)', () => {
    expect(resumeLabelKey({ date: '2026-09-22' }, '2026-09-22')).toBe('popup_resume');
    expect(resumeLabelKey({ date: '2026-09-18' }, '2026-09-22')).toBe('popup_start_new_timer');
});

const projects: ProjectOption[] = [{ id: 'p2', name: 'Billing API', code: null, client: 'Acme Corp', tasks: [] }];

test('the client is remembered from the project list (board #411)', () => {
    expect(lastTimerFrom(entry, 'w', projects).client).toBe('Acme Corp');
    expect(lastTimerFrom(entry, 'w').client).toBeNull();
    expect(lastTimerFrom({ ...entry, project_id: 'gone' }, 'w', projects).client).toBeNull();
});

test('a value stored before the client was still reads back', () => {
    const old = { entry_id: 'e1', project_id: 'p2', task_id: null, notes: null, project: 'Billing API', task: null, date: '2026-09-18', workspace: 'w' };
    expect(lastTimerFor(old, 'w')).toMatchObject({ project: 'Billing API', client: null });
});

test('the second line reads client – project · task, skipping what is missing', () => {
    expect(resumeWork({ client: 'Acme Corp', project: 'Billing API', task: 'Development' })).toBe('Acme Corp – Billing API · Development');
    expect(resumeWork({ client: null, project: 'Billing API', task: null })).toBe('Billing API');
    expect(resumeWork({ client: null, project: 'Billing API', task: 'QA' }, 'Looked Up')).toBe('Looked Up – Billing API · QA');
    expect(resumeWork({ client: 'Acme Corp', project: null, task: null })).toBe('Acme Corp');
});
