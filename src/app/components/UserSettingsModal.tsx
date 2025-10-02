"use client";

import { FaTimes, FaRobot } from 'react-icons/fa';
import { MdManageAccounts } from "react-icons/md";
import { AiOutlineBook } from "react-icons/ai";
import { motion } from "motion/react";
import { useState } from 'react';
import AccountSettings from './AccountSettings';
import ModeleSettings from './ModeleSettings';
import ContextSettings from './ContextSettings';

const MotionFaTimes = motion(FaTimes);


/**
 * UserSettingsModal
 *
 * Modal presenting account, model and context settings. The left-hand column
 * switches between panels and the right-hand area renders the active panel.
 *
 * Props:
 * - onClose(): callback invoked when the modal should be closed
 */
export default function UserSettingsModal({ onClose, initialPanel }: { onClose: () => void, initialPanel?: 'account' | 'modele' | 'context' }) {
    const [panel, setPanel] = useState<'account' | 'modele' | 'context'>(initialPanel ?? 'account');

    return (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative flex bg-gray-800 text-white rounded-lg xl:w-[40%] lg:w-[50%] md:w-[70%] sm:w-[80%] w-[100%] max-h-[80%] min-h-[40%] h-[80%] shadow-lg">
                <nav className="flex flex-col max-w-[30%] h-full rounded-l-lg w-full p-2">
                    <MotionFaTimes whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} className='w-8 h-8 p-2 rounded-md hover:bg-gray-700' onClick={onClose} />
                    <ul className='mt-4 space-y-0.5'>
                        <motion.li onClick={() => setPanel('account')} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className={`p-2 rounded-md flex items-center cursor-pointer space-x-1 ${panel === 'account' ? 'bg-gray-700' : 'hover:bg-gray-700'}`}>
                            <MdManageAccounts className='inline text-2xl' />
                            <span>Account</span>
                        </motion.li>
                        <motion.li onClick={() => setPanel('modele')} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className={`p-2 rounded-md flex items-center cursor-pointer space-x-1 ${panel === 'modele' ? 'bg-gray-700' : 'hover:bg-gray-700'}`}>
                            <FaRobot className='inline text-2xl' />
                            <span>Modele</span>
                        </motion.li>
                        <motion.li onClick={() => setPanel('context')} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className={`p-2 rounded-md flex items-center cursor-pointer space-x-1 ${panel === 'context' ? 'bg-gray-700' : 'hover:bg-gray-700'}`}>
                            <AiOutlineBook className='inline text-2xl' />
                            <span>Context</span>
                        </motion.li>                           
                    </ul>
                </nav>
                <div
                    role="separator"
                    aria-orientation="vertical"
                    className="w-px bg-gray-700 h-full self-stretch mx-2"
                />
                <main className='rounded-r-lg h-full w-full p-4 overflow-auto'>
                    {panel === 'account' && <AccountSettings />}
                    {panel === 'modele' && <ModeleSettings />}
                    {panel === 'context' && <ContextSettings />}
                </main>
            </div>
        </div>
    );
}