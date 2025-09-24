import { getActualThread, Thread } from "../utils/Thread";
import { Message } from "../utils/Message";
import { parseMarkdown, isAtRightmostBranch } from "../utils/ChatMessagesHelper";

import React, { useMemo, useState, useEffect, useRef } from "react";
import { toast, Bounce } from 'react-toastify';


export default function ChatMessages({ thread, onRightBranchChange }: { thread: Thread, onRightBranchChange?: (v: boolean) => void }) {
    const [messages, setMessages] = useState<Message[]>(thread.messages ?? []);
    useEffect(() => {
        setMessages(thread.messages ?? []);
    }, [thread.messages]);

    const childrenMap = useMemo(() => {
        const map = new Map<string, Message[]>();
        for (const m of messages) {
            const key = m.parentId && m.parentId.length > 0 ? m.parentId : 'root';
            const arr = map.get(key) ?? [];
            arr.push(m);
            map.set(key, arr);
        }

        for (const [k, arr] of map.entries()) {
            arr.sort((a, b) => (a.timestamp?.getTime?.() ?? 0) - (b.timestamp?.getTime?.() ?? 0));
            map.set(k, arr);
        }
        return map;
    }, [messages]);
    const [selection, setSelection] = useState<Record<string, number>>({});
    const [isRightBranch, setIsRightBranch] = useState(false);
    const [refreshToggle, setRefreshToggle] = useState(false); 

    // notify parent when right-branch state changes
    useEffect(() => {
        try {
            if (typeof onRightBranchChange === 'function') onRightBranchChange(isRightBranch);
        } catch (e) {
            // ignore
        }
    }, [isRightBranch, onRightBranchChange]);

    useEffect(() => {
        try {
            (window as any).handleCopyCode = async (code: string) => {
                try {
                    const decoded = decodeURIComponent(code);
                    await navigator.clipboard.writeText(decoded);
                    try {
                        toast.success('Code copied to clipboard!', {
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
                    } catch (e) {}
                } catch (err) {
                    console.error('Failed to copy code', err);
                    try {
                        toast.error('Failed to copy code', {
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
                    } catch (e) {}
                }
            };
        } catch (e) {
        }
        window.addEventListener('updateActualThread', async () => { await updateThreadMessages(); });
        return () => {
            window.removeEventListener('updateActualThread', async () => { await updateThreadMessages(); });
            try { delete (window as any).handleCopyCode; } catch (e) {}
        };
    }, []);
    async function updateThreadMessages() {
        setMessages((await getActualThread())?.messages ?? []);
        setRefreshToggle(v => !v);        
    }
    // compute branch following selection (defaults to 0 when missing)
    function computeBranch(sel: Record<string, number>) {
        const branch: Message[] = [];
        const visitedParents = new Set<string>();
        let parent = 'root';
        while (true) {
            const arr = childrenMap.get(parent);
            if (!arr || arr.length === 0) break;
            const idx = sel[parent] ?? 0;
            const safeIdx = Math.max(0, Math.min(idx, arr.length - 1));
            visitedParents.add(parent);
            const msg = arr[safeIdx];
            if (!msg) break;
            branch.push(msg);
            parent = msg.id;
        }
        return { branch, visitedParents };
    }

    const { branch } = useMemo(() => computeBranch(selection), [childrenMap, selection]);
    
    function jumpToMostRecentMessage() {
        if (!messages || messages.length === 0) {
            setSelection({});
            setIsRightBranch(true);
            return;
        }

        // find the most recent message by timestamp
        let mostRecent = messages[0];
        for (const m of messages) {
            if ((m.timestamp?.getTime?.() ?? 0) > (mostRecent.timestamp?.getTime?.() ?? 0)) {
                mostRecent = m;
            }
        }

        // walk up from the most recent message to root, recording indexes in each parent
        const newSel: Record<string, number> = {};
        let cur: Message | undefined = mostRecent;
        while (cur) {
            const parentId : string = cur.parentId && cur.parentId.length > 0 ? cur.parentId : 'root';
            const siblings = childrenMap.get(parentId) ?? [];
            const idx = siblings.findIndex(s => s.id === cur!.id);
            if (idx >= 0) newSel[parentId] = idx;

            if (parentId === 'root') break;
            cur = messages.find(m => m.id === parentId);
            if (!cur) break;
        }

        setSelection(newSel);
        setIsRightBranch(isAtRightmostBranch(newSel, childrenMap));
    }
    useEffect(() => {
        if ((messages?.length ?? 0) > 0) {
            jumpToMostRecentMessage();
        }
    }, [childrenMap, messages.length]);

    function navigate(parentId: string, newIndex: number) {
        const newSel = { ...selection, [parentId]: newIndex };
        // recompute branch and keep only selections that are on the new path
        const { visitedParents } = computeBranch(newSel);
        const filtered: Record<string, number> = {};
        for (const p of visitedParents) {
            if (newSel[p] !== undefined) filtered[p] = newSel[p];
        }
        setIsRightBranch(isAtRightmostBranch(filtered, childrenMap));
        
        setSelection(filtered);
    }

    
    

    // after render, find code blocks emitted by parseMarkdown and highlight them lazily
    
    

    return (
        <div className="flex flex-col space-y-4 p-4 px-80">
            {/* root navigator if multiple root children */}
            <div className="flex items-center justify-between">
                {(() => {
                    const roots = childrenMap.get('root') ?? [];
                    if (roots.length <= 1) return null;
                    const idx = selection['root'] ?? 0;
                    return (
                        <div className="flex items-center justify-center text-sm text-gray-400 space-x-2">
                            <button onClick={() => navigate('root', Math.max(0, idx - 1))} className="px-2">◀</button>
                            <div>{idx + 1} / {roots.length}</div>
                            <button onClick={() => navigate('root', Math.min(roots.length - 1, idx + 1))} className="px-2">▶</button>
                        </div>
                    );
                })()}
            </div>

            {/* render branch messages */}
            {branch.map((m, i) => (
                <div key={m.id} className={`${i === 0 ? 'mt-[15%]' : i === branch.length - 1 ? 'mb-[40%]' : ''} ${m.sender === 'assistant' ? "max-w-[100%]" : "max-w-[80%]"} p-3 rounded-md ${m.sender === 'user' ? 'self-end bg-indigo-600 text-white' : 'self-star text-white'}`}>
                    <div className="text-lg">{parseMarkdown(m.text)}</div>
                    {/* if this message has multiple children, show navigator */}
                    {(() => {
                        const children = childrenMap.get(m.id) ?? [];
                        if (children.length <= 1) return null;
                        const idx = selection[m.id] ?? 0;
                        return (
                            <div className="mt-2 flex items-center justify-center text-sm text-gray-400 space-x-2">
                                <button onClick={() => navigate(m.id, Math.max(0, idx - 1))} className="px-2">◀</button>
                                <div>{idx + 1} / {children.length}</div>
                                <button onClick={() => navigate(m.id, Math.min(children.length - 1, idx + 1))} className="px-2">▶</button>
                            </div>
                        );
                    })()}
                </div>
            ))}
            <span aria-hidden="true" style={{ display: 'none' }}>{String(refreshToggle)}</span>
        </div>
    );
}