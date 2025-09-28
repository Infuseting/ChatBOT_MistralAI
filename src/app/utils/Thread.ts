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

async function readFileAsDataURL(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
        try {
            const reader = new FileReader();
            reader.onerror = () => { reject(new Error('Failed to read file')); };
            reader.onload = () => { resolve(String(reader.result)); };
            reader.readAsDataURL(file);
        } catch (e) {
            reject(e);
        }
    });
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

function extractThinkingAndText(response: any) {
  const thinking: string[] = [];
  const texts: string[] = [];
  const web_references: Array<Record<string, any>> = [];

  if (!response || !Array.isArray(response.outputs)) {
    return { thinking, texts, web_references };
  }

  for (const output of response.outputs) {
    if (!output || !output.type) continue;
    if (output.type === "tool.execution" || output.type === "tool_exec" || output.type === "tool.execution.result") {
      const toolName = output.name ?? output.tool ?? 'tool';
      let argsStr = '';
      if (typeof output.arguments === 'string') {
        try {
          argsStr = JSON.stringify(JSON.parse(output.arguments));
        } catch {
          argsStr = output.arguments;
        }
      } else if (typeof output.arguments === 'object' && output.arguments !== null) {
        try {
          argsStr = JSON.stringify(output.arguments);
        } catch {
          argsStr = String(output.arguments);
        }
      } else {
        argsStr = String(output.arguments ?? '');
      }
      thinking.push(`Tool: ${toolName} → ${argsStr}`);
    }

    if (output.type === "message.output") {
      const content = output.content;
      if (typeof content === "string") {
        texts.push(content);
      } else if (Array.isArray(content)) {
        for (const item of content) {
          if (!item) continue;
          // plain text pieces
          if (item.type === "text" && typeof item.text === "string") {
            texts.push(item.text);
            continue;
          }
          if (typeof item === "string") {
            texts.push(item);
            continue;
          }
          if (item.type === "tool_reference" || item.type === "web_reference" || item.type === "tool.reference") {
            web_references.push({
              tool: item.tool ?? item.name ?? null,
              url: item.url ?? null,
              title: item.title ?? null,
              description: item.description ?? null,
              favicon: item.favicon ?? null,
              raw: item
            });
            continue;
          }
          if (typeof item.text === "string") {
            texts.push(item.text);
            continue;
          }
          if (typeof item.content === "string") {
            texts.push(item.content);
            continue;
          }
          if (Array.isArray(item.content)) {
            for (const sub of item.content) {
              if (sub && typeof sub === "object" && typeof sub.text === "string") texts.push(sub.text);
              else if (typeof sub === "string") texts.push(sub);
            }
          }
        }
      } else if (typeof content === "object" && content !== null) {
        if (typeof content.text === "string") texts.push(content.text);
        else if (typeof content.content === "string") texts.push(content.content);
        else if (Array.isArray(content.content)) {
          for (const item of content.content) {
            if (item && typeof item.text === "string") texts.push(item.text);
            else if (typeof item === "string") texts.push(item);
          }
        }
      }
    }
  }

  return { thinking, texts, web_references };
}
async function createAgent() {
    const client = new Mistral({apiKey: getApiKey()});
    await client.beta.agents.create({
        model: getActualModel(),
        name: "MistralAI Chat BOT Chat Agent",
        instructions: "Use the tools to answer the user's questions.",
        description: "Agent able to do anything.",
    });
}

async function existAgent() {
    const client = new Mistral({apiKey: getApiKey()});
    const agents = await client.beta.agents.list();
    return agents.some(a => a.name === "MistralAI Chat BOT Chat Agent");
}
async function getAgent() {
    const client = new Mistral({apiKey: getApiKey()});
    const agents = await client.beta.agents.list();
    return agents.find(a => a.name === "MistralAI Chat BOT Chat Agent");
}

