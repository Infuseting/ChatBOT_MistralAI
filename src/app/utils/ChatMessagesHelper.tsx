import React from "react";
import { Message } from "./Message";
import 'highlight.js/styles/atom-one-dark.css'
import hljs from 'highlight.js';

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




export function parseMarkdown(text : string ) {
    // Normalize image sources first (fix raw base64, data:octet-stream, url: prefixes)
    try {
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        text = parseImageMarkdown(text || '');
    } catch (e) {}
    const md = require('markdown-it')({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
  img: true,
  highlight: function (str: string, lang: string) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
    }
    return '';
  }
})
  .use(require('markdown-it-sub'))
  .use(require('markdown-it-sup'))
  .use(require('markdown-it-multimd-table'));




  
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
  const code = token.content;
  const langClass = token.info ? `language-${token.info.trim()}` : '';
  const highlighted = options.highlight?.(code, token.info) ?? '';
  const escapedCode = highlighted || md.utils.escapeHtml(code);
  
  const encoded = encodeURIComponent(code);
return `
    <div class="relative rounded-md bg-gray-900 text-white overflow-hidden group">
        <button class="absolute top-2 right-2 text-sm bg-gray-700 hover:bg-gray-600 text-white inline-flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition h-8 px-3 leading-none"
            data-raw="${encoded}"
            onclick="handleCopyCode(this.getAttribute('data-raw'))">
            Copy
        </button>
        <pre class="overflow-auto text-sm py-2 px-3"><code class="${langClass}">${escapedCode}</code></pre>
    </div>
`;
};

const addStyleAttr = (token: any, style: string) => {
    if (!token) return;
    const idx = token.attrIndex ? token.attrIndex('style') : -1;
    if (idx >= 0) token.attrs[idx][1] = style;
    else if (token.attrPush) token.attrPush(['style', style]);
};

const headingStyles: Record<string, string> = {
    h1: 'font-size:2em;margin:.67em 0;font-weight:700;',
    h2: 'font-size:1.5em;margin:.75em 0;font-weight:700;',
    h3: 'font-size:1.17em;margin:.83em 0;font-weight:700;',
    h4: 'font-size:1em;margin:1.12em 0;font-weight:700;',
    h5: 'font-size:.83em;margin:1.12em 0;font-weight:700;',
    h6: 'font-size:.67em;margin:1.12em 0;font-weight:700;',
    
};

md.renderer.rules.heading_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    const token = tokens[idx];
    const style = headingStyles[token.tag] ?? '';
    if (style) addStyleAttr(token, style);
    return self.renderToken(tokens, idx, options);
};

md.renderer.rules.paragraph_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    addStyleAttr(tokens[idx], 'margin:1em 0;line-height:1.5;');
    return self.renderToken(tokens, idx, options);
};

md.renderer.rules.blockquote_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    addStyleAttr(tokens[idx], 'margin:1em 0;padding-left:1em;color:inherit;border-left:4px solid rgba(0,0,0,0.1);');
    return self.renderToken(tokens, idx, options);
};

md.renderer.rules.bullet_list_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    addStyleAttr(tokens[idx], 'margin:1em 0;padding-left:40px;');
    return self.renderToken(tokens, idx, options);
};

md.renderer.rules.ordered_list_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    addStyleAttr(tokens[idx], 'margin:1em 0;padding-left:40px;');
    return self.renderToken(tokens, idx, options);
};

md.renderer.rules.table_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    addStyleAttr(tokens[idx], 'border-collapse:collapse;margin:1em 0;width:auto;');
    return self.renderToken(tokens, idx, options);
};

md.renderer.rules.th_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    addStyleAttr(tokens[idx], 'padding:6px 13px;border:1px solid #ddd;text-align:left;font-weight:700;');
    return self.renderToken(tokens, idx, options);
};

md.renderer.rules.td_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    addStyleAttr(tokens[idx], 'padding:6px 13px;border:1px solid #ddd;');
    return self.renderToken(tokens, idx, options);
};

// inline code
md.renderer.rules.code_inline = (tokens: any[], idx: number) => {
    const content = md.utils.escapeHtml(tokens[idx].content);
    return `<code style="font-family:monospace;padding:0.15em 0.3em;border-radius:4px;background:transparent;border:1px solid #eaeaea;font-size:0.95em;">${content}</code>`;
};

// pre blocks (for non-fence pre blocks)
md.renderer.rules.pre_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    addStyleAttr(tokens[idx], 'margin:1em 0;font-family:monospace;font-size:13px;');
    return self.renderToken(tokens, idx, options);
};
md.renderer.rules.link_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
    addStyleAttr(tokens[idx], 'color:#0066cc;text-decoration:underline;');
    return self.renderToken(tokens, idx, options);
};
  const render = md.render(text);
  
  return <div dangerouslySetInnerHTML={{ __html: render }} />;
}

