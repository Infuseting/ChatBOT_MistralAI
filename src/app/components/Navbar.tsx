"use client";
import { useState, useRef } from 'react';
import { FaPlus, FaPencilAlt } from "react-icons/fa";
import { TbLayoutSidebarLeftCollapse, TbLayoutSidebarLeftExpand } from "react-icons/tb";
import { FaMagnifyingGlass, FaDoorOpen } from "react-icons/fa6";
import { IoMdSettings, IoMdArrowDropdown } from "react-icons/io";
import UserSettingsModal from "./UserSettingsModal";
import SearchModal from "./SearchModal";
import { setActualThread } from "../utils/Thread";
import { motion } from "motion/react";
import { getThreads, newThread } from '../utils/Thread';
import { getActualThread } from '../utils/Thread';
export default function Navbar() {
    const [menuOpen, setMenuOpen] = useState(false);
    const [navbarOpen, setNavbarOpen] = useState(true);
    const [showCollapsedButton, setShowCollapsedButton] = useState(false);
    const waitingForOpenRef = useRef(false);
    const detailsRef = useRef<HTMLDetailsElement | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    const navAnimate = navbarOpen ? { x: 0, opacity: 1 } : { x: -280, opacity: 0 };

    return (
        <>
            <div className="fixed top-4 left-4 z-100"> 
                <motion.button
                    onClick={() => {
                        setShowCollapsedButton(false);
                        waitingForOpenRef.current = true;
                    }}
                    initial={false}
                    animate={showCollapsedButton ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.15 }}
                    className={`w-10 h-10 rounded-md bg-gray-800 text-white flex items-center justify-center shadow-md ${navbarOpen ? 'hidden' : 'block'}`}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onAnimationComplete={() => {
                        if (!showCollapsedButton && waitingForOpenRef.current) {
                            waitingForOpenRef.current = false;
                            setNavbarOpen(true);
                        }
                    }}
                >
                    <TbLayoutSidebarLeftExpand className="text-2xl" />
                </motion.button>
            </div>

            {/* small-screen backdrop: visible only on screens smaller than `sm` */}
            {navbarOpen && (
                <div
                    className={`fixed inset-0 z-30 bg-black/40 backdrop-blur-lg sm:hidden `}
                    onClick={() => setNavbarOpen(false)}
                />
            )}

            <motion.nav
                className={`fixed sm:relative left-0 top-0 z-40 w-64 bg-gray-800 text-white p-4 max-h-screen h-screen flex flex-col`}
                initial={false}
                animate={navAnimate}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                style={{ pointerEvents: navbarOpen ? 'auto' : 'none', width: navbarOpen ? undefined : 0, padding: navbarOpen ? undefined : 0 }}
                aria-hidden={!navbarOpen}
                onAnimationComplete={() => {
                    if (!navbarOpen) {
                        setShowCollapsedButton(true);
                    } else {
                        setShowCollapsedButton(false);
                    }
                }}
            >
            
            <div className="flex justify-between items-center">
                <motion.div onClick={() => newThread()} className="w-8 h-8 rounded-md hover:bg-gray-600 flex items-center justify-center cursor-pointer" whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                    <FaPlus className="text-2xl text-white" />
                </motion.div>
                <motion.div onClick={() => setNavbarOpen(!navbarOpen)} className="w-8 h-8 rounded-md hover:bg-gray-600 flex items-center justify-center cursor-pointer" whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                    <TbLayoutSidebarLeftCollapse className="text-2xl text-white" />
                </motion.div>

            </div>
            <div className="flex mt-8 flex-col space-y-2">
                <motion.div onClick={() => newThread()} className="flex items-center text-xl p-2 rounded-md space-x-2 hover:bg-gray-600"  whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <FaPencilAlt className=" text-white" />
                    <span className="">New Chat</span>
                </motion.div>
                <motion.div onClick={() => setShowSearch(true)} className="flex items-center text-xl p-2 rounded-md space-x-2 hover:bg-gray-600"  whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <FaMagnifyingGlass className=" text-white" />
                    <span className="">Search Chat</span>
                </motion.div>
            </div>
            <div className="flex-1 min-h-0 flex flex-col"> 
                <motion.div className="my-6 flex items-center flex-shrink-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
                    <div className="flex-1 h-px bg-gray-700" />
                    <span className="px-3 text-xs text-gray-400 uppercase tracking-wider">Conversations</span>
                    <div className="flex-1 h-px bg-gray-700" />
                </motion.div>
                <div className="flex-1 min-h-0 overflow-y-auto conversations-scroll" aria-label="Conversations list">
                    {(() => {
                        const threads = getThreads();
                        
                        const sortedThreads = [...threads].sort(
                            (a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0)
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
                            return t.date instanceof Date ? t.date : new Date(t.date as any);
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
                                            onClick={() => setActualThread(t as any)}
                                        >
                                            <div className="text-sm truncate">{t.name}</div>
                                            
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
                                                className={`w-full p-2 rounded-md hover:bg-gray-700 cursor-pointer ${getActualThread()?.id === t.id ? 'bg-gray-700' : ''}`}
                                                whileHover={{ scale: 1.02 }}
                                                whileTap={{ scale: 0.98 }}
                                                onClick={() => { setActualThread(t as any); }}
                                            >
                                                <div className="text-sm truncate">{t.name}</div>
                                            </motion.div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        );
                    })()}
                
                </div>
            </div>
            <motion.div className="my-6 flex items-center flex-shrink-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
                    <div className="flex-1 h-px bg-gray-700" />
                </motion.div>
            
            <div className="relative"> 
                <details
                    ref={detailsRef}
                    onToggle={(e) => setMenuOpen((e.target as HTMLDetailsElement).open)}
                    className="mt-auto w-full relative"
                    aria-label="User menu"
                >
                    <summary className="list-none w-full p-2 rounded-md hover:bg-gray-600 flex items-center cursor-pointer" role="button">
                        <img src="https://placehold.co/32x32" alt="User Avatar" className="w-6 h-6 rounded-full mr-2" />
                        <span className="text-sm">Username</span>
                        <IoMdArrowDropdown className={`ml-auto text-gray-400 select-none transform transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`} />
                    </summary>

                    <div className="absolute left-0 bottom-full mb-2 w-56 p-2 bg-gray-800 rounded-md border border-gray-700 shadow-md space-y-1 z-50">
                        <motion.button onClick={() => setShowSettings(true)} className="w-full text-left p-2 rounded hover:bg-gray-700 flex items-center space-x-4" type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <IoMdSettings className="text-lg" />
                            <span>Settings</span>
                        </motion.button>
                        <motion.button className="w-full text-left p-2 rounded hover:bg-gray-700 text-red-400 flex items-center space-x-4" type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <FaDoorOpen className="text-lg" />
                            <span>Log Out</span>
                        </motion.button>
                    </div>
                </details>
            </div>
            {showSettings && <UserSettingsModal onClose={() => setShowSettings(false)} />}
            {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}
            
            </motion.nav>
        </>
    );
}