async function createDocsLibrary(thread: Thread, userMessage: Message, files: File[]) {
    if (files.length === 0) return null;
    const client = new Mistral({apiKey: getApiKey()});
    const library =  await client.beta.libraries.create({
        name: `Library for thread ${userMessage.id}`,
        description: `Auto-created library for thread ${userMessage.id}`,
    });
    if (!library || !library.id) return null;

    const uploadedDocs: any[] = [];
    for (const file of files) {
        try {
            const uploadedDoc = await client.beta.libraries.documents.upload({
                libraryId: library.id,
                requestBody: { file: file as any },
            });
            if (uploadedDoc) uploadedDocs.push(uploadedDoc);
            try {
                console.log('uploaded doc', JSON.stringify(uploadedDoc, null, 2));
            } catch (e) {
                console.log('uploaded doc (raw)', uploadedDoc);
            }
        } catch (err) {
            console.error('Failed uploading document to library', err, file.name);
        }
    }

    // helper: poll document status using the dedicated status endpoint.
    // Treat common in-progress values as needing wait, and final states as done.
    const waitForProcessing = async (docId: string, timeoutMs = 180000, intervalMs = 2000) => {
        const start = Date.now();
        // status values we've seen: 'Running', 'Queued', 'Processing', 'Completed', 'Failed', 'Error'
        const inProgress = new Set(['running', 'queued', 'processing']);
        const success = new Set(['completed', 'done', 'succeeded']);
        const failed = new Set(['failed', 'error', 'errored']);

        while (Date.now() - start < timeoutMs) {
            try {
                // use the status endpoint which returns a ProcessingStatusOut
                const statusRes = await client.beta.libraries.documents.status({ libraryId: library.id, documentId: docId });
                console.log('Document status response', { documentId: docId, statusRes });
                const statusRaw = (statusRes as any)?.processingStatus ?? (statusRes as any)?.status ?? null;
                const status = statusRaw ? String(statusRaw).toLowerCase() : null;

                if (!status) {
                    // if we can't parse a status, try fetching full metadata as a fallback
                    try {
                        const info = await client.beta.libraries.documents.get({ libraryId: library.id, documentId: docId });
                        console.log('Document metadata fallback', info);
                        const fallbackStatus = (info as any)?.processingStatus ?? (info as any)?.processing?.status ?? null;
                        const fb = fallbackStatus ? String(fallbackStatus).toLowerCase() : null;
                        if (fb && !inProgress.has(fb)) return info;
                    } catch (e) {
                        // ignore and continue
                    }
                } else {
                    if (success.has(status)) {
                        // finished successfully
                        try {
                            const info = await client.beta.libraries.documents.get({ libraryId: library.id, documentId: docId });
                            return info;
                        } catch (e) {
                            return statusRes;
                        }
                    }
                    if (failed.has(status)) {
                        console.warn('Document processing failed', { documentId: docId, status });
                        return statusRes;
                    }
                    // if status is inProgress, wait and retry
                    if (!inProgress.has(status)) {
                        // unknown but not explicitly in-progress; treat as done
                        try {
                            const info = await client.beta.libraries.documents.get({ libraryId: library.id, documentId: docId });
                            return info;
                        } catch (e) {
                            return statusRes;
                        }
                    }
                }
            } catch (e) {
                console.warn('Error while polling document status, will retry', e);
            }
            await new Promise(r => setTimeout(r, intervalMs));
        }
        console.warn('Timeout while waiting for document processing', { documentId: docId, timeoutMs });
        return null;
    };

    // wait for each uploaded document to finish processing (best effort)
    for (const d of uploadedDocs) {
        try {
            const docId = d?.id ?? d?.documentId ?? d;
            const finalInfo = await waitForProcessing(docId);
            try {
                console.log('Final document info', JSON.stringify(finalInfo ?? d, null, 2));
            } catch (e) {
                console.log('Final document info (raw)', finalInfo ?? d);
            }
            // Try to fetch extracted text (if available) for debugging
            try {
                const textContent = await client.beta.libraries.documents.textContent({ libraryId: library.id, documentId: docId });
                try {
                    console.log('Extracted text content for document', docId, JSON.stringify(textContent, null, 2));
                } catch (e) {
                    console.log('Extracted text content for document', docId, textContent);
                }
            } catch (e) {
                console.warn('Could not fetch extracted text content for', docId, e);
            }
        } catch (e) {
            console.warn('Error while waiting for document processing', e);
        }
    }

    userMessage.attachmentId = library.id;
    return { library, uploadedDocs };
}

