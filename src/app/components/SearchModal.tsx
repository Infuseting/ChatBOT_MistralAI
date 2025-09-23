"use client";

import { motion } from "motion/react";
import { FaTimes } from 'react-icons/fa';
import { useState, useEffect } from 'react';
import { getThreads, selectThreadById } from "../utils/Thread";
import { ensureDate } from '../utils/DateUTC';
const MotionFaTimes = motion(FaTimes);

export default function SearchModal({ onClose }: { onClose: () => void }) {
    const [query, setQuery] = useState('');
    const [threads, setThreads] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // fetch threads once on mount (and when modal opens)
    useEffect(() => {
        let mounted = true;
        setLoading(true);
        (async () => {
            try {
                const rows = await getThreads();
                if (!mounted) return;
                setThreads(rows || []);
            } catch (e) {
                console.error('Failed to load threads in SearchModal', e);
                if (mounted) setThreads([]);
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false; };
    }, []);

    const filtered = query.trim()
        ? threads.filter((t: { name: string }) => (t.name ?? '').toLowerCase().includes(query.toLowerCase()))
        : threads;

    const sortedThreads = [...filtered].sort(
        (a, b) => (b.date?.getTime?.() ?? 0) - (a.date?.getTime?.() ?? 0)
    );

    const now = Date.now();
    const msDay = 24 * 60 * 60 * 1000;
    const msWeek = 7 * msDay;
    const msMonth = 30 * msDay;

    const lastDay: typeof sortedThreads = [];
    const lastWeek: typeof sortedThreads = [];
    const lastMonth: typeof sortedThreads = [];
    const older = new Map<string, typeof sortedThreads[number][]>();

    const getSafeDate = (t: typeof sortedThreads[number]) => {
        if (!t.date) return new Date(0);
        const d = t.date instanceof Date ? t.date : ensureDate(t.date as any);
        return d ?? new Date(0);
    };

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

    const renderSection = (title: string, items: typeof sortedThreads) => {
        if (!items || items.length === 0) return null;
        return (
            <div key={title} className="space-y-1 p-1">
                <div className="text-xs uppercase text-gray-400 px-2 py-1">{title}</div>
                {items.map((t) => (
                    <motion.div
                        key={t.id}
                        className="w-full p-2 rounded-md hover:bg-gray-700 cursor-pointer"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => { selectThreadById(t.id); onClose(); }}
                    >
                        <div className="text-sm truncate">{t.name}</div>
                        <div className="text-xs text-gray-400">{getSafeDate(t).toLocaleString()}</div>
                    </motion.div>
                ))}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative flex flex-col bg-gray-800 text-white rounded-lg xl:w-[40%] lg:w-[50%] md:w-[70%] sm:w-[80%] w-[90%] max-h-[80%] min-h-[40%] shadow-lg">
                <nav className="flex flex-row w-full h-12 rounded-t-lg p-4 mb-4">
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="w-full p-4 rounded-md text-white bg-transparent outline-none focus:outline-none focus:ring-0"
                        placeholder="Search..."
                        aria-label="Search threads"
                    />
                    <MotionFaTimes whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} className='w-8 h-8 p-2 rounded-md hover:bg-gray-700' onClick={onClose} />
                </nav>
                <div className="h-px bg-gray-700 w-full"></div>
                <div className="flex-1 p-4 overflow-auto conversations-scroll">
                    {loading ? (
                        <div className="text-sm text-gray-400">Loading...</div>
                    ) : (
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
                                            className="w-full p-2 rounded-md hover:bg-gray-700 cursor-pointer"
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.98 }}
                                            onClick={() => { selectThreadById(t.id); onClose(); }}
                                        >
                                            <div className="text-sm truncate">{t.name}</div>
                                            <div className="text-xs text-gray-400">{getSafeDate(t).toLocaleString()}</div>
                                        </motion.div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}