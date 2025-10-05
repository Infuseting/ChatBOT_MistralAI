import { useEffect, useRef, useState } from 'react';

export default function useRNNoise() {
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [lastRms, setLastRms] = useState<number | null>(null);

  async function loadWorklet() {
    try {
      setStatus('loading');
      const ctx = ctxRef.current ?? new (window.AudioContext || (window as any).webkitAudioContext)();
      ctxRef.current = ctx;
      // ensure the processor script is available under /audio-worklets/
      try {
        await ctx.audioWorklet.addModule('/audio-worklets/rnnoise-processor.js');
      } catch (e) {
        console.error('Failed to add AudioWorklet module', e);
        setStatus('error');
        return;
      }
      const node = new AudioWorkletNode(ctx, 'rnnoise-processor');
      node.port.onmessage = (ev) => {
        const d = ev.data;
        if (!d) return;
        if (d.type === 'ready') setStatus('ready');
        if (d.type === 'vad' && typeof d.rms === 'number') setLastRms(d.rms);
      };
      nodeRef.current = node;
      setStatus('ready');
    } catch (e) {
      console.error('useRNNoise load failed', e);
      setStatus('error');
    }
  }

  function connectFromStream(stream: MediaStream) {
    try {
      const ctx = ctxRef.current;
      if (!ctx) return;
      const src = ctx.createMediaStreamSource(stream);
      const node = nodeRef.current;
      if (!node) return;
      src.connect(node);
      // do not connect node to destination; it's analysis-only
    } catch (e) {
      console.warn('connectFromStream failed', e);
    }
  }

  function disconnect() {
    try {
      nodeRef.current?.disconnect?.();
      nodeRef.current = null;
    } catch (e) {}
  }

  useEffect(() => {
    return () => {
      try { disconnect(); } catch (e) {}
      try { ctxRef.current?.close?.(); } catch (e) {}
      ctxRef.current = null;
    };
  }, []);

  return { status, lastRms, loadWorklet, connectFromStream, disconnect } as const;
}
