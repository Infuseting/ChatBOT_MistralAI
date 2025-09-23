"use client";
import React, { createContext, useContext, useEffect, useState } from "react";
import { Thread } from "./Thread";

type ThreadsContextValue = {
  threads: Thread[];
  setThreads: (t: Thread[]) => void;
};

const ThreadsContext = createContext<ThreadsContextValue | undefined>(undefined);

function makeQuickSample(): Thread[] {
  // small, fast sample to avoid blocking initial render
  return [
    { id: '0', name: 'Welcome', date: new Date(), messages: [], status: 'local', context: '', model: null as any, share: false },
  ];
}

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
    return makeQuickSample();
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
            generated.push({ id: `${i}`, name: `Thread ${i}`, date: new Date(), messages: [], status: 'local', context: '', model: null as any, share: false });
          }
          setThreads(generated);
          window.localStorage.setItem('threads', JSON.stringify(generated));
        } catch (e) {}
      }, 50);
      return () => clearTimeout(id);
    } catch (e) {}
  }, []);

  const value = { threads, setThreads };

  return <ThreadsContext.Provider value={value}>{children}</ThreadsContext.Provider>;
}

export function useThreads() {
  const ctx = useContext(ThreadsContext);
  if (!ctx) throw new Error("useThreads must be used within ThreadsProvider");
  return ctx;
}