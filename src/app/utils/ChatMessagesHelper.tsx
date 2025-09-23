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
    const md = require('markdown-it')({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
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