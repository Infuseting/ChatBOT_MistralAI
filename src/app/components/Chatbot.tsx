"use client"
import { IoMdSettings, IoMdShareAlt } from "react-icons/io";
import { motion } from "motion/react";
import { getActualThread, getShareLink, handleMessageSend, Thread, updateServerThread } from "../utils/Thread";
import { Message } from "../utils/Message";
import { toast, Bounce } from "react-toastify";
import { useState, useRef, useEffect } from "react";
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react-dom';
import { FaPlus, FaMicrophone, FaPaperPlane } from "react-icons/fa";
import SystemContextModal from "./SystemContextModal";
import { getActualModel, getAvailableModelList, getFastModelList, setActualModel } from '../utils/Models';
import ChatMessages from "./ChatMessages";
import ChatInput from './ChatInput';


export default function Chatbot() {
    const [dropdownMenuOpen, setDropdownMenuOpen] = useState(false);
    const [modelPanelOpen, setModelPanelOpen] = useState(false);
    const [contextModalOpen, setContextModalOpen] = useState(false);
    // toggle to force an invisible re-render when needed
    const [refreshToggle, setRefreshToggle] = useState(false);
    const [actualModel, setActualModelState] = useState<string | null>(null);
    const [models, setModels] = useState<string[]>([]);
    const [actualThread, setActualThread] = useState<Thread | null>(getActualThread());
    const [isNewestBranch, setisNewestBranch] = useState<boolean>(true);
    const [isShareThread, setIsShareThread] = useState<boolean>(actualThread?.share ?? false);
    
    
    const menuRef = useRef<HTMLDivElement | null>(null);
    const firstItemRef = useRef<HTMLButtonElement | null>(null);
    // Floating UI for dropdown
    const { x: dropdownX, y: dropdownY, refs: dropdownRefs, strategy: dropdownStrategy, update: dropdownUpdate } = useFloating({
        placement: 'bottom-end',
        middleware: [offset(8), flip(), shift()],
        whileElementsMounted: autoUpdate,
    });
    const dropdownTriggerRef = useRef<HTMLElement | null>(null);
    const dropdownElRef = useRef<HTMLElement | null>(null);
    const messagesWrapperRef = useRef<HTMLDivElement | null>(null);
    const inputBarRef = useRef<HTMLDivElement | null>(null);
    async function handleShare() {
    if (isShareThread) {
        toast.error('You cannot share a shared thread.', {
            position: "bottom-right",
            autoClose: 5000,
            hideProgressBar: false,
            closeOnClick: false,
            pauseOnHover: true,
            draggable: true,
            progress: undefined,
            theme: "dark",
            transition: Bounce,
        });
        return;
    }
    try {
        console.log(actualThread);
        if (actualThread?.status === 'remote') {
            const shareLink : string | void | null = await getShareLink(actualThread as Thread);
            if (shareLink === null || shareLink === undefined || shareLink.length === 0 || typeof shareLink !== 'string') {
                toast.error('Failed to generate share link', {
                    position: "bottom-right",
                    autoClose: 5000,
                    hideProgressBar: false,
                    closeOnClick: false,
                    pauseOnHover: true,
                    draggable: true,
                    progress: undefined,
                    theme: "dark",
                    transition: Bounce,
                });
                return;
            }
            await navigator.clipboard.writeText(shareLink ?? '');
            toast.success('Share link copied to clipboard!', {
                position: "bottom-right",
                autoClose: 5000,
                hideProgressBar: false,
                closeOnClick: false,
                pauseOnHover: true,
                draggable: true,
                progress: undefined,
                theme: "dark",
                transition: Bounce,
            });
        } else {
            toast.error('You can only share threads that are saved remotely.', {
                position: "bottom-right",
                autoClose: 5000,
                hideProgressBar: false,
                closeOnClick: false,
                pauseOnHover: true,
                draggable: true,
                progress: undefined,
                theme: "dark",
                transition: Bounce,
            });
        }
    } catch (err) {
        if (getActualThread() === null) {
            toast.error('Aucun thread ouvert', {
                position: "bottom-right",
                autoClose: 5000,
                hideProgressBar: false,
                closeOnClick: false,
                pauseOnHover: true,
                draggable: true,
                progress: undefined,
                theme: "dark",
                transition: Bounce,
            });
            return;
        }
        console.error('Failed to copy link', err);
        toast.error('Failed to copy link', {
            position: "bottom-right",
            autoClose: 5000,
            hideProgressBar: false,
            closeOnClick: false,
            pauseOnHover: true,
            draggable: true,
            progress: undefined,
            theme: "dark",
            transition: Bounce,
        });
    }
}
    function handleDropdown(thread : Thread | null) {
            // Toggle an invisible state to force a re-render when needed.
            // This state does not affect visible UI directly.
            if (!thread) {
                toast.error('Aucun thread ouvert', {
                    position: "bottom-right",
                    autoClose: 5000,
                    hideProgressBar: false,
                    closeOnClick: false,
                    pauseOnHover: true,
                    draggable: true,
                    progress: undefined,
                    theme: "dark",
                    transition: Bounce,
                });
                return;
            }
            setDropdownMenuOpen(prev => !prev);
            setRefreshToggle(prev => !prev);
        }
    
    useEffect(() => {
        try {
            setActualModelState(getActualModel());
            setModels(getFastModelList());
        } catch (e) {
        }
        function onFastModelListUpdated(e: Event) {
            try {
                
                setModels(getFastModelList());
                setActualModelState(getActualModel());
            } catch (err) {
                
            }
        }
        function onActualThreadUpdated(e: Event) {
            try {
                const t = (e as CustomEvent).detail as Thread | null;

                // 🔹 On clone le thread pour forcer React à voir un changement
                setActualThread(t ? { ...t, messages: [...(t.messages ?? [])] } : null);

                setIsShareThread(t?.share ?? false);
            } catch (err) {
                const current = getActualThread();
                setActualThread(current ? { ...current, messages: [...(current.messages ?? [])] } : null);
                setIsShareThread(actualThread?.share ?? false);
            }

        }

    

        window.addEventListener('fastModelListUpdated', onFastModelListUpdated);
        window.addEventListener('actualThreadUpdated', onActualThreadUpdated as EventListener);
    

        return () => {
            window.removeEventListener('fastModelListUpdated', onFastModelListUpdated);
            window.removeEventListener('actualThreadUpdated', onActualThreadUpdated as EventListener);
        
        };
    }, []);
    

    function handleSelectModel(model: string) {
        
         toast.success(`Model "${model}" selected`, {
            position: "bottom-right",
            autoClose: 5000,
            hideProgressBar: false,
            closeOnClick: false,
            pauseOnHover: true,
            draggable: true,
            progress: undefined,
            theme: "dark",
            transition: Bounce,
        });
        setModelPanelOpen(false);
        const thread = actualThread;
        if (thread) {
            thread.model = model;
            setActualModelState(model);
            try { updateServerThread(thread).catch(() => {}); } catch (e) {}
        } else {
            setActualModel(model);
            setActualModelState(model);
        }
        setDropdownMenuOpen(false);
    }

    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            try {
                const target = e.target as Node | null;
                if (!target) return;
                const inside = (dropdownTriggerRef.current && dropdownTriggerRef.current.contains(target)) || (dropdownElRef.current && dropdownElRef.current.contains(target)) || (menuRef.current && menuRef.current.contains(target));
                if (!inside) setDropdownMenuOpen(false);
            } catch (err) {
                if (!menuRef.current) return;
                if (e.target instanceof Node && !menuRef.current.contains(e.target)) {
                    setDropdownMenuOpen(false);
                }
            }
        }
        function onEsc(e: KeyboardEvent) {
            if (e.key === 'Escape') setDropdownMenuOpen(false);
        }
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onEsc);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onEsc);
        };
    }, []);

    useEffect(() => {
        if (dropdownMenuOpen && getActualThread()?.share) {
            toast.error('You cannot modify parameter of shared thread.', {
                position: "bottom-right",
                autoClose: 5000,
                hideProgressBar: false,
                closeOnClick: false,
                pauseOnHover: true,
                draggable: true,
                progress: undefined,
                theme: "dark",
                transition: Bounce,
            })
            setDropdownMenuOpen(false);
        }
        if (dropdownMenuOpen) {
            firstItemRef.current?.focus();
        }
    }, [dropdownMenuOpen]);

    useEffect(() => {
        function updatePosition() {
            const parent = messagesWrapperRef.current;
            const bar = inputBarRef.current;
            if (!parent || !bar) return;
            const rect = parent.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            bar.style.left = `${Math.round(centerX)}px`;
        }

        let raf = 0;
        function onScrollOrResize() {
            if (raf) cancelAnimationFrame(raf);
            raf = requestAnimationFrame(updatePosition);
        }

        // Initial position
        updatePosition();

        window.addEventListener('resize', onScrollOrResize);
        window.addEventListener('scroll', onScrollOrResize, true);
        const parentEl = messagesWrapperRef.current;
        parentEl?.addEventListener('scroll', onScrollOrResize);

        

        const mo = new MutationObserver(onScrollOrResize);
        mo.observe(document.body, { attributes: true, childList: true, subtree: true });

        return () => {
            window.removeEventListener('resize', onScrollOrResize);
            window.removeEventListener('scroll', onScrollOrResize, true);
            parentEl?.removeEventListener('scroll', onScrollOrResize);
            mo.disconnect();
            if (raf) cancelAnimationFrame(raf);
        };
    }, [actualThread]);

  return (
     <div className="w-full h-full bg-gray-700">
        <div className="absolute top-0 flex flex-row z-80 right-0 m-4 space-x-2">
            <motion.div onClick={handleShare} className="flex bg-gray-800 p-2 text-white rounded-lg shadow-lg cursor-pointer" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <IoMdShareAlt className="w-6 h-6" />
            </motion.div>
            <div className="relative">
                <motion.div ref={(node) => { try { dropdownRefs.setReference(node as any); dropdownTriggerRef.current = node as HTMLElement | null; } catch {} }} onClick={() => { handleDropdown(getActualThread()); setTimeout(() => dropdownUpdate?.(), 0); }} className="flex bg-gray-800 p-2 text-white rounded-lg shadow-lg cursor-pointer" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <IoMdSettings className="w-6 h-6" />
                </motion.div>

                {dropdownMenuOpen && (
                    <div ref={(node) => { try { dropdownRefs.setFloating(node as any); dropdownElRef.current = node as HTMLElement | null; } catch {} }} style={{ position: dropdownStrategy as any, left: dropdownX ?? 0, top: dropdownY ?? 0, zIndex: 9999 }} className="w-48 bg-gray-800 border border-gray-700 rounded-md shadow-lg">
                        <div className="relative">
                            <div
                                className="w-full"
                                onMouseEnter={() => setModelPanelOpen(true)}
                                onMouseLeave={() => setModelPanelOpen(false)}
                            >
                                <button ref={firstItemRef} onClick={() => { console.log('Open account settings'); setDropdownMenuOpen(false); }} className="w-full text-left p-2 hover:bg-gray-700">Switch Model</button>

                                {modelPanelOpen && (
                                    <div className="absolute right-full top-0 mr-0 w-48 max-h-40 overflow-auto bg-gray-800 border border-gray-700 rounded-md shadow-lg z-60">
                                        {models.map((m) => {
                                            const thread = actualThread;
                                            const isSelected = thread?.model ? thread.model === m : actualModel === m;
                                            return (
                                                <button
                                                    key={m}
                                                    onClick={() => handleSelectModel(m)}
                                                    className={`w-full text-left p-2 hover:bg-gray-700 ${isSelected ? "bg-gray-500 font-bold" : ""}`}
                                                >
                                                    {m}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <button onClick={() => { setContextModalOpen(true); setDropdownMenuOpen(false); }} className="w-full text-left p-2 hover:bg-gray-700">Modify Context</button>
                        <div className="border-t border-gray-700" />
                        <button onClick={() => { console.log("delete thread"); setDropdownMenuOpen(false); }} className="w-full text-left p-2 text-red-500 hover:bg-gray-700">Delete Thread</button>
                    </div>
                )}
            </div>
            {contextModalOpen && <SystemContextModal onClose={() => setContextModalOpen(false)} />}

        </div>
        <div className="h-full">
        <span aria-hidden="true" style={{ display: 'none' }}>{String(refreshToggle)}</span>
    
        {  
            actualThread === null ? (
                <div className="mx-auto max-w-80 h-full flex items-center justify-center">
                    <p className="text-gray-300 text-lg text-center">No thread selected. Please create or select a thread to start chatting.</p>
                </div>
            ) : ((actualThread?.messages?.length ?? 0) > 0) ? (
                <div ref={messagesWrapperRef} className="h-full conversations-scroll overflow-y-auto relative">
                    <ChatMessages thread={actualThread} onNewestBranchChange={setisNewestBranch} />
                    {/* Centered fixed input bar */}
                    <div ref={inputBarRef} className="fixed bottom-0 transform -translate-x-1/2 pb-4 bg-gray-700 pointer-events-auto mx-auto w-[calc(100%_-_2.5rem)] 2xl:max-w-6xl xl:max-w-4xl lg:max-w-3xl md:max-w-2xl sm:max-w-lg max-w-80 max-h-90" style={{ left: '50%' }}>
                        <div className="flex items-center space-x-2 p-4 bg-gray-800 rounded-md shadow-lg ">
                            <ChatInput actualThread={actualThread} isNewestBranch={isNewestBranch} isShareThread={isShareThread} handleMessageSend={handleMessageSend} />
                        </div>
                    </div>
                </div>
            ) : (
                <div className="w-full h-full flex items-center flex-col justify-center space-y-8">
                    <h1 className="mx-20 text-white 2xl:text-6xl xl:text-5xl lg:text-4xl md:text-3xl sm:text-lg text-lg text-center">Hello. How can I assist you today?</h1>
                    <div className="w-[calc(100%_-_2.5rem)] 2xl:max-w-6xl xl:max-w-4xl lg:max-w-3xl md:max-w-2xl sm:max-w-lg max-w-80 max-h-90 rounded-md p-4 mx-auto bg-gray-800">
                        <div className="flex flex-1 items-center">
                            <ChatInput actualThread={actualThread} isNewestBranch={isNewestBranch} isShareThread={isShareThread} handleMessageSend={handleMessageSend} />
                        </div>
                    </div>
                    
                </div>
                
            )
            
        }
        </div>
     </div>
    );
}