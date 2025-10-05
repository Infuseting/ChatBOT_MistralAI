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
} | null = null;

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
    const rafRef = useRef<number | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
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
        try {
            // Some mobile browsers create the AudioContext in 'suspended' state
            // until a user gesture resumes it. Try to resume so analyzers/startMic
            // work on phones after a user interaction.
            if (ctx.state === 'suspended') {
                await ctx.resume();
                // small debug: optional console message
                // console.debug('useAudioAnalyzer: audio context resumed');
            }
        } catch (e) {
            // ignore resume errors
        }
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
        src.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        function loop() {
            analyser.getByteFrequencyData(dataArray);
            setData(new Uint8Array(dataArray));
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
        const dataArray = new Uint8Array(bufferLength);
        function loop() {
            analyser.getByteFrequencyData(dataArray);
            setData(new Uint8Array(dataArray));
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
        };
        return () => { analyzerController = null; };
    }, [startFromAudioElement, stop, startMic]);

    return { data, startMic, startFromAudioElement, stop, muted, toggleMute } as const;
}