async function getDocsLibrary(libraryId: string) {
    const client = new Mistral({apiKey: getApiKey()});
    const libraries = await client.beta.libraries.list();
    return libraries.data.find(l => l.id === libraryId) ?? null;
}
export async function getDocsInLibrary(libraryId: string) {
    const client = new Mistral({apiKey: getApiKey()});
    const docs = await client.beta.libraries.documents.list({ libraryId });
    return docs;
}

async function updateAgent(thread: Thread, userMessage : Message, libraryId : string) {
    const client = new Mistral({apiKey: getApiKey()});
    
    const text = String(userMessage?.text ?? '').trim();

    const codeRegex = /```|(?:\b(?:code|script|javascript|typescript|python|java|c\+\+|cpp|c#|csharp|ruby|go|rust|bash|shell|sh|dockerfile|sql|query|compile|execute|run|debug|stack trace|traceback|function\s+\w+|class\s+\w+)\b)/i;
    const imageRegex = /\b(image|picture|photo|generate image|create image|render|illustration|draw|logo|portrait|avatar|icon|png|jpg|jpeg|svg|midjourney|dalle|stable diffusion|sdxl)\b/i;
    
    const needCodeInterpreter: boolean = codeRegex.test(text);
    const needWebSearch: boolean = true;
    const needImageGeneration: boolean = imageRegex.test(text);
    console.log(libraryId)
    const needFileTool: boolean = libraryId !== '';

    let agent = await getAgent();
    if (!agent) {
        // ensure agent exists
        if (!(await existAgent())) {
            await createAgent();
        }
        agent = await getAgent();
    }
    if (!agent || !agent.id) {
        throw new Error('Agent not available');
    }

    const tools: any[] = [];
    if (needWebSearch) tools.push({ type: "web_search" });
    if (needCodeInterpreter) tools.push({ type: "code_interpreter" });
    if (needImageGeneration) tools.push({ type: "image_generation" });
    if (needFileTool) tools.push({ type: "document_library", libraryIds: [libraryId] });

    const websearchAgent = await client.beta.agents.update({
        agentId: agent.id,
        agentUpdateRequest: {
            model: thread.model ?? getActualModel(),
            instructions: thread.context || getContext() || "You are a helpful assistant.",
            tools
        },
    });
    const library = await getDocsLibrary(libraryId);
    console.log('Using library', library);
    console.log('Updated/created agent with tools', websearchAgent);
    return websearchAgent;
    
}

async function runAgent(thread: Thread, userMessage: Message, files : File[] = [], messagesList: any[] = []) {
    const client = new Mistral({apiKey: getApiKey()});
    let libraryId =  userMessage.attachmentId
    console.log(userMessage)
    if (files.length > 0) {
        const docsLibrary = await createDocsLibrary(thread, userMessage, files);
        libraryId = (docsLibrary as any)?.library?.id ?? (docsLibrary as any)?.id ?? '';
    }
    if (!(await existAgent())) await createAgent();

    const updatedAgent = await updateAgent(thread, userMessage, libraryId ?? '');
    console.log('messagesList', messagesList);
    console.log('updatedAgent before starting conversation', updatedAgent);

    if (!updatedAgent || !updatedAgent.id) {
        console.error('No agent available to start the conversation. Aborting start call.', { updatedAgent });
        return { chatResponse: null, attachmentId: libraryId ?? null };
    }

    let chatResponse: any = null;
    try {
        const debugClient = new Mistral({ apiKey: getApiKey(), debugLogger: console });
        console.log('Starting conversation with agentId', updatedAgent.id, 'and inputs', messagesList);
        chatResponse = await debugClient.beta.conversations.start({
            agentId: updatedAgent.id,
            inputs: [
                ...messagesList
            ]
        });
        console.log('chatResponse', chatResponse);
    } catch (err) {
        console.error('Error starting conversation', err);
        // return the error wrapped so caller can handle it gracefully
        return { chatResponse: null, attachmentId: libraryId ?? null };
    }
    

    return { chatResponse, attachmentId: libraryId ?? null };

    
}
export async function handleMessageSend(thread: Thread, content: string, selectedFiles: File[] = []) {
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
        ,
        attachmentId: ''
    };
    const newMessage: Message = {
        id: generateUUID(),
        text: '...',
        thinking : '',
        sender: 'assistant',
    timestamp: utcNowPlus(1000),
        parentId: userMessage?.id ?? 'root',
        status: 'local',
        attachmentId: ''
    }
    thread.messages = [...(thread.messages ?? []), userMessage, newMessage];
        

    const messagesList = [
            
            ...history,
            {
                role: "user",
                content: content
            }
        ];

    
    const { chatResponse, attachmentId } = await runAgent(thread, userMessage, selectedFiles, messagesList);
    console.log(chatResponse);
    if (!chatResponse || !chatResponse.outputs || chatResponse.outputs.length === 0) {
        newMessage.text = "Error: no response";
        newMessage.thinking = "";
        return;
    }
    const { thinking, texts } = extractThinkingAndText(chatResponse);
    console.log('Thinking:', thinking, 'Texts:', texts);
    newMessage.text = texts.join('\n');
    newMessage.thinking = thinking.join('\n');
    updateActualThread();
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
    const userMessage : Message | null = msgs.find(m => m.id === parentId && m.sender === 'user') ?? null;
    if (!userMessage) return;
    if (!parentId) return;

    const history = getHistory(thread, msgs.find(m => m.id === parentId) ?? null);
    const newMessage: Message = {
        id: generateUUID(),
        text: 'Regenerate Message',
        thinking : '',
        sender: 'assistant',
        timestamp: utcNowPlus(1000),
        parentId: parentId,
        status: 'local',
        attachmentId: ''
    }
    thread.messages = [...msgs, newMessage];
    updateActualThread();
    const client = new Mistral({apiKey: getApiKey()});
    const messagesList = [
            
            ...history,
        ];
    const { chatResponse, attachmentId } = await runAgent(thread, userMessage, [], messagesList);
    console.log(chatResponse);
    if (!chatResponse || !chatResponse.outputs || chatResponse.outputs.length === 0) {
        newMessage.text = "Error: no response";
        newMessage.thinking = "";
        return;
    }
    const { thinking, texts } = extractThinkingAndText(chatResponse);
    newMessage.text = texts.join('\n');
    newMessage.thinking = thinking.join('\n');
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
        status: 'local',
        attachmentId: message.attachmentId
    }
    
    const newMessage: Message = {
        id: generateUUID(),
        text: '...',
        thinking : '',
        sender: 'assistant',
        timestamp: utcNowPlus(2000),
        parentId: newUserMessage.id,
        status: 'local',
        attachmentId: ''
    }
    thread.messages = [...msgs, newUserMessage, newMessage];
    updateActualThread();
    const client = new Mistral({apiKey: getApiKey()});
    const messagesList = [
            
            ...history,
            {
                role: "user",
                content: editMessage
            },
            
        
        ];
    const { chatResponse, attachmentId } = await runAgent(thread, newUserMessage, [], messagesList);
    console.log(chatResponse);
    if (!chatResponse || !chatResponse.outputs || chatResponse.outputs.length === 0) {
        newMessage.text = "Error: no response";
        newMessage.thinking = "";
        return;
    }
    const { thinking, texts } = extractThinkingAndText(chatResponse);
    newMessage.text = texts.join('\n');
    newMessage.thinking = thinking.join('\n');

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
                attachmentId: m.attachmentId
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