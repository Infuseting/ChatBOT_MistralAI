import { getContext } from './Context';
import { Attachment, Data, Message } from './Message';
import { Messages } from './Messages';
import { getAvailableModelList, getActualModel } from './Models';
import { Mistral } from '@mistralai/mistralai';
import { getApiKey } from './ApiKey';
import { getUser } from './User';
import { showErrorToast, showSuccessToast } from './toast';
import { utcNow, utcNowPlus, ensureIso, ensureDate, parseToUtc } from './DateUTC';
import *  as fs from 'fs';
import { generateUUID } from './crypt';

type Thread = { id: string; name: string, date?: Date, messages?: Messages, status?: 'local' | 'remote' | 'unknown', context : string, model?: string, share: boolean };

const defaultThreadName = "New Thread";
const allThreads : Thread[] = [];
let loadingThreadsPromise: Promise<Thread[]> | null = null;

   
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

// Try to find a thread in the current provider by id
// thread cache helpers - read/write synchronously from localStorage
/**
 * Read the thread cache from localStorage. When called without parameters
 * returns an array of threads; when called with an id returns a single thread
 * or null if not found.
 * @param id - optional id to retrieve a single thread
 * @returns Thread[] when no id is provided, Thread|null when id provided
 */
export function readThreadCache(): Thread[];
export function readThreadCache(id: string): Thread | null;
export function readThreadCache(id?: string): Thread[] | Thread | null {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return id ? null : [];

        // fast path: if id provided, check threadIds first
        if (id) {
            const ids = window.localStorage.getItem('threadIds');
            if (ids !== null) {
                if (ids === '') return null;
                const parts = ids.split(',');
                if (!parts.includes(id)) return null;
            }
        }

        const raw = window.localStorage.getItem('threads');
        if (!raw) return id ? null : [];
        const parsed = JSON.parse(raw) as Thread[];
        if (id) return (parsed.find(t => t.id === id) ?? null) as Thread | null;
        return parsed;
    } catch (e) {
        return id ? null : [];
    }
}
/**
 * Persist the list of threads to localStorage and update an index of ids.
 * This is a synchronous helper and swallows errors for safety.
 * @param list - array of Thread objects to persist
 */
