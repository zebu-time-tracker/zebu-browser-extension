// Groups the project picker's already-ranked results by client, the way the
// desktop's src/picker.ts does: the client is a small heading above its
// projects. Grouping never reshuffles what the ranking decided — a client's
// group sits at the position of its best-ranked project, and projects keep
// their order inside the group.
import type { ProjectOption } from './types';

export interface ProjectGroup {
    /** Client name, or '' for projects that have none. */
    client: string;
    projects: ProjectOption[];
    /** Index of the group's first project in the flattened list (keyboard nav). */
    offset: number;
}

export function groupByClient(projects: ProjectOption[]): ProjectGroup[] {
    const byClient = new Map<string, ProjectOption[]>();
    for (const p of projects) {
        const client = p.client ?? '';
        const group = byClient.get(client);
        if (group) group.push(p);
        else byClient.set(client, [p]);
    }

    let offset = 0;
    return [...byClient].map(([client, group]) => {
        const entry = { client, projects: group, offset };
        offset += group.length;
        return entry;
    });
}
