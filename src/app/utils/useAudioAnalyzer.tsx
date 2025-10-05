"use client";

import { useEffect, useRef, useState } from 'react';

/**
 * useAudioAnalyzer
 *
 * Small hook that sets up Web Audio API AnalyserNode for a given MediaStream
 * (microphone) or optional HTMLAudioElement. Exposes a Uint8Array of frequency
 * data that can be used to render a spectrum.
 */

// Module-level controller used so playTTSForText can drive the hook instance,
// stop the mic, connect the TTS audio to the analyser, then optionally restart mic.
export let analyzerController: {
    startFromAudioElement?: (el: HTMLAudioElement) => Promise<void>;
    stop?: () => void;
    startMic?: () => Promise<void>;
    getLastSourceType?: () => 'mic' | 'audio' | null;
    setMuted?: (v: boolean) => void;
    recalibrateNoise?: (base?: number) => void;
    startAmbientCalibration?: (durationMs?: number) => void;
} | null = null;
// Note: analyzerController will expose a `recalibrateNoise(base?: number)` method
// after the hook mounts. Call this from UI components to reset the noise
// estimator between messages (useful after sending audio so the baseline
// doesn't remain artificially high).

// Track a TTS audio element created by playTTSForText so it can be stopped
// (for example when the modal is closed before the TTS finishes or arrives).
let ttsAudioEl: HTMLAudioElement | null = null;

function stopTTSPlayback() {
    try {
        if (ttsAudioEl) {
            try { ttsAudioEl.pause(); } catch {}
            try { ttsAudioEl.onended = null; } catch {}
            try {
                const src = ttsAudioEl.src;
                if (src && src.startsWith('blob:')) URL.revokeObjectURL(src);
            } catch {}
            ttsAudioEl = null;
        }
    } catch (e) { /* ignore */ }
}

