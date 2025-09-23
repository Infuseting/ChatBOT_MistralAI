import { Thread } from "../utils/Thread";
import { Message } from "../utils/Message";
import { parseMarkdown, isAtRightmostBranch } from "../utils/ChatMessagesHelper";

import React, { useMemo, useState, useEffect, useRef } from "react";
import 'highlight.js/styles/github-dark.css';
let _hljs: any = null;
const _registered = new Set<string>();
async function loadHljs() {
    if (_hljs) return _hljs;
    const mod = await import('highlight.js');
    _hljs = (mod && (mod.default ?? mod)) as any;
    return _hljs;
}
async function ensureLanguage(lang: string) {
    // no-op when using the full highlight.js bundle (languages included)
    return;
}

export default function ChatMessages({ thread }: { thread: Thread }) {
    const messages: Message[] = thread.messages ?? [];

    // build children map: parentId -> Message[] sorted by timestamp
    const childrenMap = useMemo(() => {
        const map = new Map<string, Message[]>();
        for (const m of messages) {
            const key = m.parentId && m.parentId.length > 0 ? m.parentId : 'root';
            const arr = map.get(key) ?? [];
            arr.push(m);
            map.set(key, arr);
        }
        // sort arrays by timestamp
        for (const [k, arr] of map.entries()) {
            arr.sort((a, b) => (a.timestamp?.getTime?.() ?? 0) - (b.timestamp?.getTime?.() ?? 0));
            map.set(k, arr);
        }
        return map;
    }, [messages]);

    // selection index per parentId (which child is active)
    const [selection, setSelection] = useState<Record<string, number>>({});
    const [isRightBranch, setIsRightBranch] = useState(false);

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
    
    function jumpToRightmostBranch() {
        const newSel: Record<string, number> = {};
        let parent = 'root';
        while (true) {
            const arr = childrenMap.get(parent);
            if (!arr || arr.length === 0) break;
            const lastIdx = arr.length - 1;
            newSel[parent] = lastIdx;
            const msg = arr[lastIdx];
            if (!msg) break;
            parent = msg.id;
        }
        setSelection(newSel);
    }
    useEffect(() => {
        if ((messages?.length ?? 0) > 0) {
            jumpToRightmostBranch();
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
    const containerRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        let cancelled = false;
        async function runHighlight() {
            if (cancelled) return;
            const root = containerRef.current;
            if (!root) return;
            const codeEls = Array.from(root.querySelectorAll('pre code[data-raw]')) as HTMLElement[];
            if (codeEls.length === 0) return;
            const hljs = await loadHljs().catch(() => null);
            if (!hljs) return;
            for (const el of codeEls) {
                if (cancelled) break;
                try {
                    const raw = el.getAttribute('data-raw') ?? '';
                    const lang = (el.getAttribute('data-lang') ?? '').toLowerCase();
                    if (lang) {
                        await ensureLanguage(lang);
                        if (_hljs && _hljs.getLanguage(lang)) {
                            const res = _hljs.highlight(raw, { language: lang, ignoreIllegals: true });
                            el.innerHTML = res.value;
                            el.classList.add(`language-${lang}`);
                            continue;
                        }
                    }
                    // fallback to auto-detect
                    const auto = _hljs.highlightAuto(raw);
                    el.innerHTML = auto.value;
                } catch (err) {
                    // leave escaped text as-is on error
                }
            }
        }
        // run async but not blocking render
        void runHighlight();
        return () => { cancelled = true; };
    }, [branch]);
    

    return (
        <div ref={containerRef} className="flex flex-col space-y-4 p-4 overflow-y-auto px-80 conversations-scroll">
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
                    <div className="text-sm whitespace-pre-wrap">{parseMarkdown(m.text)}</div>
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
        </div>
    );
}