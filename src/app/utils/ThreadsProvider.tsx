"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import { Thread, getThreads } from "./Thread";
import { utcNow } from './DateUTC';

type ThreadsContextValue = {
  threads: Thread[];
  setThreads: (t: Thread[]) => void;
  reloadThreads: () => Promise<void>;
  loading: boolean;
};

const ThreadsContext = createContext<ThreadsContextValue | undefined>(undefined);


export function ThreadsProvider({ children }: { children: React.ReactNode }) {
  const [threads, setThreads] = useState<Thread[]>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem('threads');
        if (raw) {
          return JSON.parse(raw) as Thread[];
        }
      }
    } catch (e) {
      // ignore parsing errors
    }
    return [];
  });

  useEffect(() => {
    // persist threads to localStorage whenever they change
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('threads', JSON.stringify(threads));
        try {
          const ids = threads.map(t => t.id).join(',');
          window.localStorage.setItem('threadIds', ids);
        } catch (e) {}
      }
    } catch (e) {}
  }, [threads]);

  // Asynchronously generate a larger sample if no threads existed previously
  useEffect(() => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const raw = window.localStorage.getItem('threads');
      if (raw) return; // already persisted

      // schedule a background generation to avoid blocking initial paint
      const id = setTimeout(() => {
        try {
          // lightweight generation: only a few threads/messages to keep app responsive
          const generated: Thread[] = [];
          for (let i = 0; i < 10; i++) {
            generated.push({ id: `${i}`, name: `Thread ${i}`, date: utcNow(), messages: [], status: 'local', context: '', model: null as any, share: false });
          }
          setThreads(generated);
          window.localStorage.setItem('threads', JSON.stringify(generated));
        } catch (e) {}
      }, 50);
      return () => clearTimeout(id);
    } catch (e) {}
  }, []);

  const [loading, setLoading] = useState(false);

  async function reloadThreads() {
    try {
      setLoading(true);
      const rows = await getThreads();
      if (Array.isArray(rows)) setThreads(rows as Thread[]);
    } catch (e) {
      console.error('reloadThreads error', e);
    } finally {
      setLoading(false);
    }
  }

  // load from API once on mount if no threads in localStorage
  useEffect(() => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const raw = window.localStorage.getItem('threads');
      if (raw) return; // keep persisted
      // otherwise fetch fresh threads
      reloadThreads();
    } catch (e) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = { threads, setThreads, reloadThreads, loading };

  return <ThreadsContext.Provider value={value}>{children}</ThreadsContext.Provider>;
}

export function useThreads() {
  const ctx = useContext(ThreadsContext);
  if (!ctx) throw new Error("useThreads must be used within ThreadsProvider");
  return ctx;
}