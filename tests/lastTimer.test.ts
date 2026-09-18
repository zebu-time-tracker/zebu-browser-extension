import { lastTimerFor, lastTimerFrom } from '../src/lastTimer';
import type { Entry } from '../src/types';

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
