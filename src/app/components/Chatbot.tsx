"use client"
import { IoMdSettings, IoMdShareAlt } from "react-icons/io";
import { motion } from "motion/react";
import { getActualThread, getShareLink, Thread } from "../utils/Thread";
import { toast, Bounce } from "react-toastify";
import { useState, useRef, useEffect } from "react";
import SystemContextModal from "./SystemContextModal";
import { getActualModel, getAvailableModelList, getFastModelList, setActualModel } from '../utils/Models';
async function handleShare() {
    try {
        console.log("Sharing thread:", (globalThis as any).actualThread);
        const link = getShareLink((globalThis as any).actualThread as Thread);
        await navigator.clipboard.writeText(link);
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

export default function Chatbot() {
    const [dropdownMenuOpen, setDropdownMenuOpen] = useState(false);
    const [modelPanelOpen, setModelPanelOpen] = useState(false);
    const [contextModalOpen, setContextModalOpen] = useState(false);
    const [actualModel, setActualModelState] = useState<string | null>(null);
    const [models, setModels] = useState<string[]>([]);
    
    const menuRef = useRef<HTMLDivElement | null>(null);
    const firstItemRef = useRef<HTMLButtonElement | null>(null);
    function handleDropdownMenu() {
        if (getActualThread() === null) {toast.error('Aucun thread ouvert', {
            position: "bottom-right",
            autoClose: 5000,
            hideProgressBar: false,
            closeOnClick: false,
            pauseOnHover: true,
            draggable: true,
            progress: undefined,
            theme: "dark",
            transition: Bounce,
        }); return;}
        setDropdownMenuOpen((v) => !v); 
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
        window.addEventListener('fastModelListUpdated', onFastModelListUpdated);
        return () => {
            window.removeEventListener('fastModelListUpdated', onFastModelListUpdated);
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
        const thread = getActualThread();
        if (thread) {
            thread.model = model;
            setActualModelState(model);
        } else {
            setActualModel(model);
            setActualModelState(model);
        }
        setDropdownMenuOpen(false);
    }

    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            if (!menuRef.current) return;
            if (e.target instanceof Node && !menuRef.current.contains(e.target)) {
                setDropdownMenuOpen(false);
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
        if (dropdownMenuOpen) {
            firstItemRef.current?.focus();
        }
    }, [dropdownMenuOpen]);

  return (
     <div className="w-full h-full bg-gray-700">
        <div className="absolute top-0 flex flex-row right-0 m-4 space-x-2">
            <motion.div onClick={handleShare} className="flex bg-gray-800 p-2 text-white rounded-lg shadow-lg cursor-pointer" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <IoMdShareAlt className="w-6 h-6" />
            </motion.div>
            <div className="relative">
                <motion.div onClick={() => {handleDropdownMenu()}} className="flex bg-gray-800 p-2 text-white rounded-lg shadow-lg cursor-pointer" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <IoMdSettings className="w-6 h-6" />
                </motion.div>

                {dropdownMenuOpen && (
                    <div ref={menuRef} className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded-md shadow-lg z-50">
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
                                            const thread = getActualThread();
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
     </div>
    );
}