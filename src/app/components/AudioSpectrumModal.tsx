"use client";

import { FaTimes, FaMicrophoneSlash, FaSignOutAlt } from 'react-icons/fa';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import useAudioAnalyzer, { playTTSForText, analyzerController } from '../utils/useAudioAnalyzer';
import { VAD_CONFIG, computeThresholds } from '../utils/vadConfig';
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
    const { data, rms, noiseFloor, ambientNoise, startMic, startFromAudioElement, stop, muted, toggleMute } = useAudioAnalyzer();
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordingStreamRef = useRef<MediaStream | null>(null);
    const recordChunksRef = useRef<Blob[]>([]);
    const recordingStartedAtRef = useRef<number | null>(null);
    const [currentTranscript, setCurrentTranscript] = useState('');
    const lastSpeechAtRef = useRef<number>(0);
    const speakingRef = useRef(false);
    const speakingStartedAtRef = useRef<number | null>(null);
    const inSpeechSessionRef = useRef<boolean>(false);
    const preSpeechNoiseRef = useRef<number>(0);
    const processingRef = useRef(false);
    const playingAudioRef = useRef<HTMLAudioElement | null>(null);
    const mutedRef = useRef(muted);
    // SpeechRecognition removed: we rely solely on RMS/EMA from the analyzer
    const silenceSendTimeoutRef = useRef<number | null>(null);

    function resetVADState() {
        // Reset speaking/session state but do NOT clear recorded buffers or
        // recording timestamps — that prevents a valid recordedDuration from
        // accumulating and causes the send guard (MIN_RECORD_MS) to never pass.
        try { speakingRef.current = false; } catch {}
        try { speakingStartedAtRef.current = null; } catch {}
        try { inSpeechSessionRef.current = false; } catch {}
        try { preSpeechNoiseRef.current = 0; } catch {}
        // Do not touch recordChunksRef or recordingStartedAtRef here.
        // Also ensure we don't immediately send: clear any pending timeouts
        try { if (silenceSendTimeoutRef.current) { clearTimeout(silenceSendTimeoutRef.current); silenceSendTimeoutRef.current = null; } } catch (e) {}
    }

    // Try to start mic on mount, but show toast and close if microphone isn't available
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                await startMic();
                    try { analyzerController?.startAmbientCalibration?.(2000); } catch {}
                    // After starting the mic, reset local VAD state and recalibrate
                    try { resetVADState(); } catch {}
                    try { analyzerController?.recalibrateNoise?.(ambientNoise ?? undefined); } catch {}
                    // RNNoise: consumer can press "Load RNNoise" to attach a worklet
                    try { /* no-op: worklet is loaded manually from UI */ } catch (e) {}
                // start recording if not muted
                try { if (!muted) await startRecordingIfNeeded(); } catch (e) {}
            } catch (e) {
                console.error('Failed to start mic', e);
                // Show a toast then close the modal (user requested toast before closing)
                showErrorToast('Microphone non disponible ou permission refusée');
                try { onClose(); } catch (err) { }
            }
        })();

        // SpeechRecognition intentionally disabled. We rely on the analyzer's
        // RMS + EMA noise-floor for VAD and recording triggers. This avoids
        // browser-dependent SpeechRecognition network errors in production.

        return () => {
            cancelled = true;
            // SpeechRecognition removed; nothing to stop here.
            try { stop(); } catch {}
            try { speakingStartedAtRef.current = null; } catch {}
            try { stopRecordingAndGetBlob(); } catch {}
        };
    }, []);

    // When muted change, ensure we stop any recording/recognition and avoid
    // capturing microphone data. When unmuted, try to restart mic (but don't
    // start recording until speech begins).
    useEffect(() => {
        mutedRef.current = muted;
        if (muted) {
            // Stop capturing while muted
            try { stopRecordingAndGetBlob(); } catch {}
            try { stop(); } catch {}
            try { speakingStartedAtRef.current = null; } catch {}
        } else {
            // unmuted: try to restart mic
            (async () => {
                try { await startMic(); } catch (e) {}
            })();
        }
    }, [muted]);

    // Ensure we reset VAD state and recalibrate when unmuting / mic restarts
    useEffect(() => {
        if (!muted) {
            // small async task: after mic is started, reset VAD and recalibrate
            (async () => {
                try {
                    // give startMic a chance to create context/stream
                    await new Promise(r => setTimeout(r, 80));
                    try { resetVADState(); } catch {}
                    try { analyzerController?.recalibrateNoise?.(ambientNoise ?? undefined); } catch {}
                } catch (e) { /* ignore */ }
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
    // Use refs for `rms` and `noiseFloor` so the RAF loop below can run once
    // and preserve smoothing state across frequent `rms` updates.
    const rmsRef = useRef<number>(rms);
    useEffect(() => { rmsRef.current = rms ?? 0; }, [rms]);
    const noiseFloorRef = useRef<number>(noiseFloor ?? 0);
    useEffect(() => { noiseFloorRef.current = noiseFloor ?? 0; }, [noiseFloor]);

    useEffect(() => {
    const SILENCE_MS = VAD_CONFIG.SILENCE_MS;

    // Local smoothed RMS to avoid reacting to tiny spikes. Use a more
    // responsive smoothing so quiet/short utterances are detected.
    const smoothedRmsRef = { value: 0 };
    // Track a short-term speech level while the user is speaking. This is
    // used to compute a dynamic exit threshold so that end-of-speech is
    // detected relative to the user's own voice level rather than only the
    // ambient noise floor.
    const speechLevelRef = { value: 0 };
    // Temporary post-speech noise boost to prevent immediate re-triggering
    // when background music or other ambient rises after speech ends.
    const postSpeechNoiseRef = { value: 0 };
    const postSpeechExpiresRef = { value: 0 };

    // thresholds computed from config

        let silenceTimer: number | null = null;

        function onRms() {
            try {
                const v = rmsRef.current ?? 0;
                // smooth the incoming rms (short memory). Use a 50/50 mix to
                // be more responsive to brief utterances.
                smoothedRmsRef.value = smoothedRmsRef.value * 0.5 + v * 0.5;
                const smooth = smoothedRmsRef.value;

                // If we're in an active speech session, freeze the noise used
                // for decisioning to the pre-speech baseline so it doesn't
                // follow the voice. Otherwise use the current noise floor.
                const baseNoise = inSpeechSessionRef.current ? (preSpeechNoiseRef.current || noiseFloorRef.current || 0) : (noiseFloorRef.current ?? 0);
                const effectiveNoise = baseNoise + VAD_CONFIG.EFFECTIVE_NOISE_GAP;
                const { enter: ENTER_THRESH, exit: EXIT_THRESH } = computeThresholds(effectiveNoise);

                if (smooth >= ENTER_THRESH) {
                    // user speaking
                    if (!speakingRef.current) {
                        speakingStartedAtRef.current = Date.now();
                        // capture the noise baseline at the moment speech begins
                        try { preSpeechNoiseRef.current = (typeof ambientNoise === 'number' && ambientNoise > 0) ? ambientNoise : (noiseFloorRef.current ?? 0); } catch {}
                        inSpeechSessionRef.current = true;
                    }
                    lastSpeechAtRef.current = Date.now();
                    speakingRef.current = true;
                    // update short-term speech level (responsive)
                    speechLevelRef.value = speechLevelRef.value * 0.75 + smooth * 0.25;
                    // ensure recording started
                    try { startRecordingIfNeeded(); } catch (e) {}
                    // cancel any pending send
                    try { if (silenceSendTimeoutRef.current) { clearTimeout(silenceSendTimeoutRef.current); silenceSendTimeoutRef.current = null; } } catch (e) {}
                } else if (speakingRef.current) {
                    // While speaking, compute a dynamic exit threshold based on
                    // speech level and ambient noise. Also factor in any
                    // temporary post-speech noise boost.
                    const speechLevel = speechLevelRef.value || 0;
                    const postNoise = (postSpeechExpiresRef.value > Date.now()) ? postSpeechNoiseRef.value : 0;
                    const dynamicExit = Math.max(EXIT_THRESH, speechLevel * 0.45, effectiveNoise + 0.007, postNoise);
                    if (smooth < dynamicExit) {
                    // potentially silent — schedule detection after SILENCE_MS.
                    // When inside a speech session, use a longer timeout so
                    // short breaths / pauses are ignored.
                    const END_SILENCE_MS = inSpeechSessionRef.current ? VAD_CONFIG.SESSION_END_SILENCE_MS : SILENCE_MS;
                    if (silenceTimer) return;
                    silenceTimer = window.setTimeout(() => {
                        try {
                            if (Date.now() - lastSpeechAtRef.current >= END_SILENCE_MS) {
                                // If we recorded something reasonably long, force send
                                // even if levels are close to noise (avoids stuck state).
                                const recordedAt = recordingStartedAtRef.current;
                                const recordedDuration = recordedAt ? (Date.now() - recordedAt) : 0;
                                const speakingAt = speakingStartedAtRef.current;
                                const speakingDuration = speakingAt ? (Date.now() - speakingAt) : 0;
                                const MIN_RECORD_MS = VAD_CONFIG.MIN_RECORD_MS;
                                const MIN_SPEECH_MS = VAD_CONFIG.MIN_SPEECH_MS; // require at least this long of detected speech
                                // If measured ambient noise approximately equals the
                                // current smoothed level, allow a shorter gate so the
                                // message is still sent (handles the noise==level case).
                                const EPS_EQUAL = 0.001; // threshold for "approximately equal"
                                const approxEqual = Math.abs(smooth - baseNoise) <= EPS_EQUAL;
                                const SHORT_GATE_MS = VAD_CONFIG.SHORT_GATE_MS; // shorter minimum when approxEqual
                                if ((recordedDuration >= MIN_RECORD_MS || (approxEqual && recordedDuration >= SHORT_GATE_MS)) && speakingDuration >= MIN_SPEECH_MS) {
                                    speakingRef.current = false;
                                    speakingStartedAtRef.current = null;
                                    // speech session ends now
                                    inSpeechSessionRef.current = false;
                                    preSpeechNoiseRef.current = 0;
                                    void sendRecordedAudio();
                                    try {
                                        const boost = Math.max(effectiveNoise + VAD_CONFIG.EFFECTIVE_NOISE_GAP, speechLevelRef.value * 0.45, 0.01);
                                        postSpeechNoiseRef.value = boost;
                                        postSpeechExpiresRef.value = Date.now() + 1000;
                                    } catch (e) {}
                                } else {
                                    // Too short — ignore as likely noise/false trigger
                                }
                            }
                        } catch (e) {}
                        finally { if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; } }
                    }, END_SILENCE_MS);
                    }
                }
            } catch (e) { /* ignore */ }
        }

        // immediate check and then subscribe via RAF (loop runs once and reads refs)
        let rafId: number | null = null;
        function loop() {
            onRms();
            rafId = requestAnimationFrame(loop);
        }
        rafId = requestAnimationFrame(loop);

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            try { if (silenceTimer) clearTimeout(silenceTimer); silenceTimer = null; } catch (e) {}
            try { if (silenceSendTimeoutRef.current) { clearTimeout(silenceSendTimeoutRef.current); silenceSendTimeoutRef.current = null; } } catch (e) {}
        };
    }, []);

    
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
            recordingStartedAtRef.current = Date.now();
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
                    try { speakingStartedAtRef.current = null; } catch {}
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
                        recordingStartedAtRef.current = null;
                        try { speakingStartedAtRef.current = null; } catch {}
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
                recordingStartedAtRef.current = null;
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
            // SpeechRecognition removed; just stop the recorder and get blob
            const blob = await stopRecordingAndGetBlob();
            if (!blob) {
                return;
            }

            if (thread && handleAudioSend) {
                try {
                
                    try { analyzerController?.setMuted?.(true); } catch {}
                    await handleAudioSend(thread, blob as Blob);
                    // After sending, recalibrate the analyzer noise baseline so
                    // the next message isn't biased by the previous speech.
                    try { analyzerController?.recalibrateNoise?.(); } catch {}
                } catch (e) {
                    console.error('handleAudioSend failed', e);
                }
            }
        } finally {
            processingRef.current = false;
            // Nothing to restart (SpeechRecognition removed).
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

                <div className="h-px bg-gray-700 w-full" />

                <div className="flex-1 p-4 w-full min-h-0 flex flex-col">
                    <div className="flex-1 w-full min-h-0 p-2 rounded-md">
                        <canvas
                            ref={canvasRef}
                            className="w-full h-full"
                            onClick={() => {
                                // Force an immediate end-of-message send when user clicks canvas.
                                try { if (silenceSendTimeoutRef.current) { clearTimeout(silenceSendTimeoutRef.current); silenceSendTimeoutRef.current = null; } } catch (e) {}
                                try { void sendRecordedAudio(); } catch (e) {}
                            }}
                        />
                    </div>

                    <div className="flex flex-col items-center mt-3 space-y-2">
                        {typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production' && (
                            <div className="text-sm text-gray-300">
                                Level: <span className="font-mono">{rms.toFixed(3)}</span>{' '}
                                Noise: <span className="font-mono">{noiseFloor.toFixed(3)}</span>
                            </div>
                        )}
                        <div className="flex justify-center items-center space-x-2">
                            {/*
                                Uncomment to enable mute toggle
                            <motion.button onClick={() => { toggleMute(); }} className={`p-2 rounded-md hover:bg-gray-700 flex items-center space-x-2 ${muted ? 'text-red-400' : ''}`} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                                <FaMicrophoneSlash className='w-8 h-8' />
                            </motion.button>
                            */}

                            <motion.button onClick={() => { try { stop(); } catch {} try { speakingStartedAtRef.current = null } catch {} onClose(); }} className="p-2 rounded-md hover:bg-gray-700 flex items-center space-x-2 text-yellow-400 ml-2" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                                <FaSignOutAlt className='w-8 h-8' />
                            </motion.button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

