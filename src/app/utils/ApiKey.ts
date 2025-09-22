export function getApiKey() {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return '';
        return window.localStorage.getItem('mistralApiKey') || '';
    } catch (e) {
        return '';
    }
}

export function setApiKey(apiKey: string) {
    console.log("Setting API Key:", apiKey);
    try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        window.localStorage.setItem('mistralApiKey', apiKey);
    } catch (e) {
        
    }
}

export function deleteApiKey() {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return;
        window.localStorage.removeItem('mistralApiKey');
    } catch (e) {
        
    }
}

export async function isValidApiKey(apiKey: string): Promise<boolean> {
    try {
        const response = await fetch("https://api.mistral.ai/v1/models", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
        });

        if (response.status === 401) {
            console.debug("❌ Invalid or missing API key.");
            return false;
        }

        if (!response.ok) {
            console.debug(`❌ Error: ${response.status} - ${response.statusText}`);
            return false;
        }

        const data = await response.json();
        console.log("✅ API key is valid. Available models:", data);
        return true;
    } catch (error) {
        console.debug("❌ Network or other error:", error);
        return false;
    }
}