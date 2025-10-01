import { setActualThread, Thread, updateActualThread } from "./Thread";
import { readThreadCache, updateThreadCache } from "./ThreadCache";



export const activeRequests: Map<string, { controller: AbortController; assistantMessageId: string }> = new Map();

export function startActiveRequest(threadId: string, assistantMessageId: string) {
    try {
        const c = new AbortController();
        activeRequests.set(threadId, { controller: c, assistantMessageId });
        // notify UI that a request for this thread is active
        try {
            const t = (globalThis as any).actualThread ?? null;
            try { setActualThread(t); } catch (e) {}
            try { updateActualThread(); } catch (e) {}
        } catch (e) {}
        return c;
    } catch (e) {
        return null;
    }
}

export function isRequestActive(threadId: string) {
    try { return activeRequests.has(threadId); } catch { return false; }
}

export function cancelActiveRequest(threadId: string) {
    try {
        const entry = activeRequests.get(threadId);
        if (!entry) return false;
        try { entry.controller.abort(); } catch (e) {}

        // find thread either from global actualThread or from cache
        let t: Thread | null = (globalThis as any).actualThread ?? null;
        if (!t || t.id !== threadId) {
            try { t = readThreadCache(threadId) as Thread | null; } catch (e) { t = null; }
        }
        if (t) {
            const msgs = t.messages ?? [];
            const msg = msgs.find(m => m && m.id === entry.assistantMessageId);
            if (msg) {
                try {
                    msg.text = 'Annulé';
                    msg.thinking = '';
                    // mark this message as cancelled so it won't be synced to the server
                    msg.status = 'cancelled';
                } catch (e) {}
                try { updateThreadCache(t); } catch (e) {}
                try { setActualThread(t); } catch (e) {}
                try { updateActualThread(); } catch (e) {}
            }
        }
        activeRequests.delete(threadId);
        return true;
    } catch (e) {
        return false;
    }
}