export function setThreadCache(list: Thread[]) {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        window.localStorage.setItem('threads', JSON.stringify(list));
        try {
            const ids = list.map(t => t.id).join(',');
            window.localStorage.setItem('threadIds', ids);
        } catch (e) {}
    } catch (e) {}
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
    // persist newly created thread in cache
    try {
        const all = readThreadCache();
        all.push(thread);
        setThreadCache(all);
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
                    return {
                        id: m.idMessage ?? m.id ?? '',
                        text: m.text ?? m.content ?? '',
                        thinking: m.thinking ?? '',
                        sender: m.sender ?? m.role ?? 'user',
                        timestamp: ts,
                        parentId: m.parentId ?? null,
                        status: 'sync',
                        attachmentId: m.attachmentId
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
                // persist
                try { const all = readThreadCache(); all.push(thread); setThreadCache(all); } catch (e) {}
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
    try { const all = readThreadCache(); all.push(thread); setThreadCache(all); } catch (e) {}
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
        const all = readThreadCache();
        all.push(thread);
        setThreadCache(all);
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
                    
                    return {
                        id: m.idMessage ?? m.id ?? '',
                        text: m.text ?? m.content ?? '',
                        thinking: m.thinking ?? '',
                        sender: m.sender ?? m.role ?? 'user',
                        timestamp: parseTimestamp(m.timestamp),
                        parentId: m.parentId ?? null,
                        status: m.status ?? 'sync',
                        attachmentId: m.attachmentId
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

export function updateThreadCache(thread: Thread) {
    try {
        const cache = readThreadCache();
        const idx = cache.findIndex(t => t.id === thread.id);
        if (idx !== -1) {
            cache[idx] = thread;
        } else {
            cache.push(thread);
        }
        setThreadCache(cache);
    } catch (e) {}
}
export function updateActualThread() {
    
    const ev = new CustomEvent('updateActualThread', { });
    window.dispatchEvent(ev);
}

export function getLastMessage(thread: Thread) : Message | null | undefined {
    const msgs = thread.messages ?? [];
    console.log(msgs);
    if (msgs.length === 0) return null;
    try {
        // Robust timestamp extractor: supports Date, number (ms), ISO/string, or nested fields.
        const getTime = (m: any): number => {
            if (!m) return -1;
            const candidates = [m.timestamp, m.date, m.time, m.sentAt, m.createdAt, m.ts];
            for (const c of candidates) {
                if (c == null) continue;
                if (c instanceof Date) return c.getTime();
                if (typeof c === 'number' && !isNaN(c)) return c;
                try {
                    const parsed = Date.parse(String(c));
                    if (!isNaN(parsed)) return parsed;
                } catch {}
            }
            // try parsing direct string fields like m.timeStamp or m.raw
            try {
                const parsed = Date.parse(JSON.stringify(m));
                if (!isNaN(parsed)) return parsed;
            } catch {}
            return -1;
        };

        // Find the message with the largest timestamp. If none have timestamps, fall back to last element.
        let bestIndex = -1;
        let bestTime = -1;
        for (let i = 0; i < msgs.length; i++) {
            const m = msgs[i];
            const t = getTime(m);
            if (t > bestTime || (t === bestTime && i > bestIndex) && m.sender !== 'user') {
                console.log('New best time', t, 'at index', i, 'New one:', m, "Old one:", msgs[bestIndex]);
                bestTime = t;
                bestIndex = i;
            }
        }

        if (bestIndex === -1) {
            // no parsable timestamps, return last message
            return msgs[msgs.length - 1] as Message;
        }

        return msgs[bestIndex] as Message;
    } catch (e) {
        return null;
    }

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
        const msgs = (thread.messages ?? []) as any[];
        if (msgs.length === 0) return;
        const toInsert = msgs
            .filter(m => m.status !== 'sync')
            .map(m => ({
                idMessage: m.id,
                idThread: thread.id,
                sender: m.sender ?? m.role ?? 'user',
                text: m.text ?? m.content ?? '',
                thinking: m.thinking ?? '',
                parentId: m.parentId ?? null,
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
                })(),
                attachmentId: m.attachmentId
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

async function generateThreadName(thread: Thread) : Promise<string | null> {
    const history = getHistory(thread, getLastMessage(thread), 20);
    console.log('Generating thread name, history:', history);
    if (history.length === 0) return null;
    const client = new Mistral({apiKey: getApiKey()});
    const prompt = `Generate a short and descriptive title for the following conversation. The title should be concise, ideally under 5 words, and capture the main topic or theme of the discussion. In the language used in the conversation. Do not use quotation marks or punctuation in the title.`
    const chatResponse = await client.chat.complete({
        model: 'ministral-3b-latest',
        messages: [
            ...history,
            {
                role: "user",
                content: prompt
            },
        ],
        stop: ["\n", "."],
    });
    console.log("Generated chatResponse:", chatResponse);
    const choice = chatResponse.choices[0];
    const msgContent: unknown = choice?.message?.content ?? "";
    if (typeof msgContent === "string") {
        return msgContent.trim()
    }
    return null;

}

export function getHistory(thread: Thread, lastMessage?: Message | null, limit: number = 20): any[] {
    try {
        thread = thread ?? getActualThread() ?? null;
        let parentId = lastMessage?.id ?? null;
        console.log('getHistory parentId', parentId);
        console.log(thread);
        if (!thread || !parentId) return [];
        if (parentId === 'root') return [];
        if (!thread.messages || thread.messages.length === 0) return [];
        if (!lastMessage) return [];
        const history = [];

        while (history.length < limit && (parentId != null)) {
            const msg = (thread.messages ?? []).find(m => m.id === parentId);
            if (!msg) break;
            history.push({
                role: msg.sender === 'user' ? 'user' : 'assistant',
                content: msg.text ?? ''
            });
            parentId = msg.parentId ?? null;
            if (parentId === 'root') break;
            

        }
        
        
        return history;
        
    } catch (e) {
        return [];
    }
}
export type { Thread };