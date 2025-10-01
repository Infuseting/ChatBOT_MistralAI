"use client";
import { useState, useRef, useEffect } from 'react';
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react-dom';
import { useRouter } from 'next/navigation';
import { FaPlus, FaPencilAlt } from "react-icons/fa";
import { TbLayoutSidebarLeftCollapse, TbLayoutSidebarLeftExpand } from "react-icons/tb";
import { FaMagnifyingGlass, FaDoorOpen } from "react-icons/fa6";
import { IoMdSettings, IoMdArrowDropdown } from "react-icons/io";
import UserSettingsModal from "./UserSettingsModal";
import SearchModal from "./SearchModal";
import { setActualThread } from "../utils/Thread";
import { motion } from "motion/react";
import { newThread, getActualThread } from '../utils/Thread';
import { ensureDate } from '../utils/DateUTC';
import ConversationsList from './ThreadsList';

/**
 * Navbar
 *
 * Top-left navigation panel used by the application. It is responsible for:
 * - starting a new thread
 * - toggling the sidebar collapse/expand
 * - opening the search and user settings modals
 * - rendering the ConversationsList (threads)
 *
 * The component performs a lightweight user fetch on mount and keeps some
 * transient UI state locally. It intentionally avoids loading threads itself
 * (that responsibility is delegated to the ConversationsList component).
 */
