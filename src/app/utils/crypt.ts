
export async function computeMD5(str: string): Promise<string> {
    // Encode input string to bytes
    try {
        let uint8: Uint8Array;
        if (typeof TextEncoder !== 'undefined') {
            uint8 = new TextEncoder().encode(str);
        } else if ((globalThis as any)?.Buffer) {
            uint8 = (globalThis as any).Buffer.from(str, 'utf-8');
        } else {
            // Last resort fallback encoding
            const binary = unescape(encodeURIComponent(str));
            const arr = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
            uint8 = arr;
        }

        // Prefer Web Crypto (available in browsers and some runtimes)
        const subtle = (globalThis as any)?.crypto?.subtle;
        if (subtle && typeof subtle.digest === 'function') {
            // Use SHA-256 (MD5 is not universally available in Web Crypto); returns hex string
            const hashBuffer = await subtle.digest('SHA-256', uint8);
            return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        }

        // Fallback to Node's crypto via dynamic import when running in Node
        try {
            const crypto = await import('crypto');
            const hash = crypto.createHash('sha256').update(Buffer.from(uint8)).digest('hex');
            return hash;
        } catch (e) {
            // ignore and continue to fallback
        }

        // Last-resort fallback: simple manual checksum (not cryptographic) to avoid returning empty
        let sum = 0;
        for (let i = 0; i < uint8.length; i++) sum = (sum + uint8[i]) & 0xffffffff;
        return sum.toString(16);
    } catch (e) {
        // On error return empty string
        return '';
    }
}
export async function toBase64(str: string) {
    try {
        // Browser path
        if (typeof window !== 'undefined' && typeof btoa === 'function') {
            return btoa(unescape(encodeURIComponent(str)));
        }
        // Node path
        try {
            // Buffer may be available in Node
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const buf = (globalThis as any).Buffer ? (globalThis as any).Buffer.from(str, 'utf-8') : null;
            if (buf) return buf.toString('base64');
            // dynamic import as fallback
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const nodeBuf = Buffer.from(str, 'utf-8');
            return nodeBuf.toString('base64');
        } catch (e) {
            // fallback to manual conversion
        }
        // Generic fallback
        if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(str)));
        return '';
    }
    catch (e) {
        return '';
    }
}

export async function fromBase64(b64: string): Promise<string> {
    try {
        const globalAny = globalThis as any;
        if (globalAny && globalAny.Buffer) {
            try {
                return globalAny.Buffer.from(b64, 'base64').toString('utf-8');
            } catch {

            }
        }

        // Browser path using atob + TextDecoder
        if (typeof window !== 'undefined' && typeof atob === 'function') {
            try {
                const binary = atob(b64);
                if (typeof TextDecoder !== 'undefined') {
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    return new TextDecoder().decode(bytes);
                }
                // Fallback using percent-encoding -> decodeURIComponent
                let percentEncoded = '';
                for (let i = 0; i < binary.length; i++) {
                    percentEncoded += '%' + ('00' + binary.charCodeAt(i).toString(16)).slice(-2);
                }
                return decodeURIComponent(percentEncoded);
            } catch {
                // fall through
            }
        }

        // Generic fallback: try atob if available
        if (typeof atob === 'function') {
            try {
                return atob(b64);
            } catch { /* ignore */ }
        }

        return '';
    } catch {
        return '';
    }
}


export function arrayBufferToBase64(data: ArrayBuffer) {
    try {
        // Browser path
        if (typeof window !== 'undefined' && typeof btoa === 'function') {
            let binary = '';
            const bytes = new Uint8Array(data);
            const chunkSize = 0x8000;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                binary += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes.subarray(i, i + chunkSize)));
            }
            return btoa(binary);
        }

        // Node path
        try {
            // Buffer may be available in Node
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const buf = (globalThis as any).Buffer ? (globalThis as any).Buffer.from(data) : null;
            if (buf) return buf.toString('base64');
            // dynamic import as fallback
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const nodeBuf = Buffer.from(data);
            return nodeBuf.toString('base64');
        } catch (e) {
            // fallback to manual conversion
        }

        // Generic fallback
        let binary = '';
        const bytes = new Uint8Array(data);
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        if (typeof btoa === 'function') return btoa(binary);
        return '';
    } catch (e) {
        return '';
    }
}



export function generateUUID() {
    if (typeof globalThis !== 'undefined' && (globalThis as any).crypto && typeof (globalThis as any).crypto.randomUUID === 'function') {
        return (globalThis as any).crypto.randomUUID();
    }
}