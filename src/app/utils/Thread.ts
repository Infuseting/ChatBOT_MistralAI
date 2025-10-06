import { getContext } from './Context';
import { getHistory, getLastMessage, Message, Messages } from './Message';
import { getActualModel } from './Models';
import { Mistral } from '@mistralai/mistralai';
import { getApiKey } from './ApiKey';
import { showErrorToast } from './toast';
import { utcNow, ensureIso, ensureDate, parseToUtc } from './DateUTC';
import { readThreadCache, setThreadCache } from './ThreadCache';
import { generateUUID } from './crypto';
type Thread = { id: string; name: string, date?: Date, messages?: Messages, status?: 'local' | 'remote' | 'unknown', context : string, model?: string, share: boolean };

const defaultThreadName = "New Thread";
const allThreads : Thread[] = [];
let loadingThreadsPromise: Promise<Thread[]> | null = null;
// guard set for threads currently loading their initial message page
const loadingInitialMessages = new Set<string>();

/** Returns true when the initial message page for the given thread id is currently being loaded. */
export function isLoadingInitialMessages(threadId: string) {
    try { return loadingInitialMessages.has(threadId); } catch (e) { return false; }
}
/**
 * Check whether a thread id exists in local storage cache.
 * @param id - thread identifier to check
 * @returns true if the id is present in the thread ids cache, false otherwise
 */
export function threadExists(id: string) : boolean {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return false;
        const ids = window.localStorage.getItem('threadIds');
        if (ids !== null) {
            if (ids === '') return false;
            const parts = ids.split(',');
            return parts.includes(id);
        }
        // fallback to parsing full cache (slower)
        const full = readThreadCache();
        return full.some(t => t.id === id);
    } catch (e) {
        return false;
    }
}

// Detect guest users. Middleware sets a cookie `is_guest=1` when no valid
// authentication is present. This helper is used to disable persistence and
// remote sync for guests so their data remains ephemeral in-memory only.
function isGuest(): boolean {
    try {
        if (typeof window === 'undefined') return false;
        // If an access_token cookie exists, treat as authenticated.
        const cookie = window.document.cookie || '';
        if (cookie.includes('access_token=')) return false;
        // Otherwise, if the server set is_guest=1, treat as guest.
        if (cookie.includes('is_guest=1')) return true;
    } catch (e) {}
    return false;
}

/**
 * Read a lightweight marker that indicates which thread is currently open.
 * The marker is stored in localStorage under `openThreadMarker` and has
 * shape { id, path } when present.
 * @returns the parsed marker object or null if not present/invalid
 */
export function readOpenThreadMarker(): { id: string; path: string } | null {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return null;
        const raw = window.localStorage.getItem('openThreadMarker');
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { id: string; path: string };
        if (parsed && typeof parsed.id === 'string' && typeof parsed.path === 'string') return parsed;
        return null;
    } catch (e) {
        return null;
    }
}
/**
 * Select a thread by id. If found in persisted storage, set it as the
 * actual (active) thread.
 * @param id - id of the thread to select
 */
export async function selectThreadById(id:string) {
    // prefer reading from persisted storage for sync selection
    const t = (await getThreads()).find(th => th.id === id) ?? null;
    if (t) setActualThread(t as Thread);
}

/**
 * Find a thread by id within the currently known threads. This will call
 * `getThreads()` which may perform an API fetch.
 * @param id - thread id to find
 * @returns a Thread object or null if not found
 */
export async function findThreadById(id: string) : Promise<Thread | null> {
    try {
        const threads = await getThreads();
        return (threads.find(th => th.id === id) ?? null) as Thread | null;
    } catch (e) {
        return null;
    }
}

// Open a thread if found, otherwise create a new local thread and assign the provided id
/**
 * Open an existing thread by id or create a new local thread using the
 * provided id when none exists. The created thread is persisted to cache.
 * @param id - id to open or use for the new thread
 * @returns the opened or newly created Thread
 */