export async function playTTSForText(rawText: string) {
    try {
        if (!rawText) return;
        // Strip simple HTML tags and excessive whitespace
        const plain = String(rawText).replace(/<svg[\s\S]*?<\/svg>/gi, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (!plain) return;
        const resp = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: plain, lang: 'fr' }) });
        if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            console.warn('TTS provider returned error', txt);
            return;
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const audioEl = new Audio(url);
        audioEl.crossOrigin = 'anonymous';
        // remember this audio so it can be stopped externally if needed
        ttsAudioEl = audioEl;

        // If an analyzer hook instance is registered, use it so the analyzer's state
        // is updated and the mic can be resumed afterwards.
        const hadControllerAtStart = !!analyzerController;

        if (analyzerController) {
            const prevSource = analyzerController.getLastSourceType?.() ?? null;
            try {
                // stop current processing (e.g. mic)
                analyzerController.stop?.();
            } catch (e) { /* ignore */ }

            try {
                // connect audio element to analyzer
                await analyzerController.startFromAudioElement?.(audioEl);
            } catch (e) {
                console.warn('Could not attach TTS audio to analyzer, falling back to direct play', e);
            }

            // If analyzerController was removed while we fetched the TTS, don't play
            if (hadControllerAtStart && !analyzerController) {
                // modal closed or analyzer gone, abort play
                try { stopTTSPlayback(); } catch {}
                return;
            }

            try {
                await audioEl.play();
            } catch (e) {
                console.warn('TTS play failed', e);
            }

            audioEl.onended = async () => {
                try { URL.revokeObjectURL(url); } catch {}
                // clear tracked TTS
                if (ttsAudioEl === audioEl) ttsAudioEl = null;
                // if mic was the previous source, restart it
                // use controller-setMuted if available (can't access hook state directly here)
                try { analyzerController?.setMuted?.(false); } catch (e) { /* ignore */ }
                try {
                    if (prevSource === 'mic') {
                        await analyzerController?.startMic?.();
                    }
                } catch (e) { /* ignore restart errors */ }
            };

            return;
        }
        if (hadControllerAtStart && !analyzerController) {
            try { stopTTSPlayback(); } catch {}
            return;
        }

        try { await audioEl.play(); } catch (e) { console.warn('TTS play failed', e); }
        audioEl.onended = () => { try { URL.revokeObjectURL(url); } catch {} };
    } catch (e) {
        console.error('playTTSForText error', e);
    }
}
export default function useAudioAnalyzer() {
    const audioCtxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null>(null);
    const [data, setData] = useState<Uint8Array | null>(null);
    const [rms, setRms] = useState<number>(0);
    const [noiseFloor, setNoiseFloor] = useState<number>(0);
    const [ambientNoise, setAmbientNoise] = useState<number>(0);
    const rafRef = useRef<number | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const noiseEstimateRef = useRef<number>(0);
    const conversationNoiseRef = useRef<number>(0); // long-term baseline across the conversation
    const lastNoiseUpdateRef = useRef<number>(0);
    const ambientNoiseRef = useRef<number>(0);
    const calibrationSamplesRef = useRef<number[] | null>(null);
    const calibrationEndRef = useRef<number>(0);
    const noiseHoldUntilRef = useRef<number>(0);
    const [muted, setMuted] = useState(false);
    const lastSourceRef = useRef<{ type: 'mic' } | { type: 'audio'; audioEl: HTMLAudioElement } | null>(null);

    useEffect(() => {
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            try { audioCtxRef.current?.close?.(); } catch {}
            audioCtxRef.current = null;
            analyserRef.current = null;
            sourceRef.current = null;
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => t.stop());
                streamRef.current = null;
            }
            // unregister module controller on unmount
            analyzerController = null;
        };
    }, []);

    async function startMic() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('No getUserMedia available');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        streamRef.current = stream;
        lastSourceRef.current = { type: 'mic' };
        const ctx = audioCtxRef.current ?? new (window.AudioContext || (window as any).webkitAudioContext)();
        audioCtxRef.current = ctx;
        const analyser = analyserRef.current ?? ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyserRef.current = analyser;
        // Ensure analyser is NOT connected to destination for mic input to avoid
        // routing the microphone to the speakers (feedback). If a previous
        // audio-element source connected the analyser to the destination, try
        // to disconnect it here.
        try { analyser.disconnect?.(ctx.destination); } catch {}
        const src = ctx.createMediaStreamSource(stream);
        sourceRef.current = src;
        // Build a simple filter chain to reduce wind / low-frequency noise and cap highs
        try {
            const hp = ctx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = 80; // remove very low freq (wind)
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 8000; // cap high freqs
            src.connect(hp);
            hp.connect(lp);
            lp.connect(analyser);
        } catch (e) {
            // fallback: direct connect
            try { src.connect(analyser); } catch (err) {}
        }

        const bufferLength = analyser.frequencyBinCount;
        const freqArray = new Uint8Array(bufferLength);
        const timeArray = new Uint8Array(analyser.fftSize);

        function loop() {
            try {
                analyser.getByteFrequencyData(freqArray);
                setData(new Uint8Array(freqArray));

                // time-domain data for RMS/VAD
                analyser.getByteTimeDomainData(timeArray);
                // compute normalized RMS (0..1)
                let sum = 0;
                for (let i = 0; i < timeArray.length; i++) {
                    const v = (timeArray[i] - 128) / 128; // -1..1
                    sum += v * v;
                }
                const rmsVal = Math.sqrt(sum / timeArray.length);
                setRms(rmsVal);
                // If we're calibrating ambient noise, collect samples for a short window
                try {
                    if (calibrationSamplesRef.current && Date.now() <= calibrationEndRef.current) {
                        calibrationSamplesRef.current.push(rmsVal);
                    } else if (calibrationSamplesRef.current) {
                        // calibration window ended; compute mean
                        try {
                            const samples = calibrationSamplesRef.current;
                            if (samples && samples.length > 0) {
                                const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
                                ambientNoiseRef.current = mean;
                                setAmbientNoise(mean);
                                // ensure noiseFloor isn't below ambient measured
                                try { setNoiseFloor(prev => Math.max(prev, mean)); } catch {}
                                // also gently seed conversation baseline
                                try { conversationNoiseRef.current = mean; } catch {}
                            }
                        } catch (e) {}
                        calibrationSamplesRef.current = null;
                        calibrationEndRef.current = 0;
                    }
                } catch (e) {}
                // update adaptive noise estimate with asymmetric EMA:
                // - avoid increasing the noise estimate when the sample looks like speech
                // - when noise increases (not speech), track at alphaRise
                // - when noise decreases, decay at alphaFall
                try {
                    const prev = noiseEstimateRef.current || rmsVal;
                    // coefficients chosen to give perceptible adaptation without following voice peaks
                    const alphaRise = 0.06; // slower upward tracking so it doesn't chase voice
                    const alphaFall = 0.35; // faster fall so quieting is noticed

                    // Activity heuristic: refresh a hold window on any short-term
                    // activity (even moderate). This prevents the short-term
                    // estimator from increasing between words in a continuous
                    // utterance. Activity is detected if rms rises above a small
                    // absolute or relative gap vs prev.
                    const now = Date.now();
                    const activityCandidate = rmsVal > (prev + 0.006) || rmsVal > (prev * 1.05);
                    if (activityCandidate) {
                        // refresh hold period (do not allow upward updates for a bit)
                        noiseHoldUntilRef.current = now + 3000; // 3.0s hold
                        // slightly decay the estimate so it doesn't creep up
                        noiseEstimateRef.current = prev * 0.995;
                    } else if (now < noiseHoldUntilRef.current) {
                        // During hold, allow only decay (no upward tracking)
                        if (rmsVal < prev) {
                            noiseEstimateRef.current = prev * (1 - alphaFall) + rmsVal * alphaFall;
                        } else {
                            // keep previous or very slight decay
                            noiseEstimateRef.current = prev * 0.997;
                        }
                    } else {
                        if (rmsVal > prev) {
                            noiseEstimateRef.current = prev * (1 - alphaRise) + rmsVal * alphaRise;
                        } else {
                            noiseEstimateRef.current = prev * (1 - alphaFall) + rmsVal * alphaFall;
                        }
                    }

                    // update conversation-level baseline very slowly so it reflects
                    // long-term ambient conditions but is not polluted by speech.
                    try {
                        const convPrev = conversationNoiseRef.current || noiseEstimateRef.current;
                        const convAlpha = 0.005; // much slower adaptation (>>50s)
                        // Only update conversation baseline when we are NOT in an activityCandidate
                        if (!activityCandidate) {
                            conversationNoiseRef.current = convPrev * (1 - convAlpha) + noiseEstimateRef.current * convAlpha;
                        }
                    } catch (e) {}

                    // publish a stable noiseFloor about 5x/sec using the short-term
                    // estimator which is now guarded against following speech peaks.
                    const nowTick = Date.now();
                    if (nowTick - lastNoiseUpdateRef.current > 180) {
                        lastNoiseUpdateRef.current = nowTick;
                        // use the short-term estimate as the published floor; keep a
                        // tiny minimum to avoid zero values.
                        setNoiseFloor(Math.max(0.0005, noiseEstimateRef.current));
                    }
                } catch (e) {}
            } catch (e) {
                // ignore
            }
            rafRef.current = requestAnimationFrame(loop);
        }
        loop();
    }
    

    async function startFromAudioElement(audioEl: HTMLAudioElement) {
        const ctx = audioCtxRef.current ?? new (window.AudioContext || (window as any).webkitAudioContext)();
        audioCtxRef.current = ctx;
        const analyser = analyserRef.current ?? ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyserRef.current = analyser;
        // disconnect previous source if any
        try { sourceRef.current?.disconnect?.(); } catch {}
        const src = ctx.createMediaElementSource(audioEl);
        sourceRef.current = src;
        src.connect(analyser);
        // ensure audio is audible for playback sources: connect analyser -> destination
        // but avoid routing microphone stream to destination (feedback). Only connect
        // the analyser to destination when the source is an HTMLAudioElement (playback).
        try {
            // Connect analyser to destination so TTS playback is heard through speakers
            analyser.connect(ctx.destination);
        } catch {}
        lastSourceRef.current = { type: 'audio', audioEl };

        const bufferLength = analyser.frequencyBinCount;
        const freqArray = new Uint8Array(bufferLength);
        const timeArray = new Uint8Array(analyser.fftSize);
        function loop() {
            try {
                analyser.getByteFrequencyData(freqArray);
                setData(new Uint8Array(freqArray));
                analyser.getByteTimeDomainData(timeArray);
                let sum = 0;
                for (let i = 0; i < timeArray.length; i++) {
                    const v = (timeArray[i] - 128) / 128;
                    sum += v * v;
                }
                const rmsVal = Math.sqrt(sum / timeArray.length);
                setRms(rmsVal);
            } catch (e) {}
            rafRef.current = requestAnimationFrame(loop);
        }
        loop();
    }

    function stop() {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        try { sourceRef.current?.disconnect?.(); } catch {}
        try { analyserRef.current?.disconnect?.(); } catch {}

        // If the last source was an audio element, pause it and revoke blob URL if possible
        try {
            const last = lastSourceRef.current;
            if (last && (last as any).type === 'audio') {
                try {
                    const audioEl = (last as { type: 'audio'; audioEl: HTMLAudioElement }).audioEl;
                    // pause playback and clear handlers
                    try { audioEl.pause(); } catch {}
                    try { audioEl.onended = null; } catch {}
                    // revoke blob URL if used
                    try {
                        const src = audioEl.src;
                        if (src && src.startsWith('blob:')) URL.revokeObjectURL(src);
                    } catch {}
                } catch (e) { /* ignore audio cleanup errors */ }
            }
        } catch (e) {}

        try { audioCtxRef.current?.close?.(); } catch {}
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        audioCtxRef.current = null;
        analyserRef.current = null;
        sourceRef.current = null;
        lastSourceRef.current = null;
        setData(null);
    }

    function toggleMute() {
        const next = !muted;
        setMuted(next);
        if (next) {
            // muting: stop audio processing
            stop();
            return;
        }
        // unmuting: restart last source if any
        (async () => {
            try {
                // small delay to ensure previous context closed
                await new Promise(r => setTimeout(r, 50));
                const last = lastSourceRef.current;
                if (!last) {
                    // nothing to restart
                    return;
                }
                if (last.type === 'mic') {
                    await startMic();
                } else if (last.type === 'audio') {
                    // if audio element is available, restart from it
                    try { await startFromAudioElement(last.audioEl); } catch (e) { /* ignore */ }
                }
            } catch (e) {
                // ignore start errors
            }
        })();
    }

    // expose current hook instance to module-level controller so playTTSForText can use it
    useEffect(() => {
        analyzerController = {
            startFromAudioElement: async (el: HTMLAudioElement) => { await startFromAudioElement(el); },
            stop: () => { stop(); },
            startMic: async () => { await startMic(); },
            getLastSourceType: () => lastSourceRef.current?.type ?? null,
            setMuted: (v: boolean) => { setMuted(v); },
            recalibrateNoise: (base?: number) => {
                try {
                    const b = (typeof base === 'number') ? base : noiseEstimateRef.current || 0;
                    noiseEstimateRef.current = b;
                    conversationNoiseRef.current = b;
                    lastNoiseUpdateRef.current = Date.now();
                    noiseHoldUntilRef.current = Date.now() + 500; // short hold after recal
                    try { setNoiseFloor(Math.max(0.0005, b)); } catch {}
                } catch (e) { /* ignore */ }
            }
            ,
            startAmbientCalibration: (durationMs = 2000) => {
                try {
                    calibrationSamplesRef.current = [];
                    calibrationEndRef.current = Date.now() + durationMs;
                    // set a fallback timeout to finalize calibration
                    setTimeout(() => {
                        try { calibrationEndRef.current = 0; } catch {}
                    }, durationMs + 100);
                } catch (e) {}
            }
        };
        return () => { analyzerController = null; };
    }, [startFromAudioElement, stop, startMic]);

    return { data, rms, noiseFloor, ambientNoise, startMic, startFromAudioElement, stop, muted, toggleMute } as const;
}
