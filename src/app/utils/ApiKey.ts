export function getApiKey() {
    return localStorage.getItem('mistralApiKey') || '';
}

export function setApiKey(apiKey: string) {
    console.log("Setting API Key:", apiKey);
    localStorage.setItem('mistralApiKey', apiKey);
}

export function deleteApiKey() {
    localStorage.removeItem('mistralApiKey');
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