export async function openOrCreateThreadWithId(id: string) : Promise<Thread> {
    const existing = await findThreadById(id);
    if (existing) {
        setActualThread(existing);
        return existing;
    }
    const thread: Thread = {
        id,
        name: `Thread ${id}`,
    date: utcNow(),
        messages: [],
        status: 'local',
        context: getContext() ?? '',
        model: getActualModel() ?? 'mistral-medium-latest',
        share: false
    };
    setActualThread(thread);
    // persist newly created thread in cache only for authenticated users.
    try {
        if (!isGuest()) {
            const all = readThreadCache();
            all.push(thread);
            setThreadCache(all);
        }
    } catch (e) {}
    return thread;
}

// For share links we just try to open if exists; otherwise create a placeholder and mark as remote
/**
 * Attempt to open a shared (remote) thread identified by the share code.
 * If the API returns data the thread is created locally as status 'remote'.
 * Otherwise a placeholder remote thread is created.
 * @param id - share code / id representing the shared thread
 * @returns the resulting Thread
 */
export async function openSharedThread(id: string) : Promise<Thread> {
    const existing = await findThreadById(id);
    if (existing) {
        setActualThread(existing);
        return existing;
    }

    // Try fetching the shared thread via API using shareCode
    try {
        const res = await fetch(`/api/thread?shareCode=${encodeURIComponent(id)}`);
        if (res && res.ok) {
            const payload = await res.json().catch(() => null);
            if (payload) {
                const msgs = (payload.messages ?? []) as any[];
                const mappedMsgs = msgs.map(m => {
                    // normalize timestamp to a Date always
                    let ts: Date;
                    try {
                        const candidate = m.sentAt ?? m.timestamp ?? m.date ?? null;
                        const d = ensureDate(candidate);
                        ts = d instanceof Date ? d : (isNaN(Number(candidate)) ? utcNow() : new Date(Number(candidate)));
                    } catch (e) {
                        try {
                            const candidate = m.sentAt ?? m.timestamp ?? m.date ?? null;
                            const parsed = Date.parse(String(candidate));
                            ts = isNaN(parsed) ? utcNow() : new Date(parsed);
                        } catch {
                            ts = utcNow();
                        }
                    }
                    // map attachments if present in the shared payload
                    const atts = (m.attachments ?? m.attachment ?? []) as any[];
                    const mappedAttachments = (atts || []).map((a: any) => {
                        return {
                            fileName: a.fileName ?? a.name ?? '',
                            fileType: a.extension ?? a.fileType ?? '',
                            type: a.type ?? a.attributeType ?? 'file',
                            libraryId: a.libraryId ?? null,
                            status: 'sync',
                            data: a.data ? { sha256: a.data.sha256 ?? a.sha256 ?? '', data: a.data.data ?? '' } : (a.sha256 ? { sha256: a.sha256, data: '' } : undefined)
                        };
                    }).filter(Boolean);

                    return {
                        id: m.idMessage ?? m.id ?? '',
                        text: m.text ?? m.content ?? '',
                        thinking: m.thinking ?? '',
                        sender: m.sender ?? m.role ?? 'user',
                        timestamp: ts,
                        parentId: m.parentId ?? null,
                        status: 'sync',
                        attachments: mappedAttachments
                    };
                });

                const thread: Thread = {
                    id: payload.idThread ?? payload.id ?? String(payload.id ?? id),
                    name: payload.name ?? `Shared ${id}`,
                    date: payload.updatedAt ? (parseToUtc(payload.updatedAt) as Date) : utcNow(),
                    messages: mappedMsgs as any,
                    status: 'remote',
                    context: payload.context ?? '',
                    model: payload.model ?? getActualModel() ?? 'mistral-medium-latest',
                    share: true,
                };
                // persist only for authenticated users
                try { if (!isGuest()) { const all = readThreadCache(); all.push(thread); setThreadCache(all); } } catch (e) {}
                setActualThread(thread);
                return thread;
            }
        }
    } catch (e) {
        console.error('openSharedThread fetch failed', e);
    }

    // Fallback: create a placeholder remote thread locally
    const thread: Thread = {
        id,
        name: `Shared ${id}`,
        date: utcNow(),
        messages: [],
        status: 'remote',
        context: '',
        model: getActualModel() ?? 'mistral-medium-latest',
        share: true,
    };
    try { if (!isGuest()) { const all = readThreadCache(); all.push(thread); setThreadCache(all); } } catch (e) {}
    setActualThread(thread);
    return thread;
}
/**
 * Create a new local thread with a generated UUID and default context/model.
 * The newly created thread becomes the active thread and is stored in cache.
 * @returns the created Thread
 */
