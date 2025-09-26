import { getContext } from './Context';
import { Message } from './Message';
import { Messages } from './Messages';
import { getAvailableModelList, getActualModel } from './Models';
import { Mistral } from '@mistralai/mistralai';
import { getApiKey } from './ApiKey';
import { getUser } from './User';
import { toast, Bounce } from 'react-toastify';
import { utcNow, utcNowPlus, ensureIso, ensureDate, parseToUtc } from './DateUTC';

type Thread = { id: string; name: string, date?: Date, messages?: Messages, status?: 'local' | 'remote' | 'unknown', context : string, model?: string, share: boolean };

const defaultThreadName = "New Thread";
const allThreads : Thread[] = [];
let loadingThreadsPromise: Promise<Thread[]> | null = null;
function generateUUID() {
    if (typeof globalThis !== 'undefined' && (globalThis as any).crypto && typeof (globalThis as any).crypto.randomUUID === 'function') {
        return (globalThis as any).crypto.randomUUID();
    }
}
   
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
export async function selectThreadById(id:string) {
    // prefer reading from persisted storage for sync selection
    const t = (await getThreads()).find(th => th.id === id) ?? null;
    if (t) setActualThread(t as Thread);
}

// Try to find a thread in the current provider by id
// thread cache helpers - read/write synchronously from localStorage
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
export async function findThreadById(id: string) : Promise<Thread | null> {
    try {
        const threads = await getThreads();
        return (threads.find(th => th.id === id) ?? null) as Thread | null;
    } catch (e) {
        return null;
    }
}

// Open a thread if found, otherwise create a new local thread and assign the provided id
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
                        status: 'sync'
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
                        status: m.status ?? 'sync'
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

export function getActualThread() : Thread | null {
    const thread = (globalThis as any).actualThread ?? null;
    if (thread) {
        if (!thread.model) {
            thread.model = getActualModel() ?? 'mistral-medium-latest';
        }
    }
    return thread;
}

