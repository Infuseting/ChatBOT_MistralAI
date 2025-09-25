import { getActualThread, Thread } from "../utils/Thread";
import { Message } from "../utils/Message";
import { parseMarkdown, isAtRightmostBranch } from "../utils/ChatMessagesHelper";

import React, { useMemo, useState, useEffect, useRef } from "react";
import { toast, Bounce } from 'react-toastify';


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

    // When selection or branch changes scroll the conversation to show the most recent branch
    useEffect(() => {
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
                        // try native scrollIntoView first
                        if (typeof el.scrollIntoView === 'function') {
                            el.scrollIntoView({ behavior: 'smooth', block: 'end' });
                        }

                        // additionally ensure the nearest scrollable ancestor shows the element with extra padding
                        let scroller: HTMLElement | null = root;
                        while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement as HTMLElement | null;

                        if (scroller) {
                            const elRect = el.getBoundingClientRect();
                            const scrollerRect = scroller.getBoundingClientRect();
                            const delta = elRect.bottom - scrollerRect.bottom;
                            // If element bottom is below scroller bottom, scroll by that amount plus padding.
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
    }, [selection, branch.length]);

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

    
    

    // after render, find code blocks emitted by parseMarkdown and highlight them lazily
    
    

    return (
        <div ref={rootRef} className="flex flex-col space-y-4 p-4 lg:max-w-220 md:max-w-160 max-w-80 mx-auto">
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
            {branchWithKeys.map(({ m, key }, i) => (
                <div ref={i === branchWithKeys.length - 1 ? undefined : undefined} data-msg-id={key} key={key} className={`${i === 0 ? 'mt-[15%]' : i === branchWithKeys.length - 1 ? '2xl:mb-[10%] xl:mb-[10%] lg:mb-[10%] md:mb-[10%] sm:mb-[35%] mb-[40%]' : ''} ${m.sender === 'assistant' ? "max-w-[100%]" : "max-w-[80%]"} p-3 rounded-md ${m.sender === 'user' ? 'self-end bg-indigo-600 text-white' : 'self-star text-white'}`}>
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