export function newThread() {
    const thread: Thread = {
        id: generateUUID(),
        name: defaultThreadName,
    date: utcNow(),
        messages: [],
        status: 'local',
        context: getContext() ?? '',
        model: getActualModel() ?? 'mistral-medium-latest',
        share: false
    };
    const url = `/`;
    if (typeof window !== 'undefined' && window.history && window.history.pushState) {
        window.history.pushState({}, '', url);
    } 
    setActualThread(thread);
    try {
        // Do not persist guests' threads — keep them in-memory only so they
        // are lost on refresh as requested.
        if (!isGuest()) {
            const all = readThreadCache();
            all.push(thread);
            setThreadCache(all);
        }
    } catch (e) {}
    return thread;
}

/**
 * Set the current active thread globally and dispatch a DOM event
 * (`actualThreadUpdated`) so UI components can react.
 * @param thread - Thread or null to clear
 */
export function setActualThread(thread: Thread | null) {
    if ((globalThis as any).actualThread) {
        const prev : Thread = (globalThis as any).actualThread;
        if (prev.status === 'remote') {
            const prevId = prev.id;
            const allThreadsIndex = allThreads.findIndex(t => t.id === prevId);
            allThreads[allThreadsIndex] = prev;
        }
    }
    try {
        (globalThis as any).actualThread = thread;
        try {
            const ev = new CustomEvent('actualThreadUpdated', { detail: thread });
            window.dispatchEvent(ev);
        } catch (e) {
            
        }

        // If the newly set thread is remote and has no messages loaded yet,
        // fetch the initial page of messages from the server so UI can render
        // the first chunk without waiting for manual lazy-load.
        try {
            if (thread && thread.status === 'remote') {
                const tid = thread.id;
                const msgsPresent = Array.isArray(thread.messages) && thread.messages.length > 0;
                if (!msgsPresent && !loadingInitialMessages.has(tid)) {
                    loadingInitialMessages.add(tid);
                    // fetch first page (newest messages) - we request a moderate page size
                    (async () => {
                        try {
                            // use client helper if available
                            const page = await fetchThreadMessagesPage(tid, 50, undefined as any);
                            if (page && page.ok && Array.isArray(page.messages) && page.messages.length > 0) {
                                // normalize into Message objects
                                const normalized = page.messages.map((m: any) => ({
                                    id: String(m.idMessage ?? m.id ?? ''),
                                    text: String(m.text ?? ''),
                                    thinking: String(m.thinking ?? ''),
                                    sender: (m.sender === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
                                    timestamp: (m.timestamp ? new Date(m.timestamp) : new Date()),
                                    parentId: String(m.parentId ?? ''),
                                    status: 'sync' as const,
                                    attachments: (m.attachments ?? []) as any[]
                                }) as Message);
                                thread.messages = normalized;
                                try { persistThread(thread); } catch (e) {}
                                try { setActualThread(thread); } catch (e) {}
                                try { updateActualThread(); } catch (e) {}
                            }
                        } catch (e) {
                            // ignore network errors
                        } finally {
                            loadingInitialMessages.delete(tid);
                        }
                    })();
                }
            }
        } catch (e) {
            // ignore
        }
    } catch (e) {
    
    }
}
/**
 * Reload threads from the remote API endpoint `/api/thread` and normalize
 * the returned structure into the local Thread shape. Returns an array of
 * Thread objects or an empty array on failure.
 * @returns Promise<Thread[]>
 */
export async function reloadThread() {
    try {
        // guests must not fetch remote thread lists
        if (isGuest()) return [];
        try {
            const res = await fetch('/api/thread');
            if (!res.ok) return [];
            const rows = await res.json();
            async function ensureMessagesForRows(rowsArr: any[]) {
                if (rowsArr.length === 0) return rowsArr;
                const sample = rowsArr[0];
                if (sample && (sample.messages || sample.message)) return rowsArr;
                const ids = rowsArr.map(r => r.idThread ?? r.id ?? String(r.id));
                const res2 = await fetch('/api/thread');
                if (!res2.ok) return rowsArr;
                const full = await res2.json().catch(() => []);
                // map by idThread or id
                const map: Record<string, any> = {};
                for (const f of full || []) {
                    const key = f.idThread ?? f.id ?? String(f.id);
                    map[key] = f;
                }
                return rowsArr.map(r => ({ ...r, messages: (map[r.idThread ?? r.id ?? String(r.id)]?.messages ?? r.messages ?? r.message ?? []) }));
            }

            const ensured = await ensureMessagesForRows(rows || []);
            const threads: Thread[] = (ensured || []).map((r: any) => {
                const msgs = r.message ?? r.messages ?? [];
                const parseTimestamp = (time : any) => {
                    try {
                        const d = ensureDate(time);
                        return d instanceof Date ? d : new Date(String(time));
                    } catch {
                        const n = Number(time);
                        if (!isNaN(n)) return new Date(n);
                        const p = Date.parse(String(time));
                        return isNaN(p) ? null : new Date(p);
                    }
                };
                const mappedMsgs = (msgs as any[]).map(m => {
                    const attachmentsRaw = m.attachments ?? m.attachment ?? [];
                    const mappedAttachments = (attachmentsRaw || []).map((a: any) => ({
                        fileName: a.fileName ?? a.name ?? '',
                        fileType: a.extension ?? a.fileType ?? '',
                        type: a.type ?? a.attributeType ?? 'file',
                        libraryId: a.libraryId ?? null,
                        status: 'sync',
                        data: a.data ? { sha256: a.data.sha256 ?? a.sha256 ?? '', data: a.data.data ?? '' } : (a.sha256 ? { sha256: a.sha256, data: '' } : undefined)
                    })).filter(Boolean);

                    return {
                        id: m.idMessage ?? m.id ?? '',
                        text: m.text ?? m.content ?? '',
                        thinking: m.thinking ?? '',
                        sender: m.sender ?? m.role ?? 'user',
                        timestamp: parseTimestamp(m.timestamp),
                        parentId: m.parentId ?? null,
                        status: m.status ?? 'sync',
                        attachments: mappedAttachments
                    };
                }) as any;
                return {
                    id: r.idThread ?? r.id ?? String(r.id),
                    name: r.name ?? defaultThreadName,
                    date: parseToUtc(r.updatedAt),
                    messages: mappedMsgs as any,
                    status: 'remote',
                    context: r.context ?? '',
                    model: r.model ?? getActualModel() ?? 'mistral-medium-latest',
                    share: false
                } as Thread;
            });
            try { setThreadCache(threads); } catch (e) {}
        
            return threads;
        } catch (err) {
            console.error('Failed to fetch threads via API', err);
            return [];
        }
    } catch (e) {
        return [];
    }
}
/**
 * Get the current list of threads. This function caches results in memory
 * and only fetches from the server once per session by using
 * `loadingThreadsPromise`.
 * @returns Promise resolving to an array of Thread objects
 */
export async function getThreads(): Promise<Thread[]> {
    if (allThreads.length > 0) return allThreads;
    if (loadingThreadsPromise) {
        try {
            await loadingThreadsPromise;
        } catch (e) {
        }
        return allThreads;
    }
    loadingThreadsPromise = (async () => {
            try {
            const loaded = await reloadThread();
            if (allThreads.length === 0 && Array.isArray(loaded)) {
                const map = new Map<string, Thread>();
                for (const t of loaded) {
                    const id = (t as any).id ?? String((t as any).id ?? '');
                    if (!map.has(id)) map.set(id, t);
                }
                allThreads.length = 0;
                allThreads.push(...Array.from(map.values()));
            }
            return allThreads;
        } finally {
            loadingThreadsPromise = null;
        }
    })();

    try {
        await loadingThreadsPromise;
    } catch (e) {
    }
    return allThreads;
}

/**
 * Request a share link for a remote thread from the server API. Returns a
 * URL string on success or null on failure.
 * @param thread - Thread to generate a share link for
 * @returns share URL or null
 */
export async function getShareLink(thread: Thread) : Promise<string | null | void> {
    // guests cannot request share codes (requires an authenticated user)
    if (isGuest()) return null;
    const result = await fetch('/api/thread', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'share', idThread: thread.id }) })
        .catch((e) => {
            console.error('Failed to notify server about sharing thread', e);
            return null;
        });
    if (!result || !result.ok) {
        console.error('Failed to notify server about sharing thread, non-ok response', result && (result as Response).status);
        return null;
    }

    const payload = await result.json().catch(() => null);
    const code = payload?.share?.code ?? payload?.code ?? null;
    if (!code) {
        console.error('Share API response did not contain a share code', payload);
        return null;
    }

    return `${window.location.origin}/s/${code}`;
}