export default function Navbar() {
    const [menuOpen, setMenuOpen] = useState(false);
    const [navbarOpen, setNavbarOpen] = useState(true);
    const [showCollapsedButton, setShowCollapsedButton] = useState(false);
    const [user, setUser] = useState<{ id: string; name: string; picture?: string } | null | undefined>(undefined);
    const router = useRouter();
    const waitingForOpenRef = useRef(false);
    // Floating UI for user menu
    const { x: userMenuX, y: userMenuY, refs: userMenuRefs, strategy: userMenuStrategy, update: userMenuUpdate } = useFloating({
        placement: 'top-start',
        middleware: [offset(8), flip(), shift()],
        whileElementsMounted: autoUpdate,
    });
    const userMenuTriggerRef = useRef<HTMLElement | null>(null);
    const userMenuElRef = useRef<HTMLElement | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    const navAnimate = navbarOpen ? { x: 0, opacity: 1 } : { x: -280, opacity: 0 };
    // thread loading moved into ConversationsList
    const [refreshToggle, setRefreshToggle] = useState(false);
   
    function handleNewThread() {
        const actual = getActualThread();
        if (actual?.share) {
            window.location.href = `${window.location.origin}/`;
            return;
        }
        const t = newThread();
        setActualThread(t);

    }
    
    function handleThreadClick(t: any) {
        // No-op logging removed; the handler simply opens/activates the selected thread.
        try {
            if (getActualThread()?.share) {
                window.location.href = `${window.location.origin}/${t.id}`;
            } else {
                try {
                    const url = `/${encodeURIComponent(String(t.id ?? ''))}`;
                    if (typeof window !== 'undefined' && window.history && window.history.pushState) {
                        window.history.pushState({}, '', url);
                    } else {
                        router.replace(url);
                    }
                } catch (e) {
                }
                setActualThread(t as any);
            }
        } catch (e) {
        }
    }
    function logout() {
        const preserve = new Set(['mistralApiKey', 'actualModel', 'context', 'fastModelList']);
        try {
            const toRemove: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && !preserve.has(key)) toRemove.push(key);
            }
            toRemove.forEach(k => localStorage.removeItem(k));
        } catch (err) {
            console.error('Failed to clear localStorage', err);
        }
        try {
            fetch('/api/auth/logout', { method: 'POST' }).catch(err => {
                console.error('Logout request failed', err);
            });
        } catch (err) {
            console.error('Logout failed', err);
        }
        router.replace('/login');
    }
    useEffect(() => {
        let cancelled = false;
        async function loadUser() {
            try {
                const res = await fetch('/api/user', { method: 'GET' });
                if (!res.ok) {
                    if (!cancelled) router.replace('/login');
                    return;
                }
                const data = await res.json();
                if (!cancelled) setUser(data ?? null);
            } catch (err) {
                console.error('Failed to load user', err);
                if (!cancelled) router.replace('/login');
            }
        }
        void loadUser();
        return () => { cancelled = true; };
    }, [router]);
    // threads are now loaded by ConversationsList component
    return (
        <>
        <span aria-hidden="true" style={{ display: 'none' }}>{String(refreshToggle)}</span>
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
            {navbarOpen && (
                <div
                    className={`fixed inset-0 z-99 bg-black/40 backdrop-blur-sm lg:hidden `}
                    onClick={() => setNavbarOpen(false)}
                />
            )}

            <motion.nav
                className={`fixed lg:relative left-0 top-0 z-100 w-64 bg-gray-800 text-white p-4 max-h-screen h-screen flex flex-col`}
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
                <motion.div onClick={() => handleNewThread()} className="w-8 h-8 rounded-md hover:bg-gray-600 flex items-center justify-center cursor-pointer" whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                    <FaPlus className="text-2xl text-white" />
                </motion.div>
                <motion.div onClick={() => setNavbarOpen(!navbarOpen)} className="w-8 h-8 rounded-md hover:bg-gray-600 flex items-center justify-center cursor-pointer" whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                    <TbLayoutSidebarLeftCollapse className="text-2xl text-white" />
                </motion.div>

            </div>
            <div className="flex mt-8 flex-col space-y-2">
                <motion.div onClick={() => handleNewThread()} className="flex items-center text-xl p-2 rounded-md space-x-2 hover:bg-gray-600"  whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
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
                    <ConversationsList
                        onThreadClick={(t: any) => handleThreadClick(t)}
                        activeThreadId={getActualThread()?.id ?? null}
                        showDate={false}
                    />
                </div>
            </div>
            <motion.div className="my-6 flex items-center flex-shrink-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
                    <div className="flex-1 h-px bg-gray-700" />
                </motion.div>
            
            <div className="relative">
                <div ref={(node) => { try { userMenuRefs.setReference(node as any); userMenuTriggerRef.current = node as HTMLElement | null; } catch {} }} className="list-none w-full p-2 rounded-md hover:bg-gray-600 flex items-center cursor-pointer" role="button" onClick={() => { setMenuOpen(prev => !prev); setTimeout(() => userMenuUpdate?.(), 0); }}>
                    <img src={user?.picture ?? 'https://placehold.co/32x32'} alt="User Avatar" className="w-6 h-6 rounded-full mr-2" />
                    <span className="text-sm">{user?.name ?? 'Username'}</span>
                    <IoMdArrowDropdown className={`ml-auto text-gray-400 select-none transform transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`} />
                </div>

                {menuOpen && (
                    <div ref={(node) => { try { userMenuRefs.setFloating(node as any); userMenuElRef.current = node as HTMLElement | null; } catch {} }} style={{ position: userMenuStrategy as any, left: userMenuX ?? 0, top: userMenuY ?? 0, zIndex: 9999 }} className="w-56 p-2 bg-gray-800 rounded-md border border-gray-700 shadow-md space-y-1">
                        <motion.button onClick={() => { setMenuOpen(false); setShowSettings(true)}} className="w-full text-left p-2 rounded hover:bg-gray-700 flex items-center space-x-4" type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <IoMdSettings className="text-lg" />
                            <span>Settings</span>
                        </motion.button>
                        <motion.button onClick={() => logout()} className="w-full text-left p-2 rounded hover:bg-gray-700 text-red-400 flex items-center space-x-4" type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                            <FaDoorOpen className="text-lg" />
                            <span>Log Out</span>
                        </motion.button>
                    </div>
                )}
            </div>
            {showSettings && <UserSettingsModal onClose={() => setShowSettings(false)} />}
            {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}
            

            </motion.nav>
        </>
    );
}