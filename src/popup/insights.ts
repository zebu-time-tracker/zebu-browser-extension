// Insights, as the desktop's Insights.vue lays them out: six figures, the
// uninvoiced breakdown, and hours per day this month and per month this year,
// with a tooltip on hover. The desktop gives them a window of their own;
// here they take the popup's body while the header's chart button is pressed.
//
// The panel fetches the summary itself and re-asks every twenty seconds; the
// running timer comes from the popup, which already keeps it fresh, and its
// live minutes are added on every tick so the figures count up with the clock.
import { toDateString } from '../dates';
import { formatDurationHuman, formatMinutes } from '../duration';
import { call, CallError, t } from '../messaging';
import { liveSummary } from '../summary';
import type { Entry, Summary } from '../types';
import { el } from './dom';

export interface InsightsDeps {
    running: () => Entry | null;
    /** The server's clock. */
    now: () => number;
}

export interface Insights {
    el: HTMLElement;
    destroy: () => void;
}

const REFRESH_MS = 20_000;
const TICK_MS = 15_000;

export function insightsPanel(deps: InsightsDeps): Insights {
    const root = el('div', { class: 'insights' }, [el('p', { class: 'muted insights-loading', text: t('popup_loading') })]);
    let summary: Summary | null = null;
    let alive = true;
    let hover: { kind: 'day' | 'month'; i: number; m: number } | null = null;

    const units = () => ({ hour: t('unit_hour'), minute: t('unit_minute'), day: t('unit_day'), week: t('unit_week') });
    const money = (cents: number) => (cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
    const tipLeft = (i: number, count: number) => `min(max(${(((i + 0.5) / count) * 100).toFixed(1)}%, 16%), 84%)`;

    const tipText = (h: { kind: 'day' | 'month'; i: number; m: number }) => {
        const year = new Date().getFullYear();
        if (h.kind === 'day') {
            const d = new Date(year, new Date().getMonth(), h.i + 1);
            return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}: ${formatMinutes(h.m)}`;
        }
        return `${new Date(year, h.i, 1).toLocaleDateString(undefined, { month: 'long' })}: ${formatMinutes(h.m)}`;
    };

    const chart = (kind: 'day' | 'month', values: number[], current: number) => {
        const max = Math.max(...values, 60);
        const wrap = el('div', { class: 'mini-chart' });
        const tip = el('div', { class: 'chart-tip' });
        tip.hidden = true;
        values.forEach((m, i) => {
            const bar = el('span', { class: i === current ? 'today' : '' }, [el('i')]);
            (bar.firstChild as HTMLElement).style.height = `${Math.max(4, (m / max) * 100)}%`;
            bar.addEventListener('mouseenter', () => {
                hover = { kind, i, m };
                wrap.querySelectorAll('span.hovered').forEach((s) => s.classList.remove('hovered'));
                bar.classList.add('hovered');
                tip.textContent = tipText(hover);
                tip.style.left = tipLeft(i, values.length);
                tip.hidden = false;
            });
            wrap.append(bar);
        });
        wrap.addEventListener('mouseleave', () => {
            hover = null;
            wrap.querySelectorAll('span.hovered').forEach((s) => s.classList.remove('hovered'));
            tip.hidden = true;
        });
        wrap.append(tip);
        return wrap;
    };

    const draw = () => {
        if (!summary) return;
        const s = liveSummary(summary, deps.running(), toDateString(new Date()), deps.now());
        const tile = (label: string, value: string) => el('div', {}, [el('span', { text: label }), el('strong', { text: value })]);
        const row = (label: string, value: string, cls = 'uninv-row') => el('div', { class: cls }, [el('span', { text: label }), el('strong', { text: value })]);
        const now = new Date();
        root.replaceChildren(
            el('div', { class: 'summary-grid' }, [
                tile(t('summary_hours_today'), formatMinutes(s.today)),
                tile(t('summary_hours_yesterday'), formatMinutes(s.yesterday)),
                tile(t('summary_hours_this_week'), formatMinutes(s.this_week)),
                tile(t('summary_hours_last_week'), formatMinutes(s.last_week)),
                tile(t('summary_hours_this_month'), formatMinutes(s.this_month)),
                tile(t('summary_billable_this_month'), `${s.billable_pct_month}%`),
            ]),
            el('hr', { class: 'sep' }),
            el('div', { class: 'summary-uninv' }, [
                el('p', { class: 'uninv-title', text: t('summary_uninvoiced_this_month') }),
                row(t('summary_time'), formatDurationHuman(s.uninvoiced_minutes, units())),
                ...Object.entries(s.uninvoiced_amounts ?? {}).map(([currency, cents]) => row(currency, money(cents))),
                s.uninvoiced_total ? row(t('summary_approx_total', s.base_currency), money(s.uninvoiced_total), 'uninv-row uninv-total') : '',
            ]),
            chart('day', s.month_by_day ?? [], now.getDate() - 1),
            el('p', { class: 'muted chart-caption', text: t('summary_hours_per_day', now.toLocaleDateString(undefined, { month: 'long' })) }),
            chart('month', s.year_by_month ?? [], now.getMonth()),
            el('p', { class: 'muted chart-caption', text: t('summary_hours_per_month', String(now.getFullYear())) }),
        );
    };

    const load = async () => {
        try {
            summary = await call<Summary>({ type: 'summary:get' });
            if (alive) draw();
        } catch (e) {
            if (!alive || summary) return;
            const text = e instanceof CallError && e.status === 0 ? t('popup_error_unreachable') : t('popup_error_generic', e instanceof Error ? e.message : String(e));
            root.replaceChildren(el('p', { class: 'error', text }));
        }
    };

    void load();
    const refresh = window.setInterval(() => void load(), REFRESH_MS);
    const tick = window.setInterval(() => {
        if (!hover) draw(); // redrawing under the pointer would drop the tooltip
    }, TICK_MS);

    return {
        el: root,
        destroy: () => {
            alive = false;
            window.clearInterval(refresh);
            window.clearInterval(tick);
        },
    };
}