/**
 * Get the active thread that was previously set via `setActualThread`.
 * Ensures the returned thread has a model assigned.
 * @returns Thread or null
 */
export function getActualThread() : Thread | null {
    const thread = (globalThis as any).actualThread ?? null;
    if (thread) {
        if (!thread.model) {
            thread.model = getActualModel() ?? 'mistral-medium-latest';
        }
    }
    return thread;
}

export function updateActualThread() {
    const ev = new CustomEvent('updateActualThread', { });
    window.dispatchEvent(ev);
}
export function updateAllThreadsList(updated: Thread) {
    const index = allThreads.findIndex(t => t.id === updated.id);
    if (index !== -1) allThreads[index] = updated;
    setActualThread(updated);
    updateActualThread();    
}

async function updateThreadList() {
    const ev = new CustomEvent('updateThreadList', { });
    window.dispatchEvent(ev);
}


export async function createServerThread(thread: Thread) {
    console.log('Creating server thread for', thread);
    try {
        // guests must never create remote threads
        if (isGuest()) return;
        if (thread.status === 'remote') return;
        thread.name = (await generateThreadName(thread)) || thread.name || defaultThreadName;
        try {
            const res = await fetch('/api/thread', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'create', data: {
                    idThread: thread.id,
                    name: thread.name,
                    context: thread.context,
                    model: thread.model,
                    createdAt: thread.date ? (thread.date instanceof Date ? thread.date.toISOString() : ensureIso(thread.date)) : utcNow().toISOString(),
                    updatedAt: thread.date ? (thread.date instanceof Date ? thread.date.toISOString() : ensureIso(thread.date)) : utcNow().toISOString(),
                } })
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                console.error('createServerThread API non-ok response', res.status, text);
                if (typeof window !== 'undefined') {
                    try { showErrorToast('Échec lors de la création du thread via API.'); } catch (e) {}
                }
                return;
            }

            thread.status = 'remote';
            updateThreadList();
            console.log('Thread created remotely', thread.id);
            allThreads.push(thread);
        } catch (err) {
            console.error('createServerThread API error', err);
            if (typeof window !== 'undefined') {
                try { showErrorToast('Erreur lors de la création du thread (API).'); } catch (e) {}
            }
        }

    } catch (e) {
        console.error('createServerThread error', e);
        if (typeof window !== 'undefined') {
            try { showErrorToast('Erreur lors de la création du thread.'); } catch (e) {}
        }
        return;
    }
}
export async function syncServerThread(thread: Thread) {
    try {
        if (isGuest()) return;
        const msgs = (thread.messages ?? []) as any[];
        if (msgs.length === 0) return;
        const toInsert = msgs
            // Skip messages that are already synced or explicitly cancelled locally
            .filter(m => m.status !== 'sync' && m.status !== 'cancelled')
            .map(m => ({
                idMessage: m.id,
                idThread: thread.id,
                sender: m.sender ?? m.role ?? 'user',
                text: m.text ?? m.content ?? '',
                thinking: m.thinking ?? '',
                parentId: m.parentId ?? null,
                // include attachments payload so server can persist files and Data
                attachments: (m.attachments ?? []).map((a: any) => ({
                    fileName: a.fileName ?? a.name ?? '',
                    fileType: a.fileType ?? a.extension ?? '',
                    type: a.type ?? a.attributeType ?? 'file',
                    libraryId: a.libraryId ?? null,
                    data: a.data ? { sha256: a.data.sha256 ?? a.sha256 ?? '', data: a.data.data ?? '' } : (a.sha256 ? { sha256: a.sha256, data: '' } : undefined)
                })).filter(Boolean),
                date: (() => {
                    const ts = m.timestamp ?? m.date ?? m.time ?? null;
                    if (ts == null) return utcNow().getTime();
                    if (typeof ts === 'number') return ts;
                    if (ts instanceof Date) return ts.getTime();
                    const parsed = Date.parse(String(ts));
                    if (!isNaN(parsed)) return parsed;
                    try {
                        const d = ensureDate(ts);
                        if (d instanceof Date) return d.getTime();
                    } catch {}
                    return utcNow().getTime();
                })()
            }));
        // Call API to sync messages
        try {
            const res = await fetch('/api/thread', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync', messages: toInsert }) });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                console.error('syncServerThread API non-ok response', res.status, text);
                if (typeof window !== 'undefined') try { showErrorToast('Échec de la synchronisation via API.'); } catch (e) {}
                return;
            }
            const json = await res.json().catch(() => ({}));
            try {
                // If server reports insertedIds, mark local messages and attachments as synced
                const insertedIds = (json && Array.isArray(json.insertedIds)) ? json.insertedIds : (json && typeof json.inserted === 'number' && Array.isArray(json.insertedIds) ? json.insertedIds : null);
                if (insertedIds && Array.isArray(insertedIds) && insertedIds.length > 0) {
                    const threadRef = thread;
                    const msgsRef = threadRef.messages ?? [] as any[];
                    let changed = false;
                    const insertedSet = new Set(insertedIds);
                    for (const m of msgsRef) {
                        if (m && m.id && insertedSet.has(m.id)) {
                            if (m.status !== 'sync') { m.status = 'sync'; changed = true; }
                            if (Array.isArray(m.attachments)) {
                                for (const a of m.attachments) {
                                    if (a && a.status !== 'sync') { a.status = 'sync'; changed = true; }
                                }
                            }
                        }
                    }
                    if (changed) {
                        try {
                            const all = readThreadCache();
                            const idx = all.findIndex((t: any) => t.id === threadRef.id);
                            if (idx !== -1) { all[idx] = threadRef; } else { all.push(threadRef); }
                            try { setThreadCache(all); } catch (e) {}
                        } catch (e) {}
                        try { setActualThread(threadRef); } catch (e) {}
                        try { updateActualThread(); } catch (e) {}
                    }
                }
            } catch (e) {
                console.error('Error processing sync response', e);
            }
        } catch (err) {
            console.error('syncServerThread API error', err);
            if (typeof window !== 'undefined') try { showErrorToast('Erreur lors de la synchronisation (API).'); } catch (e) {}
        }

    } catch (e) {
        console.error('syncServerThread error', e);
        if (typeof window !== 'undefined') {
            try { showErrorToast('Erreur lors de la synchronisation des messages.'); } catch (err) {}
        }
        return;
    }
}

