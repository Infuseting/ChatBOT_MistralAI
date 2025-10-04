
// Message shape used throughout the application to represent a chat message.
// Fields:
// - id: unique identifier of the message
// - text: the visible content of the message
// - thinking: optional assistant internal content / tool output log
// - sender: either 'user' or 'assistant'
// - timestamp: Date when message was created/sent
// - parentId: id of the parent message (conversation thread linking)
// - status: 'sync' when persisted remotely, 'local' when local-only, 'cancelled' when generation was cancelled

import { updateThreadCache } from "./ThreadCache";
import { setActualThread, getActualThread,updateActualThread, Thread } from "./Thread";
import { Attachment } from "./Attachments";

// - attachmentId: optional id pointing to uploaded attachments or libraries
type Messages = Message[];
type Message = {
    id: string,
    text: string,
    thinking: string,
    sender: 'user' | 'assistant',
    timestamp: Date,
    parentId: string,
    status: 'sync' | 'local' | 'cancelled' | undefined,
    attachments: Attachment[]; 
}

export function cleanupCancelledMessages(thread: Thread, removeParentUser: boolean = false) {
    try {
        if (!thread || !thread.messages || thread.messages.length === 0) return;
        const msgs = thread.messages ?? [] as any[];
        // collect ids to remove
        const toRemove = new Set<string>();
        for (const m of msgs) {
            try {
                if (m && m.status === 'cancelled') {
                    toRemove.add(m.id);
                    if (removeParentUser && m.parentId) toRemove.add(m.parentId);
                }
            } catch (e) {}
        }
        if (toRemove.size === 0) return;
        thread.messages = msgs.filter(m => !toRemove.has(m.id));
        try { updateThreadCache(thread); } catch (e) {}
        try { setActualThread(thread); } catch (e) {}
        try { updateActualThread(); } catch (e) {}
    } catch (e) {}
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
        console.log(history);
        
        return history.reverse();
        
    } catch (e) {
        return [];
    }
}
export type { Message };

export type { Messages };
