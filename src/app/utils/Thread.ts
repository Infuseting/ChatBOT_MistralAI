import { getContext } from './Context';
import { Messages } from './Messages';
import { getAvailableModelList, getActualModel } from './Models';
import { toast } from 'react-toastify';

type Thread = { id: string; name: string, date?: Date, messages?: Messages, status?: 'local' | 'remote' | 'unknown', context : string, model?: string, share: boolean };


function generateUUID() {
    if (typeof globalThis !== 'undefined' && (globalThis as any).crypto && typeof (globalThis as any).crypto.randomUUID === 'function') {
        return (globalThis as any).crypto.randomUUID();
    }
}
   

export function selectThreadById(id:string) {
    // prefer reading from persisted storage for sync selection
    const t = readThreadCache().find(th => th.id === id) ?? null;
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
export function findThreadById(id: string) : Thread | null {
    try {
        const threads = readThreadCache();
        return (threads.find(th => th.id === id) ?? null) as Thread | null;
    } catch (e) {
        return null;
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

// Open a thread if found, otherwise create a new local thread and assign the provided id
export function openOrCreateThreadWithId(id: string) : Thread {
    const existing = findThreadById(id);
    if (existing) {
        setActualThread(existing);
        return existing;
    }
    const thread: Thread = {
        id,
        name: `Thread ${id}`,
        date: new Date(),
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
export function openSharedThread(id: string) : Thread {
    const existing = findThreadById(id);
    if (existing) {
        setActualThread(existing);
        return existing;
    }
    const thread: Thread = {
        id,
        name: `Shared ${id}`,
        date: new Date(),
        messages: [],
        status: 'remote',
        context: '',
        model: getActualModel() ?? 'mistral-medium-latest',
        share: true
    };
    setActualThread(thread);
    try {
        const all = readThreadCache();
        all.push(thread);
        setThreadCache(all);
    } catch (e) {}
    return thread;
}
export function newThread() {
    const thread: Thread = {
        id: generateUUID(),
        name: "New Thread",
        date: new Date(),
        messages: [],
        status: 'local',
        context: getContext() ?? '',
        model: getActualModel() ?? 'mistral-medium-latest',
        share: false
    };
    setActualThread(thread);
    try {
        const all = readThreadCache();
        all.push(thread);
        setThreadCache(all);
    } catch (e) {}
    return thread;
}

export function setActualThread(thread: Thread | null) {
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

export function getThreads() : Array<Thread> {
    return []
}

export function getShareLink(thread: Thread) {
    return `${window.location.origin}/s/${thread.id}`;
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
export type { Thread };