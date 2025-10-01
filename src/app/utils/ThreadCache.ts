
// Try to find a thread in the current provider by id
// thread cache helpers - read/write synchronously from localStorage

import { Thread } from "../utils/Thread";

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