export function parseImageMarkdown(text : string ) {
    if (!text || typeof text !== 'string') return text;

    // Helper: detect common image types by base64 signature
    const detectMimeFromBase64 = (b64: string): string | null => {
        // Look at first few bytes after base64 decoding (but avoid decoding large strings often)
        // We'll just inspect the first few characters of base64 which map to known byte signatures.
        // Common signatures (in hex):
        // JPEG: ff d8 ff -> base64 prefix: /9j/
        // PNG: 89 50 4e 47 -> base64 prefix: iVBORw0
        // GIF87a/89a: 47 49 46 38 -> base64 prefix: R0lGOD
        // WEBP: RIFF....WEBP -> base64 prefix: UklGR
        // SVG is XML text, so data won't be base64 binary signature.
        if (!b64 || b64.length < 4) return null;
        if (b64.startsWith('/9j/') || b64.startsWith('/9j')) return 'image/jpeg';
        if (b64.startsWith('iVBORw0')) return 'image/png';
        if (b64.startsWith('R0lGOD') || b64.startsWith('R0lG')) return 'image/gif';
        if (b64.startsWith('UklGR') || b64.startsWith('UklB')) return 'image/webp';
        return null;
    };

    // Normalize an image source (could be data:, url:, raw base64, or http(s) link)
    const normalizeSrc = (src: string): string => {
        if (!src) return src;
        src = src.trim();

        // Already a data URL
        if (src.startsWith('data:')) {
            // If it's application/octet-stream with base64, try to detect proper MIME
            const m = src.match(/^data:([^;]+);base64,([\s\S]*)$/);
            if (m) {
                const mime = m[1];
                const payload = m[2];
                if (mime === 'application/octet-stream') {
                    const detected = detectMimeFromBase64(payload.slice(0, 32));
                    if (detected) return `data:${detected};base64,${payload}`;
                }
            }
            return src;
        }

        // Some code used `url:...` prefix to indicate a remote link — strip it
        if (src.startsWith('url:')) {
            const u = src.slice(4).trim();
            // If the remainder looks like base64 (no slashes, mostly base64 chars) then wrap
            if (/^[A-Za-z0-9+/=\s]+$/.test(u) && u.length > 32 && !u.includes('/') ) {
                const b64 = u.replace(/\s+/g, '');
                const detected = detectMimeFromBase64(b64.slice(0, 32));
                const mime = detected ?? 'image/png';
                return `data:${mime};base64,${b64}`;
            }
            return u;
        }

        // Raw base64 (no data: prefix) — detect and wrap
        // Heuristic: contains no slashes and only base64 chars and length > 100
        const candidate = src.replace(/\s+/g, '');
        if (/^[A-Za-z0-9+/=]+$/.test(candidate) && candidate.length > 100) {
            const detected = detectMimeFromBase64(candidate.slice(0, 32));
            const mime = detected ?? 'image/png';
            return `data:${mime};base64,${candidate}`;
        }

        // Otherwise return unchanged (http(s) links are okay)
        return src;
    };

    // Replace image markdown occurrences: ![alt](src) or <img src="..."> occurrences
    // Handle markdown images first
    const imgMdRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    // We'll render Tailwind-based wrappers/buttons so we don't inject raw <style> blocks.
    const downloadSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 11l5 5 5-5M12 4v12"/></svg>`;

    const escapeHtml = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    let out = text.replace(imgMdRegex, (full, alt, src) => {
        try {
            const fixed = normalizeSrc(src);
            const altEsc = escapeHtml(alt ?? 'image');
            // Single download button styled like the share button
            const downloadBtn = `
                <div class="absolute top-2 right-2">
                    <button type="button" onclick="window.__mistral_download_image && window.__mistral_download_image(event)" class="flex bg-gray-800 p-2 text-white rounded-lg shadow-lg cursor-pointer" aria-label="Download image">
                        ${downloadSvg}
                    </button>
                </div>
            `;
            const wrapper = `<div class="mistral-image-wrapper group inline-block relative">` +
                `<img src="${fixed}" alt="${altEsc}" class="block max-w-full h-auto" />` +
                `${downloadBtn}` +
                `</div>`;
            return wrapper;
        } catch (e) {
            return full;
        }
    });

    // Also handle inline HTML <img src="..."> — normalize src attribute
    out = out.replace(/(<img[^>]*src=["'])([^"']+)(["'][^>]*>)/g, (full, a, src, b) => {
        try {
            const fixed = normalizeSrc(src);
            // Try to extract alt attribute if present
            let altMatch = full.match(/alt=["']([^"']*)["']/i);
            const alt = altMatch ? altMatch[1] : '';
            const altEsc = escapeHtml(alt);
            const downloadBtn = `
                <div class="absolute top-2 right-2">
                    <button type="button" onclick="window.__mistral_download_image && window.__mistral_download_image(event)" class="flex bg-gray-800 p-2 text-white rounded-lg shadow-lg cursor-pointer" aria-label="Download image">
                        ${downloadSvg}
                    </button>
                </div>
            `;
            const wrapper = `<div class="mistral-image-wrapper group inline-block relative">` +
                `<img src="${fixed}" alt="${altEsc}" class="block max-w-full h-auto" />` +
                `${downloadBtn}` +
                `</div>`;
            return wrapper;
        } catch (e) {
            return full;
        }
    });

            // Return HTML string; the download handler is registered in a client component (DownloadHandler) to avoid inline scripts.
            return out;
}