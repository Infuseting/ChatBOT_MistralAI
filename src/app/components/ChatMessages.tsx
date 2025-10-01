import { getActualThread, Thread, setActualThread, updateActualThread, updateAllThreadsList } from "../utils/Thread";
import { Message } from "../utils/Message";
import { parseMarkdown, isAtRightmostBranch } from "../utils/ChatMessagesHelper";
import { FaCopy, FaEdit, FaSync, FaTimes } from "react-icons/fa";
import { getFastModelList, getActualModel } from '../utils/Models';
import React, { useMemo, useState, useEffect, useRef } from "react";
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react-dom';
import { showErrorToast, showSuccessToast } from "../utils/toast";
import { handleEditMessage, handleRegenerateMessage } from "../utils/Agent";
import { updateThreadCache } from "../utils/ThreadCache";

/**
 * ChatMessages component
 * Renders a linearized view of a conversation branch for a given `thread`.
 * Props:
 * - thread: the Thread object to render
 * - onNewestBranchChange: optional callback called with true/false when the
 *   currently selected branch becomes the newest branch or not
 */
export default function ChatMessages({ thread, onNewestBranchChange }: { thread: Thread, onNewestBranchChange?: (v: boolean) => void }) {
    const [messages, setMessages] = useState<Message[]>(thread.messages ?? []);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const prevThreadIdRef = useRef<string | null>(null);
    useEffect(() => {
        const incoming = thread.messages ?? [];
        setMessages(prev => {
            // If previous is empty or thread changed, replace outright
            if (!prev || prev.length === 0 || prevThreadIdRef.current !== thread.id) {
                prevThreadIdRef.current = thread.id;
                return incoming;
            }

            // Build a map of existing messages by id for reuse
            const existingById = new Map<string, Message>();
            for (const m of prev) {
                if (m && m.id) existingById.set(m.id, m);
            }

            // Create merged array: reuse existing object when id matches, otherwise keep incoming
            const merged: Message[] = incoming.map((m) => {
                if (m && m.id && existingById.has(m.id)) {
                    const existing = existingById.get(m.id)!;
                    // copy updated fields onto existing object to keep reference stable
                    try { Object.assign(existing, m); } catch (e) {}
                    return existing;
                }
                return m;
            });

            // Also handle any messages that existed but are not present in incoming: keep merged order
            return merged;
        });
    }, [thread.messages, thread.id]);

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
    const [isRightBranch, setIsRightBranch] = useState(true);
    const [refreshToggle, setRefreshToggle] = useState(false); 
    const [regenMenuOpenFor, setRegenMenuOpenFor] = useState<string | null>(null);
    const [regenSubmenuOpenFor, setRegenSubmenuOpenFor] = useState<string | null>(null);
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState<string>('');
    const [editingSubmitting, setEditingSubmitting] = useState<boolean>(false);
    const [openThinkingFor, setOpenThinkingFor] = useState<string | null>(null);
    const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null);

    // Attachment rendering: we now render attachments directly from each message's
    // `attachments` array instead of fetching/storing a separate dictionary.
    const resizeEditingTextarea = () => {
        try {
            const ta = editingTextareaRef.current;
            if (!ta) return;
            // reset height to recalc
            ta.style.height = 'auto';
            const max = 10000; // max height px
            const newH = Math.min(max, ta.scrollHeight);
            ta.style.height = `${newH}px`;
            // ensure vertical overflow when hitting max
            ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
        } catch (e) {}
    };

    // Floating UI hooks for main menu
    const { x: menuX, y: menuY, refs: menuRefs, strategy: menuStrategy, middlewareData: menuMiddlewareData, update: menuUpdate } = useFloating({
        placement: 'bottom-start',
        middleware: [offset(0), flip({ fallbackAxisSideDirection: 'start' }), shift()],
        whileElementsMounted: autoUpdate,
    });

    // Floating UI hooks for submenu
    const { x: subX, y: subY, refs: subRefs, strategy: subStrategy, middlewareData: subMiddlewareData, update: subUpdate } = useFloating({
        placement: 'right-start',
        middleware: [offset(0), flip({ fallbackAxisSideDirection: 'end' }), shift()],
        whileElementsMounted: autoUpdate,
    });

    // Keep explicit refs to the actual DOM nodes so outside-click detection is reliable
    const menuTriggerRef = useRef<HTMLElement | null>(null);
    const menuElementRef = useRef<HTMLElement | null>(null);
    const subTriggerRef = useRef<HTMLElement | null>(null);
    const subElementRef = useRef<HTMLElement | null>(null);

    // Close regen menus when any scroll/interaction occurs (so they don't linger)
    useEffect(() => {
        const onScrollClose = () => {
            setRegenMenuOpenFor(null);
            setRegenSubmenuOpenFor(null);
        };
        window.addEventListener('scroll', onScrollClose, true);
        window.addEventListener('wheel', onScrollClose, { passive: true, capture: true } as any);
        window.addEventListener('touchstart', onScrollClose, { passive: true, capture: true } as any);
        return () => {
            window.removeEventListener('scroll', onScrollClose, true);
            window.removeEventListener('wheel', onScrollClose as any, { passive: true, capture: true } as any);
            window.removeEventListener('touchstart', onScrollClose as any, { passive: true, capture: true } as any);
        };
    }, []);

    // Close menus when clicking/tapping outside the reference or floating elements
    useEffect(() => {
        const onPointerDown = (ev: PointerEvent) => {
            try {
                const target = ev.target as Node | null;
                if (!target) return;

                const insideMenu = (menuTriggerRef.current && menuTriggerRef.current.contains(target)) || (menuElementRef.current && menuElementRef.current.contains(target));
                const insideSub = (subTriggerRef.current && subTriggerRef.current.contains(target)) || (subElementRef.current && subElementRef.current.contains(target));

                if (!insideMenu && !insideSub) {
                    setRegenMenuOpenFor(null);
                    setRegenSubmenuOpenFor(null);
                }
            } catch (e) {
                // ignore
            }
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, []);

    // Focus textarea when editing starts
    useEffect(() => {
        if (editingMessageId) {
            setTimeout(() => {
                try {
                    const ta = editingTextareaRef.current;
                    if (ta) {
                        ta.focus();
                        // put caret at the end so user can continue typing
                        const len = ta.value ? ta.value.length : 0;
                        try { ta.setSelectionRange(len, len); } catch (e) {}
                        resizeEditingTextarea();
                    }
                } catch (e) {}
            }, 20);
        }
    }, [editingMessageId]);

    // Resize textarea on mount/editingText change
    useEffect(() => {
        try { resizeEditingTextarea(); } catch (e) {}
    }, [editingText, editingMessageId]);


    // notify parent when right-branch state changes
    useEffect(() => {
        try {
            if (typeof onNewestBranchChange === 'function') onNewestBranchChange(isRightBranch);
        } catch (e) {
            // ignore
        }
    }, [isRightBranch, onNewestBranchChange]);

    useEffect(() => {
        try {
            (window as any).handleCopyCode = async (code: string) => {
                    try {
                        const decoded = decodeURIComponent(code);
                        await navigator.clipboard.writeText(decoded);
                        try { showSuccessToast('Code copied to clipboard!'); } catch (e) {}
                    } catch (err) {
                        console.error('Failed to copy code', err);
                        try { showErrorToast('Failed to copy code'); } catch (e) {}
                    }
            };
        } catch (e) {
        }

        const updateHandler = async () => { await updateThreadMessages(); };
        window.addEventListener('updateActualThread', updateHandler);
        return () => {
            window.removeEventListener('updateActualThread', updateHandler);
            try { delete (window as any).handleCopyCode; } catch (e) {}
        };
    }, []);
    async function updateThreadMessages() {
        const newMsgs = (await getActualThread())?.messages ?? [];
        // Preserve selection when updating messages for the same thread.
        // Replace the messages array but keep it stable as possible to avoid React remount churn.
        setMessages(prev => {
            // If previous is empty, just set new messages
            if (!prev || prev.length === 0) return newMsgs;
            // If thread hasn't changed, try a cheap check: same length and same ids in order -> keep prev (no-op)
            if (prev.length === newMsgs.length) {
                let same = true;
                for (let i = 0; i < prev.length; i++) {
                    if ((prev[i].id ?? '') !== (newMsgs[i].id ?? '')) { same = false; break; }
                }
                if (same) return newMsgs;
            }
            return newMsgs;
        });
        setRefreshToggle(v => !v);
    }

    // Wait until getActualThread returns a thread containing a message with targetId
    // Polls until timeout and updates local messages when seen.
    async function waitForMessageResync(targetId: string, timeoutMs = 8000, intervalMs = 300) {
        if (!targetId) return null;
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const t = await getActualThread();
                const newMsgs = t?.messages ?? [];
                if (newMsgs.some(m => m && m.id === targetId)) {
                    // update local state to the authoritative server copy
                    setMessages(prev => {
                        if (!prev || prev.length === 0) return newMsgs;
                        if (prev.length === newMsgs.length) {
                            let same = true;
                            for (let i = 0; i < prev.length; i++) {
                                if ((prev[i].id ?? '') !== (newMsgs[i].id ?? '')) { same = false; break; }
                            }
                            if (same) return newMsgs;
                        }
                        return newMsgs;
                    });
                    setRefreshToggle(v => !v);
                    return newMsgs.find(m => m.id === targetId) ?? null;
                }
            } catch (e) {
                // ignore and retry
            }
            await new Promise(res => setTimeout(res, intervalMs));
        }
        return null;
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
            parent = (msg.id && msg.id.length > 0) ? msg.id : 'root';
        }
        return { branch, visitedParents };
    }

    const { branch } = useMemo(() => computeBranch(selection), [childrenMap, selection]);
    // Generate stable keys for rendered messages (fall back when m.id is falsy).
    const branchWithKeys = useMemo(() => {
        const makeKey = (m: Message, idx: number) => {
            if (m.id && m.id.length > 0) return m.id;
            // fallback stable key based on parentId, timestamp and text snippet
            const ts = m.timestamp ? (m.timestamp instanceof Date ? String(m.timestamp.getTime()) : String(m.timestamp)) : '';
            const snippet = (m.text ?? '').slice(0, 64).replace(/\s+/g, ' ').trim();
            const raw = `${m.parentId ?? 'root'}|${ts}|${snippet}`;
            try {
                return `gen-${encodeURIComponent(raw)}`;
            } catch {
                return `gen-${idx}-${ts}`;
            }
        };
        return branch.map((m, i) => ({ m, key: makeKey(m, i) }));
    }, [branch]);
    
    function isMostRecentBranch(sel: Record<string, number>, cmap: Map<string, Message[]>) {
        try {
            // compute branch messages from selection
            const { branch: selBranch } = ((): { branch: Message[] } => {
                const branch: Message[] = [];
                let parent = 'root';
                while (true) {
                    const arr = cmap.get(parent);
                    if (!arr || arr.length === 0) break;
                    const idx = sel[parent] ?? 0;
                    const safeIdx = Math.max(0, Math.min(idx, arr.length - 1));
                    const msg = arr[safeIdx];
                    if (!msg) break;
                    branch.push(msg);
                    parent = (msg.id && msg.id.length > 0) ? msg.id : 'root';
                }
                return { branch };
            })();

            const getTime = (m: any): number => {
                if (!m) return -1;
                const candidates = [m.timestamp, m.date, m.time, m.sentAt, m.createdAt, m.ts];
                for (const c of candidates) {
                    if (c == null) continue;
                    if (c instanceof Date) return c.getTime();
                    if (typeof c === 'number' && !isNaN(c)) return c;
                    try {
                        const parsed = Date.parse(String(c));
                        if (!isNaN(parsed)) return parsed;
                    } catch {}
                }
                // try parsing direct string fields like m.timeStamp or m.raw
                try {
                    const parsed = Date.parse(JSON.stringify(m));
                    if (!isNaN(parsed)) return parsed;
                } catch {}
                return -1;
            };

            // newest timestamp in selected branch
            let newestBranch = -Infinity;
            for (const m of selBranch) {
                const t = getTime(m);
                if (t > newestBranch) newestBranch = t;
            }
            const selIds = new Set(selBranch.map(m => m.id));
            let newestOthers = -Infinity;
            for (const [parent, arr] of cmap.entries()) {
                for (const m of arr) {
                    if (selIds.has(m.id)) continue;
                    const t = getTime(m);
                    if (t > newestOthers) newestOthers = t;
                }
            }
            if (newestBranch === -Infinity && newestOthers !== -Infinity) return false;
            console.log('newestBranch', newestBranch, 'newestOthers', newestOthers);
            return newestBranch >= newestOthers;
        } catch (e) {
            return false;
        }
    }

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
        setIsRightBranch(isMostRecentBranch(newSel, childrenMap));
    }
    useEffect(() => {
        // Only auto-jump to most recent when the thread changes (or on initial mount).
        // If messages update for the same thread, preserve the current scroll/selection.
        if ((messages?.length ?? 0) === 0) {
            prevThreadIdRef.current = thread.id;
            return;
        }
        const prevId = prevThreadIdRef.current ?? null;
        if (prevId !== thread.id) {
            jumpToMostRecentMessage();
        }
        // store current thread id for next update
        prevThreadIdRef.current = thread.id;
    }, [messages.length, thread.id]);


   const prevMsgCountForScrollRef = useRef<number | null>(null);
   const prevThreadIdForScrollRef = useRef<string | null>(null);
    useEffect(() => {
        // Decide whether we should auto-scroll:
        // - First time the thread is loaded (thread id changed)
        // - Or when the number of messages increases (new message arrived)
        const prevCount = prevMsgCountForScrollRef.current ?? null;
        const prevThread = prevThreadIdForScrollRef.current ?? null;
        const shouldScroll = (() => {
            if (prevThread !== thread.id) return true; // new thread / first load
            if (prevCount == null) return true; // first mount
            if (messages.length > prevCount) return true; // new message
            return false;
        })();

        // update trackers for next run
        prevMsgCountForScrollRef.current = messages.length;
        prevThreadIdForScrollRef.current = thread.id;

        if (!shouldScroll) return;

        let raf = 0;
        raf = requestAnimationFrame(() => {
            try {
                const root = rootRef.current;
                const lastId = branchWithKeys[branchWithKeys.length - 1]?.key;
                const EXTRA_PADDING = 160; // px (≈10rem at 16px root font-size)
                if (root && lastId) {
                    let scrollerCheck: HTMLElement | null = root;
                    while (scrollerCheck && scrollerCheck.scrollHeight <= scrollerCheck.clientHeight) scrollerCheck = scrollerCheck.parentElement as HTMLElement | null;
                    const TOLERANCE = 160;
                    const alreadyAtBottom = scrollerCheck ? (scrollerCheck.scrollHeight - scrollerCheck.scrollTop - scrollerCheck.clientHeight <= TOLERANCE) : false;
                    if (alreadyAtBottom) {
                        return;
                    }
                    const el = root.querySelector(`[data-msg-id="${lastId}"]`) as HTMLElement | null;
                    if (el) {
                        if (typeof el.scrollIntoView === 'function') {
                            el.scrollIntoView({ behavior: 'smooth', block: 'end' });
                        }
                        let scroller: HTMLElement | null = root;
                        while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement as HTMLElement | null;
                        if (scroller) {
                            const elRect = el.getBoundingClientRect();
                            const scrollerRect = scroller.getBoundingClientRect();
                            const delta = elRect.bottom - scrollerRect.bottom;
                            const scrollBy = Math.max(0, delta) + EXTRA_PADDING;
                            if (scrollBy > 0) {
                                scroller.scrollBy({ top: scrollBy, behavior: 'smooth' });
                            }
                        }
                        return;
                    }
                }

                let scroller = root?.parentElement ?? null;
                while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
                if (scroller) {
                    scroller.scrollTo({ top: scroller.scrollHeight + EXTRA_PADDING, behavior: 'smooth' });
                }
            } catch (e) {
                // ignore
            }
        });
        return () => { if (raf) cancelAnimationFrame(raf); };
    }, [messages.length, thread.id]); // only react to thread / messages changes

    function navigate(parentId: string, newIndex: number) {
        const newSel = { ...selection, [parentId]: newIndex };
        // recompute branch and keep only selections that are on the new path
        const { visitedParents } = computeBranch(newSel);
        const filtered: Record<string, number> = {};
        for (const p of visitedParents) {
            if (newSel[p] !== undefined) filtered[p] = newSel[p];
        }
        setIsRightBranch(isMostRecentBranch(filtered, childrenMap));
        
        setSelection(filtered);
    }

    function jumpToMessage(message: Message) {
        if (!message || !messages || messages.length === 0) return;
        const targetMsg = messages.find(m => m.id === message.id) ?? message;
        console.log(targetMsg);
        const newSel: Record<string, number> = {};
        let cur: Message | undefined = targetMsg;
        while (cur) {
            const parentId: string = cur.parentId && cur.parentId.length > 0 ? cur.parentId : 'root';
            const siblings = childrenMap.get(parentId) ?? [];
            const idx = siblings.findIndex(s => s.id === cur!.id);
            console.log(idx);
            if (idx >= 0) newSel[parentId] = idx;
            if (parentId === 'root') break;
            cur = messages.find(m => m.id === parentId);
            if (!cur) break;
        }
        setSelection(newSel);
    }
    
    

    return (
        <div ref={rootRef} className="flex flex-col space-y-4 p-4 lg:max-w-220 md:max-w-160 max-w-80 mx-auto">
            
                    
            {/* render branch messages */}
            {branchWithKeys.map(({ m, key }, i) => (
                <div ref={i === branchWithKeys.length - 1 ? undefined : undefined} data-msg-id={key} key={key} className={`${i === 0 ? 'mt-8' : ''} ${m.sender === 'assistant' ? "max-w-[100%] min-w-[100%]" : "max-w-[80%] min-w-[80%] text-end"} p-3 rounded-md ${m.sender === 'user' ? 'self-end text-white' : 'self-star text-white'}`}>
                    <div className={`text-lg ${m.sender === 'user' ? 'bg-indigo-600 p-2 rounded-md' : ''}`}>
                        {/* Render attachments directly from the message's attachments array */}
                        {m.sender === 'user' && Array.isArray(m.attachments) && m.attachments.length > 0 && (
                            <div className="flex flex-row flex-wrap space-x-1 spacey-1">
                                {m.attachments.map((att, index) => (
                                    <div key={index} className="mb-2 p-2 bg-gray-800 rounded w-fit-content">
                                        {att.fileName}
                                    </div>
                                ))}
                            </div>
                        )}
                        
                        {m.sender === 'assistant' && (m.thinking && m.thinking.length > 0) && (
                                    <div className="mt-2">
                                        <button className="text-sm text-gray-400 hover:text-white underline" onClick={() => setOpenThinkingFor(prev => prev === m.id ? null : m.id)}>
                                            {openThinkingFor === m.id ? 'Hide thinking' : 'See thinking'}
                                        </button>
                                        {openThinkingFor === m.id && (
                                            <div className="mt-2 pl-4 border-l-2 border-gray-600 text-gray-300">
                                                {/* Render thinking as pre-wrapped text to preserve formatting */}
                                                <div className="whitespace-pre-wrap">{m.thinking}</div>
                                            </div>
                                        )}
                                    </div>
                                )}
                        {m.sender === 'assistant' ? parseMarkdown(m.text) : (
                            editingMessageId === m.id ? (
                                <textarea ref={editingTextareaRef} rows={1} value={editingText} onChange={(e) => { setEditingText(e.target.value); resizeEditingTextarea(); }} onKeyDown={async (ev) => {
                                    if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.altKey) {
                                        ev.preventDefault();
                                        if (editingSubmitting) return;
                                        setEditingSubmitting(true);
                                        try {
                                            m.text = editingText;
                                            await handleEditMessage(thread, m, editingText);
                                            const synced = m.id ? await waitForMessageResync(m.id) : null;
                                            if (synced) {
                                                jumpToMessage(synced);
                                                await updateThreadMessages();
                                            } else {
                                                await updateThreadMessages();
                                            }
                                        } catch (e) {
                                            try { showErrorToast('Échec de la modification.'); } catch (e) {}
                                        } finally {
                                            setEditingSubmitting(false);
                                            setEditingMessageId(null);
                                            setEditingText('');
                                        }
                                    } else if (ev.key === 'Escape') {
                                        ev.preventDefault();
                                        setEditingMessageId(null);
                                        setEditingText('');
                                    }
                                }} className="w-full p-0 rounded bg-transparent text-white resize-none text-right" style={{ border: 'none', outline: 'none', background: 'transparent', textAlign: 'right' }} />
                                ) : (
                                <p className="whitespace-pre-wrap">{m.text}</p>
                            )
                        )}
                    </div>
                    
                    {(() => {
                        // Determine the parent and siblings for this message so we can render
                        // the chooser directly on the item instead of on its parent.
                        const parentId = (m.parentId && m.parentId.length > 0) ? m.parentId : 'root';
                        const siblings = childrenMap.get(parentId) ?? [];
                        // selection is stored keyed by parent id; fall back to finding this message's index
                        const idxFromSel = selection[parentId];
                        const foundIdx = siblings.findIndex(s => s.id === m.id);
                        const idx = (typeof idxFromSel === 'number') ? idxFromSel : (foundIdx >= 0 ? foundIdx : 0);

                        return (
                            <>
                                {m.sender === 'assistant' && (
                                    <hr className="my-2 border-t border-gray-600" />
                                )}
                            
                                <div className={`mt-2 flex items-center ${m.sender === 'assistant' ? 'justify-start flex-row' : 'justify-start flex-row-reverse'} text-sm text-gray-400`}>
                                    {editingMessageId !== m.id && (
                                        <>
                                            <div className={`flex ${siblings.length > 1 ? '' : 'hidden'}`}>
                                                <button onClick={() => navigate(parentId, Math.max(0, idx - 1))} className="px-2">◀</button>
                                                <div>{idx + 1} / {siblings.length}</div>
                                                <button onClick={() => navigate(parentId, Math.min(siblings.length - 1, idx + 1))} className="px-2">▶</button>
                                            </div>
                                            <FaCopy title="Copy code" className={`hover:text-white cursor-pointer mx-2`} onClick={() => {
                                                try {
                                                    (window as any).handleCopyCode(m.text ?? '');
                                                } catch (e) {
                                                }
                                            }} />
                                        </>
                                    )}
                                    {editingMessageId !== m.id && m.sender === 'assistant' && isRightBranch && (
                                        <div className={`relative mx-2`}>
                                            <div ref={(node) => { try { menuRefs.setReference(node as any); menuTriggerRef.current = node as HTMLElement | null; } catch {} }}>
                                                <FaSync title="Regenerate" className={`hover:text-white cursor-pointer`} onClick={() => {
                                                    setRegenMenuOpenFor(prev => prev === m.id ? null : m.id);
                                                    setRegenSubmenuOpenFor(null);
                                                    setTimeout(() => menuUpdate?.(), 0);
                                                }} />
                                            </div>
                                            {regenMenuOpenFor === m.id && (
                                                <div ref={(node) => { try { menuRefs.setFloating(node as any); menuElementRef.current = node as HTMLElement | null; } catch {} }} style={{ position: menuStrategy as any, left: menuX ?? 0, top: menuY ?? 0, minWidth: 224, zIndex: 9999 }} className="bg-gray-800 border border-gray-700 rounded-md shadow-lg">
                                                    <button className="w-full text-left p-2 hover:bg-gray-700" onClick={async () => {
                                                        try {
                                                            setRegenMenuOpenFor(null);
                                                            const usedModel = thread.model || getActualModel();
                                                            const message = await handleRegenerateMessage(thread, m, usedModel);
                                                            const synced = message && message.id ? await waitForMessageResync(message.id) : null;
                                                            if (synced) jumpToMessage(synced);
                                                            else { await updateThreadMessages(); message && jumpToMessage(message); }
                                                        } catch (e) {}
                                                    }}>Regenerate (same model)</button>
                                                    <div className="border-t border-gray-700" />
                                                    <div className="relative" onMouseEnter={() => { setRegenSubmenuOpenFor(m.id); setTimeout(() => subUpdate?.(), 0); }} onMouseLeave={() => setRegenSubmenuOpenFor(null)}>
                                                        <button ref={(node) => { try { subRefs.setReference(node as any); subTriggerRef.current = node as HTMLElement | null; } catch {} }} className="w-full text-left p-2 hover:bg-gray-700">Regenerate with →</button>
                                                        {regenSubmenuOpenFor === m.id && (
                                                            <div ref={(node) => { try { subRefs.setFloating(node as any); subElementRef.current = node as HTMLElement | null; } catch {} }} style={{ position: subStrategy as any, left: subX ?? 0, top: subY ?? 0, minWidth: 192, zIndex: 9999 }} className="bg-gray-800 border border-gray-700 rounded-md shadow-lg">
                                                                {getFastModelList().map((fm) => (
                                                                    <button key={fm} className="w-full text-left p-2 hover:bg-gray-700" onClick={async () => {
                                                                        try {
                                                                            setRegenMenuOpenFor(null);
                                                                            setRegenSubmenuOpenFor(null);
                                                                            const message = await handleRegenerateMessage(thread, m, fm);
                                                                            const synced = message && message.id ? await waitForMessageResync(message.id) : null;
                                                                            if (synced) jumpToMessage(synced);
                                                                            else { await updateThreadMessages(); message && jumpToMessage(message); }
                                                                        } catch (e) {}
                                                                    }}>{fm}</button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {m.sender === 'user' && isRightBranch && (
                                        <>
                                            {editingMessageId && editingMessageId !== m.id && (
                                                <button className="mx-2 text-sm px-2 py-1 rounded bg-gray-700" onClick={() => {
                                                    try { showErrorToast('Un autre message est en cours d\'édition.'); } catch (e) {}
                                                }}>Édition en cours</button>
                                            )}
                                            {editingMessageId === m.id ? (
                                                <div className="flex items-center space-x-2 mx-2">
                                                    <button disabled={editingSubmitting} className={`px-3 py-1 rounded bg-indigo-600 text-white ${editingSubmitting ? 'opacity-50' : ''}`} onClick={async () => {
                                                        if (editingSubmitting) return;
                                                        setEditingSubmitting(true);
                                                        try {
                                                            m.text
                                                            await handleEditMessage(thread, m, editingText );
                                                            const synced = m.id ? await waitForMessageResync(m.id) : null;
                                                            if (synced) {
                                                                jumpToMessage(synced);
                                                                await updateThreadMessages();
                                                            } else {
                                                                await updateThreadMessages();
                                                            }
                                                        } catch (e) {
                                                            try { showErrorToast('Échec de la modification.'); } catch (e) {}
                                                        } finally {
                                                            setEditingSubmitting(false);
                                                            setEditingMessageId(null);
                                                            setEditingText('');
                                                        }
                                                    }}>Envoyer</button>
                                                    <button title="Annuler" className="px-2 py-1 rounded bg-gray-600 text-white" onClick={() => { setEditingMessageId(null); setEditingText(''); }}><FaTimes /></button>
                                                </div>
                                            ) : (
                                                <FaEdit title="Edit" className={`hover:text-white cursor-pointer mx-2`} onClick={async () => {
                                                    try {
                                                        if (editingMessageId) {
                                                            try { showErrorToast('Un autre message est en cours d\'édition.'); } catch (e) {}
                                                            return;
                                                        }
                                                        setEditingMessageId(m.id ?? null);
                                                        setEditingText(m.text ?? '');
                                                    } catch (e) {
                                                    }
                                                }} />
                                            )}
                                        </>
                                    )}

                                </div>
                            </>
                        );
                    })()}
                    
                </div>

            ))}
            <span aria-hidden="true" style={{ display: 'none' }}>{String(refreshToggle)}</span>
        </div>
    );
}