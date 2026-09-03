// Options page: connect a workspace (device flow — approve in Zebu, no
// password typed into the extension), choose how timer notes are composed,
// add self-hosted trackers, forget learned suggestions.
import { api, ApiError, workspaceUrl } from '../api';
import { t } from '../messaging';
import { getSettings, saveMappings, saveSettings } from '../storage';
import { ADAPTERS } from '../content/adapters';
import type { Settings } from '../types';

const app = document.getElementById('app')!;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
    }
    for (const child of children) node.append(child);
    return node;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureHostPermission(origin: string): Promise<boolean> {
    if (/\.zebu\.work$/.test(new URL(origin).hostname)) return true; // covered by host_permissions
    return chrome.permissions.request({ origins: [`${origin}/*`] });
}

function workspaceCard(settings: Settings): HTMLElement {
    const input = el('input', { type: 'text', placeholder: t('options_workspace_placeholder'), value: settings.workspace }) as HTMLInputElement;
    const button = el('button', { class: 'btn', text: settings.token ? t('options_disconnect') : t('options_connect') }) as HTMLButtonElement;
    const status = el('p', { class: 'status' });

    if (settings.token && settings.user) {
        status.className = 'status ok';
        status.textContent = t('options_connected_as', settings.user.name, settings.user.email);
        input.disabled = true;
    }

    button.addEventListener('click', async () => {
        if (settings.token) {
            await saveSettings({ token: '', user: null });
            location.reload();
            return;
        }

        const workspace = workspaceUrl(input.value);
        status.className = 'status error';
        if (!workspace) {
            status.textContent = t('options_error_workspace');
            return;
        }
        if (!(await ensureHostPermission(workspace))) {
            status.textContent = t('options_sites_permission_denied');
            return;
        }

        button.disabled = true;
        status.className = 'status';
        try {
            const started = await api.deviceStart(workspace);
            status.textContent = t('options_connecting');
            await chrome.tabs.create({ url: started.verification_url });

            const deadline = Date.now() + started.expires_in * 1000;
            while (Date.now() < deadline) {
                await sleep(Math.max(2, started.interval) * 1000);
                const { status: code, data } = await api.devicePoll(workspace, started.device_code);
                if (code === 200 && data.status === 'approved' && data.token) {
                    await saveSettings({ workspace, token: data.token });
                    const me = await api.me();
                    await saveSettings({ user: me });
                    location.reload();
                    return;
                }
                if (code === 403) throw new ApiError('denied', 403);
                if (code === 410) throw new ApiError('expired', 410);
            }
            throw new ApiError('expired', 410);
        } catch (error) {
            status.className = 'status error';
            const code = error instanceof ApiError ? error.status : -1;
            status.textContent = code === 403 ? t('options_error_denied') : code === 410 ? t('options_error_expired') : t('options_error_unreachable');
            button.disabled = false;
        }
    });

    return el('section', { class: 'card' }, [
        el('h2', { text: t('options_workspace_heading') }),
        el('p', { class: 'hint', text: t('options_workspace_hint') }),
        el('div', { class: 'inline' }, [input, button]),
        status,
    ]);
}

function notesCard(settings: Settings): HTMLElement {
    const radios = el('div', { class: 'radios' });
    for (const value of ['identifier_title_url', 'title_url', 'title'] as const) {
        const radio = el('input', { type: 'radio', name: 'noteFormat', value }) as HTMLInputElement;
        radio.checked = settings.noteFormat === value;
        radio.addEventListener('change', () => void saveSettings({ noteFormat: value }));
        radios.append(el('label', {}, [radio, t(`options_notes_${value}`)]));
    }
    return el('section', { class: 'card' }, [el('h2', { text: t('options_notes_heading') }), el('p', { class: 'hint', text: t('options_notes_hint') }), radios]);
}

function sitesCard(settings: Settings): HTMLElement {
    const origin = el('input', { type: 'text', placeholder: t('options_sites_origin_placeholder') }) as HTMLInputElement;
    const type = el('select') as HTMLSelectElement;
    for (const adapter of ADAPTERS) type.append(el('option', { value: adapter.id, text: adapter.label }));
    const add = el('button', { class: 'btn', text: t('options_sites_add') });
    const status = el('p', { class: 'status error' });
    const list = el('ul', { class: 'sites' });

    const renderList = () => {
        list.replaceChildren();
        if (!settings.customSites.length) {
            list.append(el('li', { text: t('options_sites_none') }));
            return;
        }
        for (const site of settings.customSites) {
            const remove = el('button', { type: 'button', text: t('options_sites_remove') });
            remove.addEventListener('click', async () => {
                settings.customSites = settings.customSites.filter((s) => s.origin !== site.origin);
                await saveSettings({ customSites: settings.customSites });
                await chrome.permissions.remove({ origins: [`${site.origin}/*`] }).catch(() => undefined);
                renderList();
            });
            list.append(el('li', {}, [el('span', { text: `${site.origin} · ${ADAPTERS.find((a) => a.id === site.adapter)?.label ?? site.adapter}` }), remove]));
        }
    };

    add.addEventListener('click', async () => {
        status.textContent = '';
        let value: string;
        try {
            const url = new URL(/^https?:\/\//.test(origin.value) ? origin.value : `https://${origin.value}`);
            value = `${url.protocol}//${url.host}`;
        } catch {
            status.textContent = t('options_error_workspace');
            return;
        }
        if (!(await chrome.permissions.request({ origins: [`${value}/*`] }))) {
            status.textContent = t('options_sites_permission_denied');
            return;
        }
        settings.customSites = [...settings.customSites.filter((s) => s.origin !== value), { origin: value, adapter: type.value }];
        await saveSettings({ customSites: settings.customSites });
        origin.value = '';
        renderList();
    });

    renderList();
    return el('section', { class: 'card' }, [
        el('h2', { text: t('options_sites_heading') }),
        el('p', { class: 'hint', text: t('options_sites_hint') }),
        el('div', { class: 'inline' }, [origin, type, add]),
        status,
        list,
    ]);
}

function forgetCard(): HTMLElement {
    const button = el('button', { class: 'btn secondary', text: t('options_forget') });
    const status = el('p', { class: 'status ok' });
    button.addEventListener('click', async () => {
        await saveMappings({});
        status.textContent = t('options_saved');
    });
    return el('section', { class: 'card' }, [el('h2', { text: t('options_forget_heading') }), el('p', { class: 'hint', text: t('options_forget_hint') }), button, status]);
}

(async () => {
    const settings = await getSettings();
    app.replaceChildren(el('h1', { text: t('options_title') }), workspaceCard(settings), notesCard(settings), sitesCard(settings), forgetCard());
})();
