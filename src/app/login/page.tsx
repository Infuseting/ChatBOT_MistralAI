"use client";

import { useState, useEffect } from "react";
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";
import { useRouter } from "next/navigation";

export default function LoginPage() {
    const [redirect_url, setRedirectUrl] = useState<string | null>(null);
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            setRedirectUrl(params.get("redirect"));
        }
    }, []);
    
    const router = useRouter();

    useEffect(() => {
        
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

    async function handleEmailSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            const path = mode === 'login' ? '/api/auth/email/login' : '/api/auth/email/register';
            const res = await fetch(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, name: undefined }),
            });
            if (res.ok) {
                if (typeof window !== 'undefined') localStorage.setItem('google_credential', '1');
                router.replace(redirect_url || '/');
            } else {
                const txt = await res.text();
                setError(txt || 'Auth error');
            }
        } catch (err: any) {
            setError(err?.message || 'Network error');
        } finally {
            setLoading(false);
        }
    }

    return (
        <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID_HERE"}>
            <div className="min-h-screen flex items-center justify-center">
                <div className="p-8 rounded shadow-md w-full max-w-md">
                    <h1 className="text-2xl font-bold mb-4">Sign in</h1>
                        <p className="mb-6">This tool is not an official one is just project for learning some concepts.</p>
                        <div className="mb-4">
                            <div className="flex gap-2 mb-2">
                                <button className={`px-3 py-1 rounded ${mode==='login' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`} onClick={() => setMode('login')}>Login</button>
                                <button className={`px-3 py-1 rounded ${mode==='register' ? 'bg-gray-700 text-white' : 'bg-gray-200'}`} onClick={() => setMode('register')}>Register</button>
                            </div>
                            <form onSubmit={handleEmailSubmit} className="flex flex-col gap-2 mb-2">
                                <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Email" className="p-2 rounded bg-gray-800 placeholder-gray-400" required />
                                <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" className="p-2 rounded bg-gray-800 placeholder-gray-400" required />
                                {error && <div className="text-red-400 text-sm">{error}</div>}
                                <button disabled={loading} type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded">{loading ? 'Please wait...' : mode==='login' ? 'Login' : 'Register'}</button>
                            </form>
                        </div>
                        <div className="mb-4">
                            <div className="flex items-center justify-center">
                                <span className="text-sm text-gray-400 mr-3">Or continue with</span>
                                <GoogleLogin onSuccess={handleGoogleSuccess} onError={handleGoogleError} />
                            </div>
                        </div>
                </div>
            </div>
        </GoogleOAuthProvider>
    );
}