function updateActualThread() {
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


export async function handleMessageSend(thread: Thread, content: string) {
    const lastMessage = getLastMessage(thread);
    const history = getHistory(thread, lastMessage);
    const userMessage: Message = {
        id: generateUUID() ?? '',
        text: content,
        thinking : "",
        sender: 'user',
    timestamp: utcNow(),
        parentId: lastMessage?.id ?? 'root',
        status: 'local'
    };
    const newMessage: Message = {
        id: generateUUID(),
        text: '...',
        thinking : '',
        sender: 'assistant',
    timestamp: utcNowPlus(1000),
        parentId: userMessage?.id ?? 'root',
        status: 'local'
    }
    thread.messages = [...(thread.messages ?? []), userMessage, newMessage];
        
    const client = new Mistral({apiKey: getApiKey()});

    const messagesList = [
            {
                role: "system",
                content: thread.context || getContext() || "You are a helpful assistant."
            },
            ...history,
            {
                role: "user",
                content: content
            },
        ];

    const chatResponse = await client.chat.complete({
        model: thread.model || getActualModel(),
        messages: messagesList as any,
    });
    if (!chatResponse || !chatResponse.choices || chatResponse.choices.length === 0) {
        newMessage.text = "Error: no response";
        newMessage.thinking = "";
        return;
    }
    const choice = chatResponse.choices[0];
    let finalText = "";
    const msgContent: unknown = choice?.message?.content ?? "";
    if (Array.isArray(msgContent)) {
        finalText = (msgContent as Array<{ type?: string; text?: string }>)
            .filter((block) => block?.type === "text")
            .map((block) => block?.text ?? "")
            .join("\n");
    } else if (typeof msgContent === "string") {
        finalText = msgContent;
    }
    let reasoning = "";
    const thinkingField: unknown = (choice as any)?.thinking ?? "";
    if (Array.isArray(thinkingField)) {
        reasoning = (thinkingField as Array<{ type?: string; thinking?: string }>)
            .filter((block) => block?.type === "thinking")
            .map((block) => block?.thinking ?? "")
            .join("\n");
    } else if (typeof thinkingField === "string") {
        reasoning = thinkingField;
    }
    newMessage.text = finalText;
    newMessage.thinking = reasoning;
    updateActualThread();
    if ((thread.status as any) !== 'remote') {
        await createServerThread(thread);
    }
    await syncServerThread(thread);
    thread.date = utcNow();
    updateAllThreadsList(thread);
    const url = `/${thread.id}`;
    if (typeof window !== 'undefined' && window.history && window.history.pushState) {
        window.history.pushState({}, '', url);
    } 
}

export async function handleRegenerateMessage(thread : Thread, message: Message, model : string) {
    if (message.sender !== 'assistant') return;
    if (!thread || !message) return;
    const msgs = thread.messages ?? [];
    const parentId = message.parentId ?? null;
    if (!parentId) return;

    const history = getHistory(thread, msgs.find(m => m.id === parentId) ?? null);
    const newMessage: Message = {
        id: generateUUID(),
        text: 'Regenerate Message',
        thinking : '',
        sender: 'assistant',
        timestamp: utcNowPlus(1000),
        parentId: parentId,
        status: 'local'
    }
    thread.messages = [...msgs, newMessage];
    updateActualThread();
    const client = new Mistral({apiKey: getApiKey()});
    const messagesList = [
            {
                role: "system",
                content: thread.context || getContext() || "You are a helpful assistant."
            },
            ...history,
        ];
    const chatResponse = await client.chat.complete({
        model: model || thread.model || getActualModel(),
        messages: messagesList as any,
    });
    if (!chatResponse || !chatResponse.choices || chatResponse.choices.length === 0) {
        newMessage.text = "Error: no response";
        newMessage.thinking = "";
        return;
    }
    const choice = chatResponse.choices[0];
    console.log('Regenerate choice', choice);
    let finalText = "";
    const msgContent: unknown = choice?.message?.content ?? "";
    if (Array.isArray(msgContent)) {
        finalText = (msgContent as Array<{ type?: string; text?: string }>)
            .filter((block) => block?.type === "text")
            .map((block) => block?.text ?? "")
            .join("\n");
    }
    else if (typeof msgContent === "string") {
        finalText = msgContent;
    }
    let reasoning = "";
    const thinkingField: unknown = (choice as any)?.thinking ?? "";
    if (Array.isArray(thinkingField)) {
        reasoning = (thinkingField as Array<{ type?: string; thinking?: string }>)
            .filter((block) => block?.type === "thinking")
            .map((block) => block?.thinking ?? "")
            .join("\n");
    }
    else if (typeof thinkingField === "string") {
        reasoning = thinkingField;
    }
    newMessage.text = finalText;
    newMessage.thinking = reasoning;
    updateActualThread();
    if ((thread.status as any) !== 'remote') {
        await createServerThread(thread);
    }
    await syncServerThread(thread);
    thread.date = utcNow();
    updateAllThreadsList(thread);
    const url = `/${thread.id}`;
    if (typeof window !== 'undefined' && window.history && window.history.pushState) {
        window.history.pushState({}, '', url);
    }
    return newMessage;    
}

export async function handleEditMessage(thread : Thread, message: Message, editMessage : string) {
    if (message.sender !== 'user') return;
    if (!thread || !message) return;
    const msgs = thread.messages ?? [];
    const parentId = message.parentId ?? null;
    if (!parentId) return;
    const history = getHistory(thread, msgs.find(m => m.id === parentId) ?? null);
    const newUserMessage: Message = {
        id: generateUUID(),
        text: editMessage,
        thinking : '',
        sender: 'user',
        timestamp: utcNowPlus(1000),
        parentId: parentId,
        status: 'local'
    }
    const newMessage: Message = {
        id: generateUUID(),
        text: '...',
        thinking : '',
        sender: 'assistant',
        timestamp: utcNowPlus(2000),
        parentId: newUserMessage.id,
        status: 'local'
    }
    thread.messages = [...msgs, newUserMessage, newMessage];
    updateActualThread();
    const client = new Mistral({apiKey: getApiKey()});
    const messagesList = [
            {
                role: "system",
                content: thread.context || getContext() || "You are a helpful assistant."
            },
            ...history,
            {
                role: "user",
                content: editMessage
            },
        ];
    const chatResponse = await client.chat.complete({
        model: thread.model || getActualModel(),
        messages: messagesList as any,
    });
    if (!chatResponse || !chatResponse.choices || chatResponse.choices.length === 0) {
        newMessage.text = "Error: no response";
        newMessage.thinking = "";
        return;
    }
    const choice = chatResponse.choices[0];
    let finalText = "";
    const msgContent: unknown = choice?.message?.content ?? "";
    if (Array.isArray(msgContent)) {
        finalText = (msgContent as Array<{ type?: string; text?: string }>)
            .filter((block) => block?.type === "text")
            .map((block) => block?.text ?? "")
            .join("\n");
    } else if (typeof msgContent === "string") {
        finalText = msgContent;
    }
    let reasoning = "";
    const thinkingField: unknown = (choice as any)?.thinking ?? "";
    if (Array.isArray(thinkingField)) {
        reasoning = (thinkingField as Array<{ type?: string; thinking?: string }>)
            .filter((block) => block?.type === "thinking")
            .map((block) => block?.thinking ?? "")
            .join("\n");
    }
    else if (typeof thinkingField === "string") {
        reasoning = thinkingField;
    }
    newMessage.text = finalText;
    newMessage.thinking = reasoning;
    updateActualThread();
    if ((thread.status as any) !== 'remote') {
        await createServerThread(thread);
    }
    await syncServerThread(thread);
    thread.date = utcNow();
    updateAllThreadsList(thread);
    const url = `/${thread.id}`;
    if (typeof window !== 'undefined' && window.history && window.history.pushState) {
        window.history.pushState({}, '', url);
    }

}

async function updateThreadList() {
    const ev = new CustomEvent('updateThreadList', { });
    window.dispatchEvent(ev);
}


async function createServerThread(thread: Thread) {
    try {
        if (thread.status === 'remote') return;
        if (thread.name === defaultThreadName)
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
                    try { toast.error('Échec lors de la création du thread via API.', { position: "bottom-right", autoClose: 5000, hideProgressBar: false, closeOnClick: false, pauseOnHover: true, draggable: true, progress: undefined, theme: "dark", transition: Bounce }); } catch (e) {}
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
                try { toast.error('Erreur lors de la création du thread (API).', { position: "bottom-right", autoClose: 5000, hideProgressBar: false, closeOnClick: false, pauseOnHover: true, draggable: true, progress: undefined, theme: "dark", transition: Bounce }); } catch (e) {}
            }
        }

    } catch (e) {
        console.error('createServerThread error', e);
        if (typeof window !== 'undefined') {
            try {
                toast.error('Erreur lors de la création du thread.', {
                    position: "bottom-right",
                    autoClose: 5000,
                    hideProgressBar: false,
                    closeOnClick: false,
                    pauseOnHover: true,
                    draggable: true,
                    progress: undefined,
                    theme: "dark",
                    transition: Bounce,
                });
            } catch (e) {}
        }
        return;
    }
}
async function syncServerThread(thread: Thread) {
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
            }));

        // Call API to sync messages
        try {
            const res = await fetch('/api/thread', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync', messages: toInsert }) });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                console.error('syncServerThread API non-ok response', res.status, text);
                if (typeof window !== 'undefined') try { toast.error('Échec de la synchronisation via API.', { position: "bottom-right", autoClose: 5000, hideProgressBar: false, closeOnClick: false, pauseOnHover: true, draggable: true, progress: undefined, theme: "dark", transition: Bounce }); } catch (e) {}
                return;
            }
            const json = await res.json().catch(() => ({}));
        } catch (err) {
            console.error('syncServerThread API error', err);
            if (typeof window !== 'undefined') try { toast.error('Erreur lors de la synchronisation (API).', { position: "bottom-right", autoClose: 5000, hideProgressBar: false, closeOnClick: false, pauseOnHover: true, draggable: true, progress: undefined, theme: "dark", transition: Bounce }); } catch (e) {}
        }

    } catch (e) {
        console.error('syncServerThread error', e);
        if (typeof window !== 'undefined') {
            try {
                toast.error('Erreur lors de la synchronisation des messages.', {
                    position: "bottom-right",
                    autoClose: 5000,
                    hideProgressBar: false,
                    closeOnClick: false,
                    pauseOnHover: true,
                    draggable: true,
                    progress: undefined,
                    theme: "dark",
                    transition: Bounce,
                });
            } catch (err) {}
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
    const history = getHistory(thread);
    if (history.length === 0) return null;
    const client = new Mistral({apiKey: getApiKey()});
    const prompt = `Generate a short and descriptive title for the following conversation. The title should be concise, ideally under 5 words, and capture the main topic or theme of the discussion. In the language used in the conversation. Do not use quotation marks or punctuation in the title.`
    const chatResponse = await client.chat.complete({
        model: thread.model || getActualModel(),
        messages: [
            ...history,
            {
                role: "user",
                content: prompt
            },
        ],
        stop: ["\n", "."],
    });
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