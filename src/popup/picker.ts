// The entry sheet's project picker, as the desktop's ProjectPicker.vue: a
// button showing the choice, which opens into a search box over a list
// grouped by client; type to filter, arrows and Enter to choose. The one
// thing the desktop does not have is the "Suggested" group on top — the
// projects the page or issue points at — which is shown while nothing is
// typed, so a new timer from an issue is still "＋, Enter".
import { fuzzyFilter } from '../fuzzy';
import { t } from '../messaging';
import { groupByClient } from '../picker';
import type { Suggestion } from '../suggest';
import type { ProjectOption } from '../types';
import { el } from './dom';

export interface PickerOptions {
    /** Every project, best first; the groups keep this order. */
    projects: ProjectOption[];
    /** Shown above the clients while the search is empty. */
    suggested: Suggestion[];
    /** The chosen project's id, or '' for none yet. */
    value: string;
    onChange: (projectId: string) => void;
    /** The footer link: the timer stays a timer, new projects are made in the web app. */
    onCreate: () => void;
}

export interface Picker {
    el: HTMLElement;
    /** Open straight into the search, so the first keystroke is a project name. */
    open: () => void;
    readonly value: string;
}

export function projectPicker(opts: PickerOptions): Picker {
    const root = el('div', { class: 'picker' });
    let value = opts.value;
    let open = false;
    let query = '';
    let active = 0;
    let rows: ProjectOption[] = [];

    const label = (p: ProjectOption) => `${p.code ? `${p.code}: ` : ''}${p.name}${p.client ? ` (${p.client})` : ''}`;
    const selected = () => opts.projects.find((p) => p.id === value) ?? null;

    const choose = (p: ProjectOption) => {
        value = p.id;
        open = false;
        render();
        opts.onChange(p.id);
    };

    const show = () => {
        open = true;
        query = '';
        active = 0;
        render();
    };

    const renderClosed = () => {
        const s = selected();
        const button = el('button', { type: 'button', class: `picker-button${s ? '' : ' placeholder'}` });
        if (s) {
            if (s.code) button.append(el('span', { class: 'picker-code', text: `${s.code}:` }));
            button.append(el('span', { class: 'picker-title', text: s.name }));
            if (s.client) button.append(el('span', { class: 'picker-client', text: `(${s.client})` }));
        } else {
            button.textContent = t('popup_select_project');
        }
        button.addEventListener('click', show);
        root.append(button);
    };

    const renderOpen = () => {
        const input = el('input', { type: 'text', placeholder: t('popup_project_search'), autocomplete: 'off', spellcheck: 'false' });
        input.value = query;
        const list = el('div', { class: 'picker-list', role: 'listbox' });

        const highlight = () => {
            const buttons = list.querySelectorAll<HTMLElement>('.picker-row:not(.picker-create)');
            buttons.forEach((b, i) => b.classList.toggle('active', i === active));
            buttons[active]?.scrollIntoView({ block: 'nearest' });
        };

        const row = (p: ProjectOption, index: number, badge?: string) => {
            const button = el('button', {
                type: 'button',
                class: `picker-row${index === active ? ' active' : ''}${p.id === value ? ' current' : ''}`,
                role: 'option',
                'aria-selected': String(p.id === value),
                title: label(p),
            });
            if (p.code) button.append(el('span', { class: 'picker-code', text: `${p.code}:` }));
            button.append(el('span', { class: 'picker-title', text: p.name }));
            if (badge) button.append(el('span', { class: 'pill', text: badge }));
            // mousedown, not click: the search box must not lose focus (and close the list) first
            button.addEventListener('mousedown', (e) => {
                e.preventDefault();
                choose(p);
            });
            button.addEventListener('mouseenter', () => {
                active = index;
                highlight();
            });
            return button;
        };

        const group = (name: string, projects: ProjectOption[], offset: number, badge?: (p: ProjectOption) => string | undefined) => {
            const wrap = el('div', { class: 'picker-group', role: 'group', 'aria-label': name });
            wrap.append(el('p', { class: 'picker-group-name', text: name }));
            projects.forEach((p, i) => wrap.append(row(p, offset + i, badge?.(p))));
            return wrap;
        };

        const draw = () => {
            list.replaceChildren();
            const filtered = fuzzyFilter(opts.projects, query, (p) => `${p.code ?? ''} ${p.name} ${p.client ?? ''}`);
            const suggested = query.trim() ? [] : opts.suggested;
            const suggestedProjects = suggested.map((s) => s.project);
            const groups = groupByClient(filtered.filter((p) => !suggestedProjects.includes(p)));
            rows = [...suggestedProjects, ...groups.flatMap((g) => g.projects)];
            active = Math.min(active, Math.max(0, rows.length - 1));
            if (suggested.length) {
                list.append(group(t('popup_suggested'), suggestedProjects, 0, (p) => (suggested.find((s) => s.project === p)?.reason === 'remembered' ? t('popup_remembered') : undefined)));
            }
            for (const g of groups) list.append(group(g.client || t('popup_no_client'), g.projects, suggestedProjects.length + g.offset));
            if (!rows.length) list.append(el('p', { class: 'picker-empty', text: t('popup_no_projects') }));
            const create = el('button', { type: 'button', class: 'picker-row picker-create', text: t('popup_new_project_link') });
            create.addEventListener('mousedown', (e) => {
                e.preventDefault();
                opts.onCreate();
            });
            list.append(create);
        };

        input.addEventListener('input', () => {
            query = input.value;
            active = 0;
            draw();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                active = Math.min(active + 1, rows.length - 1);
                highlight();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                active = Math.max(active - 1, 0);
                highlight();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const p = rows[active];
                if (p) choose(p);
            } else if (e.key === 'Escape') {
                // the sheet underneath listens for Escape too: this one is the picker's
                e.preventDefault();
                e.stopPropagation();
                open = false;
                render();
            }
        });

        root.append(input, list);
        draw();
        input.focus();
    };

    const render = () => {
        root.replaceChildren();
        if (open) renderOpen();
        else renderClosed();
    };

    // Click-away closes the list. Decided a tick later rather than from the
    // event's relatedTarget: opening replaces the focused button with the
    // search box, and the focusout that removal fires would otherwise close
    // the list before it is seen.
    root.addEventListener('focusout', () => {
        setTimeout(() => {
            if (open && !root.contains(document.activeElement)) {
                open = false;
                render();
            }
        }, 0);
    });

    render();
    return {
        el: root,
        open: show,
        get value() {
            return value;
        },
    };
}
