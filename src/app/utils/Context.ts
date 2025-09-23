export function getContext() {
    return localStorage.getItem('context') || '';
}

export function setContext(context: string) {
    localStorage.setItem('context', context);
}
