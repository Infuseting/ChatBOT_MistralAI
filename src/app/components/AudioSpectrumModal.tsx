"use client";

import { FaTimes, FaMicrophoneSlash, FaSignOutAlt } from 'react-icons/fa';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import useAudioAnalyzer, { playTTSForText, analyzerController } from '../utils/useAudioAnalyzer';
import { showErrorToast } from "../utils/toast";
import { Thread } from '../utils/Thread';

type Props = {
    onClose: () => void;
    thread?: Thread | null;
    // handleAudioSend accepts either a pre-existing data URL / URL string (legacy)
    // or an actual audio Blob. The Agent expects a Blob so this component will
    // send a Blob when available.
    handleAudioSend?: (thread: Thread, value: Blob | string) => Promise<void> | void;
}

export default function AudioSpectrumModal({ onClose, thread, handleAudioSend }: Props) {
    const { data, startMic, startFromAudioElement, stop, muted, toggleMute } = useAudioAnalyzer();
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const recognitionRef = useRef<any>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordingStreamRef = useRef<MediaStream | null>(null);
    const recordChunksRef = useRef<Blob[]>([]);
    const [currentTranscript, setCurrentTranscript] = useState('');
    const lastSpeechAtRef = useRef<number>(0);
    const speakingRef = useRef(false);
    const processingRef = useRef(false);
    const playingAudioRef = useRef<HTMLAudioElement | null>(null);
    const mutedRef = useRef(muted);
    const lastRecRestartAtRef = useRef<number>(0);
    const lastRecErrorAtRef = useRef<number>(0);
    const lastRecNetworkCountRef = useRef<number>(0);
    const lastRecNetworkBlockedAtRef = useRef<number>(0);
    const recBackoffRef = useRef<number>(30000); // start with 30s
    const REC_BACKOFF_MAX = 5 * 60 * 1000; // 5 minutes
    // Disable automatic recognition in production by default to avoid prod-only
    // network issues; users can enable it manually via the toggle.
    const defaultRecEnabled = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') ? false : true;
    const [recognitionEnabled, setRecognitionEnabled] = useState<boolean>(defaultRecEnabled);
    const silenceSendTimeoutRef = useRef<number | null>(null);

    // Try to start mic on mount, but show toast and close if microphone isn't available
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                await startMic();
                // start recording if not muted
                try { if (!muted) await startRecordingIfNeeded(); } catch (e) {}
            } catch (e) {
                console.error('Failed to start mic', e);
                // Show a toast then close the modal (user requested toast before closing)
                showErrorToast('Microphone non disponible ou permission refusée');
                try { onClose(); } catch (err) { }
            }
        })();

        // Setup SpeechRecognition if available
        try {
            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (SpeechRecognition) {
                const rec = new SpeechRecognition();
                rec.continuous = true;
                rec.interimResults = true;
                rec.lang = 'fr-FR';
                rec.onresult = (ev: any) => {
                    let interim = '';
                    let final = '';
                    for (let i = ev.resultIndex; i < ev.results.length; ++i) {
                        const r = ev.results[i];
                        if (r.isFinal) final += r[0].transcript;
                        else interim += r[0].transcript;
                    }
                    const text = (final + ' ' + interim).trim();
                    if (text) {
                        setCurrentTranscript(text);
                        lastSpeechAtRef.current = Date.now();
                        // reset any transient network error counters since we got a valid result
                        try { lastRecNetworkCountRef.current = 0; lastRecNetworkBlockedAtRef.current = 0; recBackoffRef.current = 30000; } catch (e) {}
                        speakingRef.current = true;
                        // If we had scheduled a pending send due to prior silence,
                        // cancel it because user resumed speaking.
                        try { if (silenceSendTimeoutRef.current) { clearTimeout(silenceSendTimeoutRef.current); silenceSendTimeoutRef.current = null; } } catch (e) {}
                        // start recording when we detect speech
                        try { startRecordingIfNeeded(); } catch (e) {}
                    }
                    // If we got a final result, stop recording and send the recorded audio
                    if (final && final.trim().length > 0) {
                        void sendRecordedAudio();
                    }
                };
                rec.onerror = (e: any) => {
                    // common benign errors like 'no-speech' or 'aborted' can fire
                    // frequently (for example when user is silent). Throttle
                    // warnings to avoid spamming the console. Treat 'network'
                    // errors specially: if they happen repeatedly, stop/abort
                    // recognition and inform the user.
                    const errType = e?.error || e?.type || e?.message || 'unknown';
                    const nowErr = Date.now();
                    if (errType === 'no-speech' || errType === 'aborted') {
                        // only warn at most once every 5s for these types
                        if (nowErr - lastRecErrorAtRef.current > 5000) {
                            console.debug('SpeechRecognition (ignored):', errType);
                            lastRecErrorAtRef.current = nowErr;
                        }
                        return;
                    }

                    if (errType === 'network') {
                        // throttle network warnings to at most once every 15s
                        if (nowErr - lastRecErrorAtRef.current > 15000) {
                            console.warn('SpeechRecognition network error', e);
                            lastRecErrorAtRef.current = nowErr;
                        }
                        // increment transient network error counter
                        lastRecNetworkCountRef.current = (lastRecNetworkCountRef.current || 0) + 1;
                        // if we see 3 network errors in short succession, abort and back off
                        if (lastRecNetworkCountRef.current >= 3) {
                            // Detach handlers and abort this recognition instance to stop any
                            // further events being emitted. Mark blocked until cooldown.
                            try {
                                try { rec.onresult = null; } catch {}
                                try { rec.onend = null; } catch {}
                                try { rec.onerror = null; } catch {}
                                try { rec.onstart = null; } catch {}
                                try { rec.onnomatch = null; } catch {}
                            } catch (ex) {}
                            try { rec.abort?.(); } catch (ex) {}
                            try { recognitionRef.current = null; } catch (ex) {}
                            lastRecNetworkBlockedAtRef.current = nowErr;
                            // increase backoff (exponential, capped)
                            recBackoffRef.current = Math.min(recBackoffRef.current * 2, REC_BACKOFF_MAX);
                            lastRecNetworkCountRef.current = 0;
                            try { showErrorToast(`Reconnaissance vocale indisponible (erreur réseau). Réessai dans ${Math.round(recBackoffRef.current/1000)}s`); } catch (ex) {}
                        }
                        return;
                    }

                    // other errors: warn (throttled by lastRecErrorAtRef to avoid spam)
                    if (nowErr - lastRecErrorAtRef.current > 5000) {
                        console.warn('SpeechRecognition error', e);
                        lastRecErrorAtRef.current = nowErr;
                    }
                };
                rec.onend = () => {
                    // try restart unless modal closed or muted; add backoff so we
                    // don't spin-restart on rapid failures.
                    if (cancelled) return;
                    if (mutedRef.current) return;
                    // If network errors recently blocked recognition, skip restart until backoff expires
                    const now = Date.now();
                    if (lastRecNetworkBlockedAtRef.current && (now - lastRecNetworkBlockedAtRef.current) < recBackoffRef.current) {
                        // schedule a delayed retry after the cooldown remaining
                        const remaining = recBackoffRef.current - (now - lastRecNetworkBlockedAtRef.current);
                        setTimeout(() => {
                            try { if (recognitionEnabled) rec.start(); } catch (e) {}
                        }, remaining);
                        return;
                    }
                    if (now - lastRecRestartAtRef.current < 500) {
                        // too-frequent restarts; wait a bit
                        setTimeout(() => {
                            try { rec.start(); } catch (e) {}
                        }, 700);
                        lastRecRestartAtRef.current = Date.now();
                        return;
                    }
                    try { rec.start(); } catch (e) {
                        // if start fails, schedule a delayed retry
                        setTimeout(() => { try { rec.start(); } catch {} }, 700);
                    }
                    lastRecRestartAtRef.current = now;
                };
                recognitionRef.current = rec;
                try { if (recognitionEnabled) rec.start(); } catch (e) { /* ignore start errors */ }
            }
        } catch (e) {
            console.warn('SpeechRecognition init failed', e);
        }

        return () => {
            cancelled = true;
            try { recognitionRef.current?.stop?.(); } catch {}
            stop();
            try { stopRecordingAndGetBlob(); } catch {}
        };
    }, []);

    // When muted change, ensure we stop any recording/recognition and avoid
    // capturing microphone data. When unmuted, try to restart mic (but don't
    // start recording until speech begins).
    useEffect(() => {
        mutedRef.current = muted;
        if (muted) {
            try { recognitionRef.current?.abort?.(); } catch {}
            try { stopRecordingAndGetBlob(); } catch {}
            try { stop(); } catch {}
        } else {
            // unmuted: try to restart mic/recognition
            (async () => {
                try { await startMic(); } catch (e) {}
                try { recognitionRef.current?.start?.(); } catch {}
            })();
        }
    }, [muted]);

    // continuous drawing with RAF, smoothing and rotation
    useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

        let rafId: number | null = null;
        const smoothRef = { values: new Float32Array(120).fill(0) };
        const rotationRef = { angle: 0 };

        function draw() {
            const c = canvasRef.current;
            if (!c) return;
            const ctx2 = c.getContext('2d');
            if (!ctx2) return;
            const width = c.width = c.clientWidth * devicePixelRatio;
            const height = c.height = c.clientHeight * devicePixelRatio;
            const cx = width / 2;
            const cy = height / 2;
            ctx2.clearRect(0, 0, width, height);

            // parameters
            const bins = data ? data.length : 0;
            const desiredBars = 120;
            const radius = Math.min(width, height) * 0.32; // slightly larger center
            // increase bar length so bars are more visible
            const maxBar = Math.min(width, height) * 0.36;

            // smoothing: exponential moving average
            const alpha = 0.12; // smoothing factor (0..1) smaller = more smoothing
            // Determine active portion: use only the first third of the analyser bins
            const activeBins = Math.max(1, Math.floor(bins / 3));
            for (let b = 0; b < desiredBars; b++) {
                const dataIndex = activeBins > 0 ? Math.floor(b * activeBins / desiredBars) : 0;
                const raw = data ? (data[dataIndex] / 255) : 0;
                smoothRef.values[b] = smoothRef.values[b] * (1 - alpha) + raw * alpha;
            }

            // If muted, clear all bars immediately
            if (muted) {
                for (let i = 0; i < smoothRef.values.length; i++) smoothRef.values[i] = 0;
            }

            // update rotation
            rotationRef.angle += 0.005; // rotation speed
            const baseAngle = rotationRef.angle;

            // draw background circle subtle
            ctx2.beginPath();
            ctx2.arc(cx, cy, radius - 6 * devicePixelRatio, 0, Math.PI * 2);
            ctx2.fillStyle = 'rgba(255,255,255,0.02)';
            ctx2.fill();

            for (let bar = 0; bar < desiredBars; bar++) {
                const v = smoothRef.values[bar];
                const len = radius + v * maxBar;
                const angle = bar * (Math.PI * 2 / desiredBars) - Math.PI / 2 + baseAngle;

                const x1 = cx + Math.cos(angle) * radius;
                const y1 = cy + Math.sin(angle) * radius;
                const x2 = cx + Math.cos(angle) * len;
                const y2 = cy + Math.sin(angle) * len;

                const hue = 200 - v * 200;
                const grad = ctx2.createLinearGradient(x1, y1, x2, y2);
                grad.addColorStop(0, `hsla(${hue},80%,60%,0.25)`);
                grad.addColorStop(1, `hsl(${hue},80%,60%)`);

                ctx2.strokeStyle = grad as unknown as string;
                // thicker bars to be more visible
                ctx2.lineWidth = Math.max(1.6, devicePixelRatio * 2.2);
                ctx2.lineCap = 'round';
                ctx2.beginPath();
                ctx2.moveTo(x1, y1);
                ctx2.lineTo(x2, y2);
                ctx2.stroke();
            }

            // center glow
            const glow = ctx2.createRadialGradient(cx, cy, 0, cx, cy, radius + maxBar * 0.2);
            glow.addColorStop(0, 'rgba(255,255,255,0.06)');
            glow.addColorStop(1, 'rgba(255,255,255,0.00)');
            ctx2.fillStyle = glow as unknown as string;
            ctx2.beginPath();
            ctx2.arc(cx, cy, radius + maxBar * 0.2, 0, Math.PI * 2);
            ctx2.fill();

            rafId = requestAnimationFrame(draw);
        }

        rafId = requestAnimationFrame(draw);

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [data]);

    // VAD: detect silence (no speech) and if user was speaking, send transcript
    useEffect(() => {
        let silenceTimer: number | null = null;
        function checkSilence() {
            // if we have recent speech timestamp, and no new speech for 800ms, consider end
            if (speakingRef.current && Date.now() - lastSpeechAtRef.current > 800) {
                // mark not speaking now and schedule send after 2s to allow user to think
                speakingRef.current = false;
                if (currentTranscript && currentTranscript.trim().length > 0) {
                    try {
                        if (silenceSendTimeoutRef.current) {
                            // already scheduled
                            return;
                        }
                        silenceSendTimeoutRef.current = window.setTimeout(() => {
                            // double-check silence hasn't been cancelled/resumed
                            try {
                                if (!speakingRef.current && Date.now() - lastSpeechAtRef.current > 800) {
                                    void sendRecordedAudio();
                                }
                            } finally {
                                silenceSendTimeoutRef.current = null;
                            }
                        }, 2000);
                    } catch (e) {
                        // fallback: immediate send
                        void sendRecordedAudio();
                    }
                }
            }
        }
        silenceTimer = window.setInterval(checkSilence, 300);
        return () => {
            if (silenceTimer) clearInterval(silenceTimer);
            try { if (silenceSendTimeoutRef.current) { clearTimeout(silenceSendTimeoutRef.current); silenceSendTimeoutRef.current = null; } } catch (e) {}
        };
    }, [currentTranscript]);

    
    async function startRecordingIfNeeded() {
        try {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') return;
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            recordingStreamRef.current = stream;
            recordChunksRef.current = [];
            const mr = new MediaRecorder(stream);
            mr.ondataavailable = (ev) => {
                if (ev.data && ev.data.size > 0) recordChunksRef.current.push(ev.data);
            };
            mr.start();
            mediaRecorderRef.current = mr;
        } catch (e) {
            console.warn('startRecordingIfNeeded failed', e);
        }
    }

    async function stopRecordingAndGetBlob(): Promise<Blob | null> {
        return new Promise((resolve) => {
            try {
                const mr = mediaRecorderRef.current;
                if (!mr) {
                    // nothing recorded
                    if (recordingStreamRef.current) {
                        recordingStreamRef.current.getTracks().forEach(t => t.stop());
                        recordingStreamRef.current = null;
                    }
                    resolve(null);
                    return;
                }
                mr.onstop = () => {
                    try {
                        const chunks = recordChunksRef.current as Blob[];
                        const blob = new Blob(chunks, { type: 'audio/webm' });
                        // cleanup
                        try { recordingStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
                        recordingStreamRef.current = null;
                        mediaRecorderRef.current = null;
                        recordChunksRef.current = [];
                        resolve(blob);
                    } catch (err) {
                        resolve(null);
                    }
                };
                try { mr.stop(); } catch (e) { mr.onstop?.(e as any); }
            } catch (e) {
                console.warn('stopRecordingAndGetBlob failed', e);
                try { recordingStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
                recordingStreamRef.current = null;
                mediaRecorderRef.current = null;
                recordChunksRef.current = [];
                resolve(null);
            }
        });
    }

    // Called when we want to send the recorded audio to the agent (instead of
    // sending the transcribed text). This replaces the previous text-based
    // flow. It stops recognition briefly while sending, and restores things
    // afterwards.
    async function sendRecordedAudio() {
        if (processingRef.current) return;
        processingRef.current = true;
        try {
            try { recognitionRef.current?.abort?.(); } catch {}
            const blob = await stopRecordingAndGetBlob();
            if (!blob) {
                return;
            }

            if (thread && handleAudioSend) {
                try {
                
                    try { analyzerController?.setMuted?.(true); } catch {}
                    await handleAudioSend(thread, blob as Blob);
                } catch (e) {
                    console.error('handleAudioSend failed', e);
                }
            }
        } finally {
            processingRef.current = false;
            // restart recognition unless muted
            try { if (!mutedRef.current) recognitionRef.current?.start?.(); } catch {}
            setCurrentTranscript('');
        }
    }

    // Handle audio file selection and play via an <audio> element
    // Removed audio file loading functionality

    return (
        <div className="fixed inset-0 z-150 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-3xl" onClick={onClose} />
            <div className="relative flex flex-col bg-gray-800 pb-20 text-white rounded-lg xl:w-[40%] lg:w-[50%] md:w-[70%] sm:w-[80%] w-[90%] max-h-[80%] h-full shadow-lg">
                <nav className="flex flex-row justify-between items-center w-full px-6 py-3">
                    <h2 className="text-lg font-medium">Mistral Call</h2>
                    <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={onClose} className="w-8 h-8 p-2 rounded-md hover:bg-gray-700"><FaTimes /></motion.button>
                </nav>
                <div className="h-px bg-gray-700 w-full"></div>
                <div className="flex-1 p-4 w-full min-h-0 flex flex-col">
                    <div className="flex-1 w-full min-h-0 p-2 rounded-md">
                        <canvas ref={canvasRef} className="w-full h-full" onClick={() => { void sendRecordedAudio(); }} />
                    </div>
                    <div className="flex justify-center items-center mt-3 space-x-2">
                        {/*<motion.button onClick={() => { toggleMute(); }} className={`p-2 rounded-md hover:bg-gray-700 flex items-center space-x-2 ${muted ? 'text-red-400' : ''}`} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <FaMicrophoneSlash className='w-8 h-8' />
                        </motion.button>*/}
                        {/* show network block badge + retry if recognition is blocked */}
                                {lastRecNetworkBlockedAtRef.current && (Date.now() - lastRecNetworkBlockedAtRef.current) < recBackoffRef.current ? (
                                    <div className="flex items-center space-x-2 p-2 rounded-md bg-red-700 text-white">
                                        <span>Reconnaissance vocale indisponible (erreur réseau)</span>
                                        <button onClick={async () => {
                                            try {
                                                // manual retry: reset backoff and try to start a new recognition instance
                                                recBackoffRef.current = 30000;
                                                lastRecNetworkBlockedAtRef.current = 0;
                                                const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
                                                if (!SpeechRecognition) return;
                                                const rec2 = new SpeechRecognition();
                                                rec2.continuous = true;
                                                rec2.interimResults = true;
                                                rec2.lang = 'fr-FR';
                                                // reuse the existing initialization logic by assigning and starting
                                                recognitionRef.current = rec2;
                                                try { rec2.start(); } catch (e) { console.warn('Retry start failed', e); }
                                            } catch (e) { console.warn('Retry init failed', e); }
                                        }} className="ml-2 p-2 bg-white text-black rounded-md">Réessayer</button>
                                    </div>
                                ) : (
                                    <div className="flex items-center space-x-2">
                                        <motion.button onClick={() => { stop(); onClose(); }} className="p-2 rounded-md hover:bg-gray-700 flex items-center space-x-2 text-yellow-400 ml-2" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                                            <FaSignOutAlt className='w-8 h-8' />
                                        </motion.button>
                                        <div className="ml-2 flex items-center space-x-2">
                                            <label className="text-sm text-gray-300">Reconnaissance</label>
                                            <button onClick={() => {
                                                try {
                                                    const next = !recognitionEnabled;
                                                    setRecognitionEnabled(next);
                                                    if (!next) {
                                                        try { recognitionRef.current?.abort?.(); } catch {}
                                                        recognitionRef.current = null;
                                                    } else {
                                                        try { recognitionRef.current?.start?.(); } catch {}
                                                    }
                                                } catch (e) {}
                                            }} className={`p-2 rounded-md ${recognitionEnabled ? 'bg-green-600' : 'bg-gray-600'} text-white`}>
                                                {recognitionEnabled ? 'On' : 'Off'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                    </div>
                </div>
            </div>
        </div>
    );
}
