import React from "react";
import { Message } from "./Message";

export function isAtRightmostBranch(sel: Record<string, number>, childrenMap: Map<string, Message[]>) {
        let parent = 'root';
        while (true) {
            const arr = childrenMap.get(parent);
            if (!arr || arr.length === 0) return true; 
            const idx = sel[parent] ?? 0;
            if (idx !== arr.length - 1) return false;
            const msg = arr[idx];
            if (!msg) return true;
            parent = msg.id;
        }
        return false;
    }
export function parseMarkdown(text: string) {
        if (!text) return null;

        const escapeHtml = (s: string) =>
            s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // store fenced code blocks and footnotes separately so inline processing won't mangle them
        const codeBlocks: Record<string, { lang?: string; code: string; raw?: string }> = {};
        let codeCounter = 0;
        text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_m, lang, code) => {
            const key = `__CODEBLOCK_${codeCounter++}__`;
            // store raw for highlighting and escaped for safe fallback
            codeBlocks[key] = { lang, code: escapeHtml(code), raw: code };
            return key;
        });

        // extract footnote definitions
        const footnotes: Record<string, string> = {};
        const lines = text.split(/\r?\n/);
        const filteredLines: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(/^\[\^([^\]]+)\]:\s*(.*)$/);
            if (m) {
                const id = m[1];
                let rest = m[2] ?? "";
                // consume following indented lines as part of footnote
                while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) {
                    rest += "\n" + lines[i + 1].trim();
                    i++;
                }
                footnotes[id] = rest;
            } else {
                filteredLines.push(lines[i]);
            }
        }

        

        // block-level parsing
        const blocks: string[] = [];
        for (let i = 0; i < filteredLines.length; i++) {
            const line = filteredLines[i];

            // horizontal rule
            if (/^\s*---\s*$/.test(line)) {
                blocks.push("<hr/>");
                continue;
            }

            // heading with optional id {#id}
            const h = line.match(/^(#{1,6})\s*(.*?)\s*(\{\#([A-Za-z0-9\-_]+)\})?\s*$/);
            if (h) {
                const level = h[1].length;
                const content = h[2] || "";
                const id = h[4] ? ` id="${escapeHtml(h[4])}"` : "";
                blocks.push(`<h${level}${id}>${escapeHtml(content)}</h${level}>`);
                continue;
            }

            // blockquote (collect consecutive > lines)
            if (/^\s*>\s?/.test(line)) {
                const quoteLines: string[] = [];
                let j = i;
                while (j < filteredLines.length && /^\s*>\s?/.test(filteredLines[j])) {
                    quoteLines.push(filteredLines[j].replace(/^\s*>\s?/, ""));
                    j++;
                }
                i = j - 1;
                blocks.push(`<blockquote>${escapeHtml(quoteLines.join("\n"))}</blockquote>`);
                continue;
            }

            // table detection: header line with pipes and separator line with dashes
            if (/\|/.test(line) && i + 1 < filteredLines.length && /^\s*\|?[:\- ]+\|[:\- \|]+$/.test(filteredLines[i + 1])) {
                const headerCells = line.split("|").map(s => s.trim()).filter(Boolean);
                const rows: string[][] = [];
                let j = i + 2;
                while (j < filteredLines.length && /\|/.test(filteredLines[j])) {
                    const cells = filteredLines[j].split("|").map(s => s.trim()).filter(Boolean);
                    rows.push(cells);
                    j++;
                }
                i = j - 1;
                const th = headerCells.map(c => `<th>${escapeHtml(c)}</th>`).join("");
                const trs = rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("");
                blocks.push(`<table class="markdown-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
                continue;
            }

            // definition list: line followed by : definition
            if (i + 1 < filteredLines.length && /^\s*:\s+/.test(filteredLines[i + 1])) {
                const dt = escapeHtml(line);
                const dd = escapeHtml(filteredLines[i + 1].replace(/^\s*:\s+/, ""));
                blocks.push(`<dl><dt>${dt}</dt><dd>${dd}</dd></dl>`);
                i++; // consumed next line
                continue;
            }

            // lists (ordered and unordered) - collect consecutive items
            const unorderedRe = /^\s*[-+*]\s+(.*)$/;
            const orderedRe = /^\s*\d+\.\s+(.*)$/;
            if (unorderedRe.test(line) || orderedRe.test(line)) {
                const isOrdered = orderedRe.test(line);
                const items: string[] = [];
                let j = i;
                while (j < filteredLines.length && (isOrdered ? orderedRe.test(filteredLines[j]) : unorderedRe.test(filteredLines[j]))) {
                    const m = filteredLines[j].match(isOrdered ? orderedRe : unorderedRe);
                    const raw = m ? m[1] : filteredLines[j];
                    // task list?
                    const task = raw.match(/^\s*\[([ xX])\]\s+(.*)$/);
                    if (task) {
                        const checked = /[xX]/.test(task[1]);
                        items.push(`<li><input type="checkbox" disabled ${checked ? "checked" : ""}/> ${escapeHtml(task[2])}</li>`);
                    } else {
                        items.push(`<li>${escapeHtml(raw)}</li>`);
                    }
                    j++;
                }
                i = j - 1;
                blocks.push(isOrdered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
                continue;
            }

            // plain paragraph (preserve single newlines as <br/> by later CSS whitespace-pre-wrap; wrap in p)
            if (line.trim() === "") {
                // preserve blank line as separator
                blocks.push("");
            } else {
                blocks.push(`<p>${escapeHtml(line)}</p>`);
            }
        }

        let html = blocks.join("\n");

        // inline replacements (do not touch code block placeholders)
        // images ![alt](url)
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
            const u = url.replace(/^\s+|\s+$/g, "");
            const safe = /^(https?:\/\/|\/|mailto:)/i.test(u) ? u : "#";
            return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}" />`;
        });
        // links [title](url)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, title, url) => {
            const u = url.replace(/^\s+|\s+$/g, "");
            const safe = /^(https?:\/\/|\/|mailto:)/i.test(u) ? u : "#";
            return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`;
        });
        // inline code `code`
        html = html.replace(/`([^`]+)`/g, (_m, code) => `<code>${escapeHtml(code)}</code>`);
        // bold **text** or __text__
        html = html.replace(/\*\*(.+?)\*\*/g, (_m, t) => `<strong>${escapeHtml(t)}</strong>`);
        html = html.replace(/__(.+?)__/g, (_m, t) => `<strong>${escapeHtml(t)}</strong>`);
        // italic *text* or _text_
        html = html.replace(/\*(.+?)\*/g, (_m, t) => `<em>${escapeHtml(t)}</em>`);
        html = html.replace(/_(.+?)_/g, (_m, t) => `<em>${escapeHtml(t)}</em>`);
        // strikethrough
        html = html.replace(/~~(.+?)~~/g, (_m, t) => `<del>${escapeHtml(t)}</del>`);
        // highlight ==text==
        html = html.replace(/==(.+?)==/g, (_m, t) => `<mark>${escapeHtml(t)}</mark>`);
        // subscript H~2~O
        html = html.replace(/~(.*?)~/g, (_m, t) => `<sub>${escapeHtml(t)}</sub>`);
        // superscript X^2^
        html = html.replace(/\^(.*?)\^/g, (_m, t) => `<sup>${escapeHtml(t)}</sup>`);
        // simple emoji map for common shortcodes
        const emojiMap: Record<string, string> = {
            ":joy:": "😂",
            ":smile:": "😄",
            ":thumbsup:": "👍",
            ":heart:": "❤️",
        };
        html = html.replace(/:([a-z0-9_+-]+):/gi, (m) => emojiMap[m.toLowerCase()] ?? m);

        // footnote references [^id] -> superscript number and collect footnotes to append
        const footnoteOrder: string[] = [];
        html = html.replace(/\[\^([^\]]+)\]/g, (_m, id) => {
            if (!footnotes[id]) return `<sup>[${escapeHtml(id)}]</sup>`;
            if (!footnoteOrder.includes(id)) footnoteOrder.push(id);
            const idx = footnoteOrder.indexOf(id) + 1;
            return `<sup id="fnref-${escapeHtml(id)}"><a href="#fn-${escapeHtml(id)}">${idx}</a></sup>`;
        });

        if (footnoteOrder.length > 0) {
            const items = footnoteOrder.map((id) => `<li id="fn-${escapeHtml(id)}">${escapeHtml(footnotes[id])} <a href="#fnref-${escapeHtml(id)}">↩</a></li>`);
            html += `<hr/><div class="footnotes"><ol>${items.join("")}</ol></div>`;
        }

        // restore fenced code blocks: emit code blocks with data attributes so a later effect
        // can lazy-load highlight.js and replace innerHTML for highlighting (avoids blocking during render)
        html = html.replace(/__CODEBLOCK_(\d+)__/g, (_m, idx) => {
            const key = `__CODEBLOCK_${idx}__`;
            const info = codeBlocks[key];
            if (!info) return "";
            const rawCodeEscaped = info.code; // escaped
            const langAttr = info.lang ? ` data-lang="${escapeHtml(info.lang)}"` : "";
            // store raw code inside a data attribute for later JS processing (avoid double-escaping)
            const rawAttr = ` data-raw="${escapeHtml(info.raw ?? info.code)}"`;
            return `<pre><code${langAttr}${rawAttr}>${rawCodeEscaped}</code></pre>`;
        });

        // final simple sanitization: allow only our generated tags by escaping stray angle brackets (we already escaped content before)
        // return as React node with HTML
        return React.createElement("span", { dangerouslySetInnerHTML: { __html: html } });
    }

    /**
     * Return the last Message shown in the current branch defined by `sel` and `childrenMap`.
     * If there is no message in the branch, returns null.
     */
    export function getLastMessageOfBranch(sel: Record<string, number>, childrenMap: Map<string, Message[]>) {
        const branch: Message[] = [];
        let parent = 'root';
        while (true) {
            const arr = childrenMap.get(parent);
            if (!arr || arr.length === 0) break;
            const idx = sel[parent] ?? 0;
            const safeIdx = Math.max(0, Math.min(idx, arr.length - 1));
            const msg = arr[safeIdx];
            if (!msg) break;
            branch.push(msg);
            parent = msg.id;
        }
        if (branch.length === 0) return null;
        return branch[branch.length - 1];
    }