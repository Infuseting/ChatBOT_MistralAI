import { getApiKey } from "./ApiKey";

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

export function getFastModelList(): string[] {
    try {
        if (typeof window === 'undefined' || !window.localStorage) {
            return ['mistral-large-latest', 'mistral-medium-2505'];
        }
        return window.localStorage.getItem('fastModelList')?.split(',') ?? ['mistral-large-latest', 'mistral-medium-2505'];
    } catch (e) {
        return ['mistral-large-latest', 'mistral-medium-2505'];
    }
}
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