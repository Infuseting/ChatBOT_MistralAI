"use client";

import { motion } from "motion/react";
import { FaTimes } from 'react-icons/fa';
import { useState, useEffect } from 'react';
import { getActualThread, getThreads, selectThreadById, setActualThread } from "../utils/Thread";
import { ensureDate } from '../utils/DateUTC';
import ConversationsList from './ThreadsList';
const MotionFaTimes = motion(FaTimes);

export default function SearchModal({ onClose }: { onClose: () => void }) {
    const [query, setQuery] = useState('');
    // ConversationsList will load threads internally; just pass the query

    function handleThreadClick(t: any) {
            try {
                const actual = getActualThread();
                const msg = `click thread actual=${actual?.id ?? 'null'} thread=${t?.id ?? 'unknown'}`;
                try { console.log(msg, actual, t); } catch {}
        
            } catch (e) {
            }
            try {
                if (getActualThread()?.share) {
                    window.location.href = `${window.location.origin}/${t.id}`;
                } else {
                    try {
                        const url = `/${encodeURIComponent(String(t.id ?? ''))}`;
                        if (typeof window !== 'undefined' && window.history && window.history.pushState) {
                            window.history.pushState({}, '', url);
                        }
                    } catch (e) {
                    }
                    setActualThread(t as any);
                }
            } catch (e) {
            }
        }
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
                    <ConversationsList
                        query={query}
                        onThreadClick={(t: any) => { handleThreadClick(t); onClose(); }}
                        activeThreadId={getActualThread()?.id ?? null}
                        showDate={true}
                    />
                </div>
            </div>
        </div>
    );
}