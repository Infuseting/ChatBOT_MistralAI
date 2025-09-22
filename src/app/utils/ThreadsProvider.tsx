"use client";
import React, { createContext, useContext, useMemo } from "react";

type Thread = { id: number; name: string, date?: Date };

type ThreadsContextValue = {
  threads: Thread[];
};

const ThreadsContext = createContext<ThreadsContextValue | undefined>(undefined);

function generateThreads(): Thread[] {
  const MAX_THREADS = 200;
  const count = Math.floor(Math.random() * MAX_THREADS) + 1;

  const lorem = [
    "lorem","ipsum","dolor","sit","amet","consectetur","adipiscing","elit",
    "sed","do","eiusmod","tempor","incididunt","ut","labore","et","dolore",
    "magna","aliqua","enim","minim","veniam","quis","nostrud","exercitation"
  ];

  const rand = (n: number) => Math.floor(Math.random() * n);

  const makeName = () => {
    const words = Math.floor(Math.random() * 10) + 1; // 1-10 words
    const parts: string[] = [];
    for (let i = 0; i < words; i++) {
      const w = lorem[rand(lorem.length)];
      parts.push(i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w);
    }
    return parts.join(" ");
  };

  // Compute time range: from now back to 5 years ago
  const now = Date.now();
  const fiveYearsMs = 5 * 365 * 24 * 60 * 60 * 1000; // approx 5 years in ms
  const start = now - fiveYearsMs;

  const randomDate = () => new Date(start + Math.floor(Math.random() * (now - start + 1)));

  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: makeName(),
    date: randomDate()
  }));
}

export function ThreadsProvider({ children }: { children: React.ReactNode }) {
  const threads = useMemo(() => generateThreads(), []);

  const value = useMemo(() => ({ threads }), [threads]);

  return <ThreadsContext.Provider value={value}>{children}</ThreadsContext.Provider>;
}

export function useThreads() {
  const ctx = useContext(ThreadsContext);
  if (!ctx) throw new Error("useThreads must be used within ThreadsProvider");
  return ctx;
}

export type { Thread };
