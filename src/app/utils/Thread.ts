import { useThreads } from './ThreadsProvider';

export function selectThreadById(id:number) {
    console.log("Selected thread ID:", id);

}
export function newThread() {
    console.log("New thread created");
}

export function getThreads() {
    return useThreads().threads;
}