import { getApiKey } from "./ApiKey";

// Helpers to manage available and "fast" model lists. These functions read
// and write model preferences to localStorage and provide fallbacks when
// running in non-browser environments.

// Fetch a list of available models from the remote Mistral API. Returns an
// array (possibly empty) on success or an empty array on any failure.
export async function getAvailableModelList() {
    const apiKey = getApiKey();
    try {
        const response = await fetch("https://api.mistral.ai/v1/models", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
        });

        if (response.status === 401) {
            return [];
        }

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        
        return data.data || [];
    } catch (error) {
        return [];
    }
}

// Return a small list of models considered "fast" or preferred for quick
// selection. This reads `fastModelList` from localStorage when available and
// falls back to a default list.
export function getFastModelList(): string[] {
    try {
        if (typeof window === 'undefined' || !window.localStorage) {
            return ['mistral-large-latest', 'mistral-medium-2505'];
        }
        const stored = window.localStorage.getItem('fastModelList');
        if (!stored) return ['mistral-large-latest', 'mistral-medium-2505'];
        const list = stored.split(',').map(s => s.trim()).filter(s => s.length > 0);
        return list.length ? list : ['mistral-large-latest', 'mistral-medium-2505'];
    } catch (e) {
        return ['mistral-large-latest', 'mistral-medium-2505'];
    }
}
// Persist a short list of models to localStorage and notify other parts of
// the UI via a CustomEvent (`fastModelListUpdated`). Also ensures
// `actualModel` stays valid and points to a known model.
export function setFastModelList(modelList: string[]) {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        window.localStorage.setItem('fastModelList', modelList.join(','));
        try {
            const event = new CustomEvent('fastModelListUpdated', { detail: modelList });
            window.dispatchEvent(event);
        } catch (e) {
        }
        try {
            const current = window.localStorage.getItem('actualModel');
            const first = modelList[0];
            const fallback = 'mistral-medium-latest';
            if (!current || !modelList.includes(current)) {
                const toSet = first ?? fallback;
                window.localStorage.setItem('actualModel', toSet);
                (globalThis as any).actualModel = toSet;
            }
        } catch (e) {
            
        }
    } catch (e) {
        
    }
}
export function appendFastModel(model: string) {
    const currentList = getFastModelList();
    if (!currentList.includes(model)) {
        currentList.push(model);
        setFastModelList(currentList);
        
    }
}
export function removeFastModel(model: string) {
    const currentList = getFastModelList();
    const newList = currentList.filter(m => m !== model);
    setFastModelList(newList);
}
export function isFastModel(model: string) {
    const currentList = getFastModelList();
    return currentList.includes(model);
}
export function clearFastModelList() {
    setFastModelList([]);
}
export function toggleFastModel(model: string) {
    if (isFastModel(model)) {
        removeFastModel(model);
    } else {
        appendFastModel(model);
    }
}

export async function setActualModel(model: string) {
    if (!model) return;
    if (model === (globalThis as any).actualModel) return;
    if (await getAvailableModelList().then(models => !models.find((m: { id: string }) => m.id === model))) return;
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem('actualModel', model);
        }
    } catch (e) {
        
    }
    (globalThis as any).actualModel = model;
}
export function getActualModel() {
    const fastList = getFastModelList();
    const fallback = 'mistral-medium-latest';
    try {
        const globalModel = (globalThis as any).actualModel;
        if (globalModel && fastList.includes(globalModel)) return globalModel;

        if (typeof window === 'undefined' || !window.localStorage) {
            return fastList[0] ?? fallback;
        }
        const stored = window.localStorage.getItem('actualModel');
        if (stored && fastList.includes(stored)) return stored;
        if (fastList.length > 0) return fastList[0];
        return fallback;
    } catch (e) {
        return fastList[0] ?? fallback;
    }
}