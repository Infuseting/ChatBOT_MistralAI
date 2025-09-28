"use client";
import { motion } from "motion/react";
import { ensureDate } from '../utils/DateUTC';
import React from 'react';

import { useEffect, useState } from 'react';
import { getThreads, reloadThread, setActualThread, getActualThread } from '../utils/Thread';

/**
 * ThreadsList
 *
 * Renders a list of conversation threads grouped by recency (last day, week, month, older).
 * The component listens for global events that notify when the active thread or the
 * thread list is updated and reloads the list accordingly.
 *
 * Props:
 * - threads?: optional array of thread objects to display (if omitted the component will load threads itself)
 * - onThreadClick?: optional click handler when a thread is selected
 * - activeThreadId?: optional currently active thread id (overrides internal tracking)
 * - showDate?: whether to show the thread date under the name
 * - query?: optional search query to filter thread names (case-insensitive)
 *
 * Each thread object is expected to include at least: { id: string, name?: string, date?: string | Date }
 */

export default function ThreadsList({
    threads,
    onThreadClick,
    activeThreadId,
    showDate,
    query,
}: {
    threads?: any[] | undefined;
    onThreadClick?: (t: any) => void;
    activeThreadId?: string | null;
    showDate?: boolean;
    query?: string;
}) {
    const [internalThreads, setInternalThreads] = useState<any[] | null>(null);
    const list = Array.isArray(threads) ? threads : (internalThreads ?? []);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            try {
                // prefer fresh reload when possible
                const reloaded = await reloadThread();
                if (!cancelled && Array.isArray(reloaded) && reloaded.length > 0) {
                    setInternalThreads([...reloaded]);
                    return;
                }
                const t = await getThreads();
                console.log(t);
                if (!cancelled) setInternalThreads(Array.isArray(t) ? [...t] : []);
            } catch (e) {
                console.error('ConversationsList: failed to load threads', e);
                if (!cancelled) setInternalThreads([]);
            }
        }

        void load();

        async function onUpdate() {
            if (cancelled) return;
            try {
                const re = await reloadThread();
                if (!cancelled && Array.isArray(re) && re.length > 0) setInternalThreads([...re]);
                else {
                    const t = await getThreads();
                    if (!cancelled) setInternalThreads(Array.isArray(t) ? [...t] : []);
                }
            } catch (e) {
                console.error('ConversationsList: failed to refresh threads', e);
            }
        }

        window.addEventListener('actualThreadUpdated', onUpdate as EventListener);
        window.addEventListener('updateThreadList', onUpdate as EventListener);
        window.addEventListener('updateActualThread', onUpdate as EventListener);

        return () => {
            cancelled = true;
            window.removeEventListener('actualThreadUpdated', onUpdate as EventListener);
            window.removeEventListener('updateThreadList', onUpdate as EventListener);
            window.removeEventListener('updateActualThread', onUpdate as EventListener);
        };
    }, []);



    const getTime = (t: any) => {
        try {
            if (!t) return 0;
            const d = t.date instanceof Date ? t.date : ensureDate(t.date as any) ?? new Date(String(t.date ?? 0));
            const ms = d instanceof Date ? d.getTime() : Number(d) || 0;
            return isNaN(ms) ? 0 : ms;
        } catch {
            return 0;
        }
    };

    const filteredList = typeof query === 'string' && query.trim() ? list.filter((t: any) => (t.name ?? '').toLowerCase().includes(query.toLowerCase())) : list;

    const sortedThreads = [...filteredList].sort((a, b) => getTime(b) - getTime(a));

    const now = Date.now();
    const msDay = 24 * 60 * 60 * 1000;
    const msWeek = 7 * msDay;
    const msMonth = 30 * msDay;

    const lastDay: any[] = [];
    const lastWeek: any[] = [];
    const lastMonth: any[] = [];
    const older = new Map<string, any[]>();

    const getSafeDate = (t: any) => {
        if (!t) return new Date(0);
        const d = t.date instanceof Date ? t.date : ensureDate(t.date as any);
        return d ?? new Date(0);
    };

    const defaultOnClick = (t: any) => {
        try {
            if (getActualThread()?.share) {
                window.location.href = `${window.location.origin}/${t.id}`;
            } else {
                try {
                    const url = `/${encodeURIComponent(String(t.id ?? ''))}`;
                    if (typeof window !== 'undefined' && window.history && window.history.pushState) {
                        window.history.pushState({}, '', url);
                    }
                } catch (e) {}
                setActualThread(t as any);
            }
        } catch (e) {}
    };

    // track actual thread id so the list highlights updates even when parent
    // passed no activeThreadId prop (or passed a stale value)
    const [actualThreadId, setActualThreadId] = useState<string | null>(getActualThread()?.id ?? null);
    useEffect(() => {
        let cancelled = false;
        const handler = () => {
            if (cancelled) return;
            try {
                setActualThreadId(getActualThread()?.id ?? null);
            } catch (e) {}
        };
        window.addEventListener('actualThreadUpdated', handler as EventListener);
        window.addEventListener('updateActualThread', handler as EventListener);
        window.addEventListener('updateThreadList', handler as EventListener);
        return () => {
            cancelled = true;
            window.removeEventListener('actualThreadUpdated', handler as EventListener);
            window.removeEventListener('updateActualThread', handler as EventListener);
            window.removeEventListener('updateThreadList', handler as EventListener);
        };
    }, []);

    for (const t of sortedThreads) {
        const d = getSafeDate(t);
        const diff = now - d.getTime();

        if (diff <= msDay) {
            lastDay.push(t);
        } else if (diff <= msWeek) {
            lastWeek.push(t);
        } else if (diff <= msMonth) {
            lastMonth.push(t);
        } else {
            const label = d.toLocaleString(undefined, { month: "long", year: "numeric" });
            const arr = older.get(label) ?? [];
            arr.push(t);
            older.set(label, arr);
        }
    }

    const effectiveActiveId = activeThreadId ?? actualThreadId;

    const renderSection = (title: string, items: any[]) => {
        if (!items || items.length === 0) return null;
        return (
            <div key={title} className="space-y-1 p-1">
                <div className="text-xs uppercase text-gray-400 px-2 py-1">{title}</div>
                {items.map((t) => (
                    <motion.div
                        key={t.id}
                        className={`w-full p-2 rounded-md hover:bg-gray-700 cursor-pointer ${effectiveActiveId === t.id ? 'bg-gray-700' : ''}`}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => (onThreadClick ?? defaultOnClick)(t)}
                    >
                        <div className="text-sm truncate">{t.name}</div>
                        {showDate && <div className="text-xs text-gray-400">{getSafeDate(t).toLocaleString()}</div>}
                    </motion.div>
                ))}
            </div>
        );
    };

    return (
        <div className="space-y-2 p-1">
            {renderSection("Last day", lastDay)}
            {renderSection("Last week", lastWeek)}
            {renderSection("Last month", lastMonth)}
            {[...older.entries()].map(([label, items]) => (
                <div key={label} className="space-y-1 p-1">
                    <div className="text-xs uppercase text-gray-400 px-2 py-1">{label}</div>
                            {items.map((t) => (
                                <motion.div
                                    key={t.id}
                                    className={`w-full p-2 rounded-md hover:bg-gray-700 cursor-pointer ${effectiveActiveId === t.id ? 'bg-gray-700' : ''}`}
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={() => (onThreadClick ?? defaultOnClick)(t)}
                                >
                                    <div className="text-sm truncate">{t.name}</div>
                                    {showDate && <div className="text-xs text-gray-400">{getSafeDate(t).toLocaleString()}</div>}
                                </motion.div>
                            ))}
                </div>
            ))}
        </div>
    );
}
