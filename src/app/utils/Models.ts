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
    
    return localStorage.getItem('fastModelList')?.split(',') ?? ['mistral-large-latest', 'mistral-medium-2505'];
}
export function setFastModelList(modelList: string[]) {
    localStorage.setItem('fastModelList', modelList.join(','));
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