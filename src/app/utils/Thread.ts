import { getContext } from './Context';
import { Message } from './Message';
import { Messages } from './Messages';
import { getAvailableModelList, getActualModel } from './Models';
import { Mistral } from '@mistralai/mistralai';
import { getApiKey } from './ApiKey';

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

function updateActualThread() {
    const ev = new CustomEvent('updateActualThread', { });
    window.dispatchEvent(ev);
}



export async function handleMessageSend(thread: Thread, lastMessage : Message | null | undefined, content: string) {

    const history = getHistory(thread, lastMessage).slice(-20);
    const userMessage: Message = {
        id: generateUUID() ?? '',
        text: content,
        thinking : "",
        sender: 'user',
        timestamp: new Date(),
        parentId: lastMessage?.id ?? 'root'
    };
    const newMessage: Message = {
        id: generateUUID(),
        text: '...',
        thinking : '',
        sender: 'assistant',
        timestamp: new Date(),
        parentId: userMessage?.id ?? 'root'
    }
    updateActualThread();
    thread.messages = [...(thread.messages ?? []), userMessage];
        
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
    newMessage.timestamp = new Date();
    thread.messages = [...(thread.messages ?? []), newMessage];
    updateActualThread();

    
}


export function getHistory(thread: Thread, lastMessage?: Message | null): any[] {
    try {
        const msgs = (thread.messages ?? []) as any[];

        // find index of lastMessage if provided
        let endIndex = msgs.length - 1;
        if (lastMessage) {
            const idxById = (m: any) => (m && typeof m.id !== 'undefined' && (lastMessage as any).id !== 'undefined' && m.id === (lastMessage as any).id);
            const idx = msgs.findIndex(m => m === lastMessage || idxById(m));
            if (idx !== -1) endIndex = idx;
        }

        // slice from start to the lastMessage (inclusive)
        const slice = msgs.slice(0, endIndex + 1);

        // helper to format a message into text
        const format = (m: any) => {
            if (!m) return '';
            if (typeof m === 'string') return m;
            const content = typeof m.content === 'string' ? m.content : (m.text ?? m.body ?? JSON.stringify(m));
            const role = m.role || m.sender || m.from || m.author;
            return role ? {role, content} : {content};
        };

        const parts: any[] = [];
        for (const m of slice) {
            const f = format(m);
            if (f) parts.push(f);
        }

        return parts;   
    } catch (e) {
        return [];
    }
}
export type { Thread };