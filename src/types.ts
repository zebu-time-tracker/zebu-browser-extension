// Shared shapes between the content scripts, the service worker and the pages.

/** What a tracker page is about, as extracted by a site adapter. */
export interface Issue {
    /** Adapter id: github, gitlab, jira, … */
    site: string;
    /** Stable identity of this issue across visits, e.g. "github:acme/api#123". */
    key: string;
    /** The thing the issue belongs to — repo, Jira project, Linear team, Asana project, Trello board. Used for project suggestions. */
    container: string;
    /** Extra names that also describe where the issue lives (site name, org, board), for fuzzier matching. */
    containerHints: string[];
    /** Human identifier: "#123", "PROJ-42", or "" when the tracker has none. */
    identifier: string;
    title: string;
    url: string;
}

/** Mirrors the Zebu API's project option (GET /api/timesheet), as the desktop's src/api.ts has it. */
export interface ProjectOption {
    id: string;
    name: string;
    code: string | null;
    client: string | null;
    tasks: { id: string; name: string }[];
}

/** Per-project totals from GET /api/timesheet; `budget_pct` only for projects with a budget. */
export interface ProjectStats {
    total_minutes: number;
    uninvoiced_minutes: number;
    budget_pct: number | null;
}

/** Mirrors the Zebu API's time entry. */
export interface Entry {
    id: string;
    date: string;
    minutes: number;
    notes: string | null;
    project: string | null;
    project_id: string;
    task: string | null;
    task_id: string | null;
    is_billable: boolean;
    locked: boolean;
    timer_started_at: string | null;
    /**
     * When the row was last touched — started, stopped, created or edited.
     * Optional: workspaces older than board #49 do not send it.
     */
    updated_at?: string | null;
    /** Agentic work: minutes waited on an AI agent, and whether one is being waited on now. */
    waiting_minutes?: number;
    waiting_subtracted?: boolean;
    agent_waiting?: boolean;
}

/** The week the popup's day list is drawn from (board #267). */
export interface WeekSheet {
    entries: Entry[];
    /** First day of the week, "YYYY-MM-DD"; '' when nothing has been fetched. */
    weekStart: string;
    /** An approved week: nothing in it can be edited, resumed or added to. */
    weekLocked: boolean;
    /** Per-project totals for the rows' stats line, keyed by project id. */
    projectStats: Record<string, ProjectStats>;
}

export interface Settings {
    /** Origin of the workspace, e.g. https://studio.zebu.work */
    workspace: string;
    token: string;
    user: { name: string; email: string } | null;
    /** How the note for a new timer is composed. */
    noteFormat: 'identifier_title_url' | 'title_url' | 'title';
    /** Self-hosted trackers added by the user: origin → adapter id. */
    customSites: { origin: string; adapter: string }[];
    /** Idle detection while a timer runs (board #269): on, and after how many minutes without input. */
    idleEnabled: boolean;
    idleMinutes: number;
    /** Where the workspace pushes timer changes (board #279), from GET /api/me at connect time; null when it does not broadcast. */
    broadcast: BroadcastConfig | null;
    /** The popup's theme: follow the system, or force one, as the desktop's Appearance setting. */
    appearance: 'system' | 'dark' | 'light';
}

/** The `broadcast` block of GET /api/me: where to open the socket and which private channel is this person's. */
export interface BroadcastConfig {
    key: string;
    /** null: the workspace host the extension already talks to */
    host: string | null;
    port: number;
    scheme: 'http' | 'https';
    channel: string;
}

/** GET /api/summary: the dashboard's time widgets, as the desktop's src/api.ts reads them. Minutes throughout; money in minor units. */
export interface Summary {
    today: number;
    yesterday: number;
    this_week: number;
    last_week: number;
    this_month: number;
    last_month: number;
    billable_pct_month: number;
    month_by_day: number[];
    year_by_month: number[];
    uninvoiced_minutes: number;
    uninvoiced_amounts: Record<string, number>;
    uninvoiced_total: number;
    base_currency: string;
    /** Since board #120 the figures include the running timer's elapsed time, and say so. */
    live_included?: boolean;
}

/** Learned repo/board → project choices, keyed by Issue.container per site. */
export interface Mapping {
    projectId: string;
    taskId: string | null;
    count: number;
    lastUsed: number;
}

export type Mappings = Record<string, Mapping>;

/** Cached state the service worker keeps for the content scripts and popup. */
export interface State {
    connected: boolean;
    running: Entry | null;
    projects: ProjectOption[];
    /** The current week's entries, so today's list costs no extra request (board #267). */
    entries: Entry[];
    weekStart: string;
    weekLocked: boolean;
    projectStats: Record<string, ProjectStats>;
    fetchedAt: number;
    /**
     * The pulse token this state is the answer to. Poll /api/timer/pulse and
     * only refetch the timesheet when it differs (board #49).
     */
    pulseToken: string;
    /**
     * How far this browser's clock is ahead of the server's, in milliseconds.
     * A running timer is elapsed time measured from a server timestamp, so a
     * browser that is five minutes fast would otherwise show five minutes of
     * work nobody did.
     */
    skewMs: number;
    /**
     * While a planned outage is being waited out: the instant (epoch ms) before
     * which nothing should be asked of the server. Null the rest of the time.
     * See src/maintenance.ts (board #216).
     */
    downUntil: number | null;
    /** A socket to Reverb is up and subscribed (board #279): changes are pushed, the pulse is only a backstop. */
    live: boolean;
}

/** Messages between the pieces of the extension. */
export type Message =
    | { type: 'state:get' }
    | { type: 'state:refresh' }
    | { type: 'state:pulse' }
    | { type: 'timer:open'; issue: Issue }
    | { type: 'timer:start'; issue: Issue | null; projectId: string; taskId: string | null; notes: string }
    | { type: 'timer:stop' }
    | { type: 'issue:pending:get' }
    | { type: 'issue:pending:clear' }
    | { type: 'page:issue' }
    // the day list and its edits (board #267)
    | { type: 'sheet:get'; date: string }
    | { type: 'timer:resume'; entryId: string; projectId: string }
    | { type: 'entry:add'; issue: Issue | null; projectId: string; taskId: string | null; date: string; minutes: number; notes: string }
    | { type: 'entry:update'; id: string; projectId: string; taskId: string | null; notes: string; date: string; minutes: number | null }
    | { type: 'entry:delete'; id: string }
    // the last timer, resumed (board #268)
    | { type: 'timer:resume-last' }
    // the summary view (board #269)
    | { type: 'summary:get' };

export const DEFAULT_SETTINGS: Settings = {
    workspace: '',
    token: '',
    user: null,
    noteFormat: 'identifier_title_url',
    customSites: [],
    idleEnabled: true,
    idleMinutes: 10,
    broadcast: null,
    appearance: 'system',
};
