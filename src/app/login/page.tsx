"use client";

import { useState, useEffect } from "react";
import { GoogleOAuthProvider, GoogleLogin, useGoogleOneTapLogin, useGoogleLogin } from "@react-oauth/google";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { FaGoogle } from 'react-icons/fa';
import { IoIosMail } from "react-icons/io";
import { showErrorToast } from "../utils/toast";
function LoginInner({ redirectUrl }: { redirectUrl: string | null }) {
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showMailForm, setShowMailForm] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const router = useRouter();

    async function handleGoogleSuccess(credentialResponse: any) {
        const access_token = credentialResponse?.access_token;

        if (!access_token) {
            console.error('No access_token returned by Google', credentialResponse);
            showErrorToast('No token returned by Google');
            setError('No token returned by Google.');
            return;
        }

        try {
            const res = await fetch('/api/auth/google/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ access_token: access_token || null }),
            });
            if (res.ok) {
                if (typeof window !== 'undefined') localStorage.setItem('google_credential', '1');
                router.replace(redirectUrl || '/');
            } else {
                const txt = await res.text();
                console.error('Server error', txt);
                showErrorToast(txt || 'Server error while logging in with Google');
                setError(txt || 'Server error while logging in with Google');
            }
        } catch (err) {
            console.error('Login failed', err);
            showErrorToast('Network error during Google login');
            setError('Network error during Google login');
        }
    }

    function handleGoogleError() {
        showErrorToast('Google sign in failed');
        console.error('Google sign in failed');
    }

    useGoogleOneTapLogin({
        onSuccess: handleGoogleSuccess,
        onError: handleGoogleError,
        auto_select: false,
        cancel_on_tap_outside: true,
    });

    const googleLogin = useGoogleLogin({
        onSuccess: handleGoogleSuccess,
        onError: handleGoogleError,
        flow: 'implicit',
    });

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
                router.replace(redirectUrl || '/');
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
        <div className="min-h-screen w-full flex">
            <div className="min-h-full w-1/2 lg:block hidden">
                <img src="/login.png" alt="Login Image" className="object-cover w-full h-full"/>
            </div>
            <div className="w-1 bg-black min-h-full lg:block hidden"></div>
            <div className="lg:h-full h-screen md:w-1/2 w-full md:px-0 px-5 flex mx-auto justify-center items-center lg:py-[10%] py-0 it">
                <div className="p-8 rounded-md shadow-md w-full md:max-w-md max-w-lg  border-1 border-black">
                    
                    <div className="mb-4 flex flex-col gap-4">
                        {!showMailForm ? (
                            <>
                                <h1 className="text-2xl font-bold mb-4">Sign in</h1>
                                <p className="mb-6">This tool is not an official one is just project for learning some concepts.</p>
                                <motion.button type="button" onClick={() => googleLogin()} className="w-full flex items-center justify-center gap-3 border border-gray-300 rounded px-4 py-2 hover:shadow-sm hover:bg-gray-50 hover:text-black" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                                    <FaGoogle className="w-5 h-5" />
                                    <span className="text-sm font-medium">Continue with Google</span>
                                </motion.button>
                                <motion.button type="button" onClick={() => setShowMailForm(true)} className="w-full flex items-center justify-center gap-3 border border-gray-300 rounded px-4 py-2 hover:shadow-sm hover:bg-gray-50 hover:text-black" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                                    <IoIosMail className="w-5 h-5" />
                                    <span className="text-sm font-medium">Continue with Mail</span>
                                </motion.button>
                            </>
                        ) : (
                            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full">
                                <div className="flex justify-start">
                                    <button aria-label="close" onClick={() => setShowMailForm(false)} className="text-gray-500 hover:text-gray-800">✕</button>
                                </div>
                                <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3 mt-2">
                                    <label className="text-sm">Email</label>
                                    <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@example.com" className="p-2 rounded border bg-transparent" required />
                                    <label className="text-sm">Password</label>
                                    <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Password" className="p-2 rounded border bg-transparent" required />
                                    {error && <div className="text-red-500 text-sm">{error}</div>}
                                    <button disabled={loading} type="submit" className="bg-blue-600 text-white rounded py-2">{loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Register'}</button>
                                    <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); }} className="mt-2 text-sm underline text-blue-600">Switch to {mode === 'login' ? 'Register' : 'Login'}</button>
                                </form>
                            </motion.div>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    const [redirect_url, setRedirectUrl] = useState<string | null>('/');

    useEffect(() => {
        if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            setRedirectUrl(params.get("redirect"));
        }
    }, []);

    return (
        <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "YOUR_GOOGLE_CLIENT_ID_HERE"}>
            <LoginInner redirectUrl={redirect_url} />
        </GoogleOAuthProvider>
    );
}