export async function updateServerThread(thread: Thread) {
    try {
        if (isGuest()) return;
        if (!thread) return;

        // Ensure thread exists remotely first
        if ((thread.status as any) !== 'remote') {
            return;
        }

        const payload: any = {};
        if (typeof thread.name === 'string') payload.name = thread.name;
        if (typeof thread.context === 'string') payload.context = thread.context;
        if (typeof thread.model === 'string') payload.model = thread.model;

        const res = await fetch('/api/thread', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', idThread: thread.id, data: payload })
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            console.error('updateServerThread API non-ok response', res.status, text);
            return;
        }
        const json = await res.json().catch(() => null);
        if (json && json.thread) {
            thread.name = json.thread.name ?? thread.name;
            thread.context = json.thread.context ?? thread.context;
            thread.model = json.thread.model ?? thread.model;
        }
        updateActualThread();
    } catch (err) {
        console.error('updateServerThread error', err);
    }
}
/**
 * Fetch a paginated page of messages for a given external thread id.
 * @param idThread external thread id
 * @param limit number of messages to fetch (most recent first)
 * @param before ISO timestamp to fetch messages before
 */
export async function fetchThreadMessagesPage(idThread: string, limit: number = 50, before?: string) {
    try {
        // guests must not fetch private threads from the API. Shared threads
        // should be loaded via openSharedThread which uses a shareCode and is
        // permitted for guests. Here we simply avoid calling the API when
        // running as guest.
        if (isGuest()) return { ok: false, messages: [] };
        const url = new URL('/api/thread', window.location.origin);
        url.searchParams.set('idThread', idThread);
        url.searchParams.set('limit', String(limit));
        if (before) url.searchParams.set('before', before);
        const res = await fetch(url.toString());
        if (!res.ok) return { ok: false, messages: [] };
        const json = await res.json().catch(() => null);
        if (!json || !json.ok) return { ok: false, messages: [] };
        return { ok: true, messages: json.messages ?? [] };
    } catch (e) {
        console.error('fetchThreadMessagesPage failed', e);
        return { ok: false, messages: [] };
    }
}

