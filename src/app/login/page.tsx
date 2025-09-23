"use client";

import { useState, useEffect } from "react";
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";
import { useRouter } from "next/navigation";

export default function LoginPage() {
    const [redirect_url, setRedirectUrl] = useState<string | null>(null);

    useEffect(() => {
        if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            setRedirectUrl(params.get("redirect"));
        }
    }, []);
    
    const router = useRouter();

    useEffect(() => {
        const stored = typeof window !== "undefined" ? localStorage.getItem("google_credential") : null;
        if (stored) {
            router.replace(redirect_url || "/");
        }
    }, [router, redirect_url]);
    

    async function handleGoogleSuccess(credentialResponse: any) {
        const id_token = credentialResponse?.credential || credentialResponse?.id_token;
        if (!id_token) return;

        // send to server to create user and set session cookie
        try {
            const res = await fetch('/api/auth/google/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_token }),
            });
            if (res.ok) {
                // mark locally that we're authenticated (for client-side redirects)
                if (typeof window !== 'undefined') localStorage.setItem('google_credential', '1');
                router.replace(redirect_url || '/');
            } else {
                console.error('Server error', await res.text());
            }
        } catch (err) {
            console.error('Login failed', err);
        }
    }

    function handleGoogleError() {
        console.error('Google sign in failed');
    }

    return (
        <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID_HERE"}>
            <div className="min-h-screen flex items-center justify-center">
                <div className="p-8 rounded shadow-md w-full max-w-md">
                    <h1 className="text-2xl font-bold mb-4">Sign in</h1>
                    <GoogleLogin onSuccess={handleGoogleSuccess} onError={handleGoogleError} />
                </div>
            </div>
        </GoogleOAuthProvider>
    );
}
