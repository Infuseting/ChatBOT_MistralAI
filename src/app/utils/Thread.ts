import { Messages } from './Messages';
import { getAvailableModelList, getActualModel } from './Models';
import { useThreads } from './ThreadsProvider';
import { toast } from 'react-toastify';

type Thread = { id: string; name: string, date?: Date, messages?: Messages, status?: 'local' | 'remote' | 'unknown', context : string, model?: string };


function generateUUID() {
    if (typeof globalThis !== 'undefined' && (globalThis as any).crypto && typeof (globalThis as any).crypto.randomUUID === 'function') {
        return (globalThis as any).crypto.randomUUID();
    }
}
   

export function selectThreadById(id:string) {
    console.log("Selected thread id:", id);

}
export function newThread() {
    const thread: Thread = {
        id: generateUUID(),
        name: "New Thread",
        date: new Date(),
        messages: [],
        status: 'local',
        context: '',
        model: getActualModel() ?? 'mistral-medium-latest'
    };
    (globalThis as any).actualThread = thread;
    return thread;
}

export function getThreads() {
    return useThreads().threads;
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