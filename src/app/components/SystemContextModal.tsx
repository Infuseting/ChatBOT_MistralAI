"use client";

import { getActualThread, updateServerThread } from "../utils/Thread";
import { FaTimes } from "react-icons/fa";
import { motion } from "motion/react";
import { useEffect, useState } from 'react';
const MotionFaTimes = motion(FaTimes);


export default function SystemContextModal({ onClose }: { onClose: () => void }) {
    const [text, setText] = useState<string>('');

    useEffect(() => {
        const thread = getActualThread();
        setText(thread?.context ?? '');
    }, []);

    function saveAndClose() {
        const thread = getActualThread();
        if (thread) thread.context = text;
        try { updateServerThread(thread as any); } catch (e) {}
        onClose();
    }

    return (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/50" onClick={saveAndClose} />
                    <div className="relative flex flex-col bg-gray-800 text-white rounded-lg xl:w-[40%] lg:w-[50%] md:w-[70%] sm:w-[80%] w-[90%] max-h-[80vh] min-h-[40vh] shadow-lg">
                        <nav className="flex flex-row justify-between items-center w-full px-6 py-3">
                            <h2 className="text-lg font-medium">Define context for the IA</h2>
                            <MotionFaTimes whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} className='w-8 h-8 p-2 rounded-md hover:bg-gray-700' onClick={saveAndClose} />
                        </nav>
                        <div className="h-px bg-gray-700 w-full"></div>
                        <div className="flex-1 p-4 w-full min-h-0 flex flex-col">
                            <textarea
                                onChange={(e) => setText(e.target.value)}
                                value={text}
                                placeholder="Provide context to the IA to help it answer better. For example, you can provide information about your company, products, or specific instructions on how you want the IA to respond."
                                className="flex-1 w-full min-h-0 p-2 bg-gray-900 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-auto box-border"
                            />
                        </div>
                    </div>
                </div>
    );
}