/**
 * Load the initial page of messages for a thread and replace the thread's messages.
 * Useful after activating a remote thread to quickly populate the most recent messages.
 */
export async function loadInitialThreadMessages(threadId: string, limit: number = 50) {
    try {
        const page = await fetchThreadMessagesPage(threadId, limit, undefined);
        if (!page || !page.ok) return { ok: false, messages: [] };
        const normalized = page.messages.map((m: any) => ({
            id: String(m.idMessage ?? m.id ?? ''),
            text: String(m.text ?? ''),
            thinking: String(m.thinking ?? ''),
            sender: (m.sender === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
            timestamp: (m.timestamp ? new Date(m.timestamp) : new Date()),
            parentId: String(m.parentId ?? ''),
            status: 'sync' as const,
            attachments: (m.attachments ?? []) as any[]
        }) as Message);
        await replaceThreadMessages(threadId, normalized);
        return { ok: true, messages: normalized };
    } catch (e) {
        return { ok: false, messages: [] };
    }
}

/**
 * Load older messages before the provided ISO timestamp (or before the oldest known) and prepend them.
 */
export async function loadOlderMessages(threadId: string, beforeIso?: string, limit: number = 50) {
    try {
        const page = await fetchThreadMessagesPage(threadId, limit, beforeIso);
        if (!page || !page.ok) return { ok: false, messages: [] };
        const normalized = page.messages.map((m: any) => ({
            id: String(m.idMessage ?? m.id ?? ''),
            text: String(m.text ?? ''),
            thinking: String(m.thinking ?? ''),
            sender: (m.sender === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
            timestamp: (m.timestamp ? new Date(m.timestamp) : new Date()),
            parentId: String(m.parentId ?? ''),
            status: 'sync' as const,
            attachments: (m.attachments ?? []) as any[]
        }) as Message);
        // use the prepend helper which deduplicates and persists
        const updated = await prependMessagesToThread(threadId, normalized);
        return { ok: true, messages: normalized, updatedThread: updated };
    } catch (e) {
        return { ok: false, messages: [] };
    }
}

/**
 * Internal helper: persist thread into local cache and in-memory list,
 * and notify listeners if this is the active thread.
 */
function persistThread(thread: Thread) {
    try {
        // For guest sessions we only update the in-memory list and DO NOT
        // persist to localStorage or attempt any server-side sync. This
        // ensures guest threads are ephemeral and lost after refresh.
        const guest = isGuest();
        if (!guest) {
            const cache = readThreadCache() ?? [];
            const idx = cache.findIndex(t => t.id === thread.id);
            if (idx !== -1) cache[idx] = thread;
            else cache.push(thread);
            try { setThreadCache(cache); } catch (e) {}
        }

        // update in-memory index always so UI can see immediate changes
        const allIdx = allThreads.findIndex(t => t.id === thread.id);
        if (allIdx !== -1) allThreads[allIdx] = thread;
        else allThreads.push(thread);

        // if this is the active thread, update global and notify
        const active = getActualThread();
        if (active && active.id === thread.id) {
            try { setActualThread(thread); } catch (e) {}
            try { updateActualThread(); } catch (e) {}
        }
    } catch (e) {
        // swallow errors
    }
}

/** Append a single message to a thread (by id). Persists and notifies. */
export async function appendMessageToThread(threadId: string, message: Message) {
    try {
        let t = (getActualThread()?.id === threadId) ? getActualThread() : (readThreadCache(threadId) as Thread | null);
        if (!t) {
            // try fetching threads list
            t = await findThreadById(threadId) ?? null;
        }
        if (!t) return null;
        t.messages = t.messages ?? [];
        // avoid duplicate id
        if (message && message.id && t.messages.some(m => m.id === message.id)) return t;
        t.messages.push(message as any);
        persistThread(t);
        return t;
    } catch (e) {
        return null;
    }
}

/** Prepend messages to a thread (older messages). Deduplicates by id. */
export async function prependMessagesToThread(threadId: string, messages: Message[]) {
    try {
        let t = (getActualThread()?.id === threadId) ? getActualThread() : (readThreadCache(threadId) as Thread | null);
        if (!t) t = await findThreadById(threadId) ?? null;
        if (!t) return null;
        t.messages = t.messages ?? [];
        const existingIds = new Set(t.messages.map(m => m.id));
        const toAdd = (messages || []).filter(m => m && m.id && !existingIds.has(m.id));
        if (toAdd.length === 0) return t;
        t.messages = [...toAdd, ...t.messages];
        persistThread(t);
        return t;
    } catch (e) {
        return null;
    }
}

/** Update/replace a message in a thread by id. If not found, optionally append. */
export async function updateMessageInThread(threadId: string, message: Message, appendIfMissing: boolean = true) {
    try {
        let t = (getActualThread()?.id === threadId) ? getActualThread() : (readThreadCache(threadId) as Thread | null);
        if (!t) t = await findThreadById(threadId) ?? null;
        if (!t) return null;
        t.messages = t.messages ?? [];
        const idx = t.messages.findIndex(m => m.id === message.id);
        if (idx !== -1) {
            // merge fields onto existing object to preserve references
            try { Object.assign(t.messages[idx], message); } catch (e) { t.messages[idx] = message as any; }
        } else if (appendIfMissing) {
            t.messages.push(message as any);
        }
        persistThread(t);
        return t;
    } catch (e) {
        return null;
    }
}

/** Remove a message by id from a thread. */
export async function removeMessageFromThread(threadId: string, messageId: string) {
    try {
        let t = (getActualThread()?.id === threadId) ? getActualThread() : (readThreadCache(threadId) as Thread | null);
        if (!t) t = await findThreadById(threadId) ?? null;
        if (!t) return null;
        t.messages = (t.messages ?? []).filter(m => m.id !== messageId);
        persistThread(t);
        return t;
    } catch (e) {
        return null;
    }
}

/** Replace entire messages array for a thread. */
export async function replaceThreadMessages(threadId: string, messages: Message[]) {
    try {
        let t = (getActualThread()?.id === threadId) ? getActualThread() : (readThreadCache(threadId) as Thread | null);
        if (!t) t = await findThreadById(threadId) ?? null;
        if (!t) return null;
        t.messages = messages ?? [];
        persistThread(t);
        return t;
    } catch (e) {
        return null;
    }
}

export async function generateThreadName(thread: Thread) : Promise<string | null> {
    const history = getHistory(thread, getLastMessage(thread), 20);
    console.log('Generating thread name, history:', history);
    if (history.length === 0) return null;
    const client = new Mistral({apiKey: getApiKey()});
    const prompt = `Generate a short and descriptive title for the following conversation. The title should be concise, ideally under 5 words, and capture the main topic or theme of the discussion. In the language used in the conversation. Do not use quotation marks or punctuation in the title.`
    // Sanitize history: map to simple role/content objects to avoid sending extra fields (attachments, tool_calls, etc.)
    const messagesForApi: Array<{ role: string; content: string }> = [];
    for (const h of history) {
        try {
            const role = (h && (h.sender === 'assistant' || h.sender === 'system')) ? 'assistant' : 'user';
            let content = '';
            if (typeof h.text === 'string' && h.text.trim().length > 0) content = h.text.trim();
            else if (typeof (h as any).content === 'string' && (h as any).content.trim().length > 0) content = (h as any).content.trim();
            if (content.length > 0) messagesForApi.push({ role, content });
        } catch (e) {
            // ignore malformed entries
        }
    }
    // Append instruction as the final user message
    messagesForApi.push({ role: 'user', content: prompt });
    try {
        const chatResponse = await client.chat.complete({
            model: getActualModel() ?? 'ministral-3b-latest',
            messages: messagesForApi as any,
            stop: ["\n", "."],
        });
        console.log("Generated chatResponse:", chatResponse);
        const choice = chatResponse.choices[0];
        const msgContent: unknown = choice?.message?.content ?? "";
        if (typeof msgContent === "string") {
            return msgContent.trim()
        }

    }
    catch (e) {
        return null;
    }
    return null;

}


export type { Thread };