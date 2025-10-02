"use client";
import { useEffect } from 'react';

export default function DownloadHandler() {
  useEffect(() => {
    if ((window as any).__mistral_download_image) return;
    (window as any).__mistral_download_image = async function (e: any) {
      try {
        const btn = e.currentTarget || e.target;
        if (!btn) return;
        let node: any = btn;
        while (node && !node.classList?.contains('mistral-image-wrapper')) node = node.parentNode;
        if (!node) return;
        const img: HTMLImageElement | null = node.querySelector('img');
        if (!img) return;
        const src = img.getAttribute('src') || '';
        const alt = (img.getAttribute('alt') || 'image').replace(/[^a-z0-9\-_.]/gi, '_');
        const filename = src && src.indexOf('data:') === 0 ? `${alt}.png` : alt;

        async function saveBlob(blob: Blob, suggestedName?: string) {
          // Try File System Access API
          // @ts-ignore
          if (window.showSaveFilePicker) {
            try {
              // @ts-ignore
              const handle = await window.showSaveFilePicker({ suggestedName });
              const writable = await handle.createWritable();
              await writable.write(blob);
              await writable.close();
              return true;
            } catch (err) {
              console.error('Save file picker failed', err);
            }
          }
          // Fallback anchor download
          try {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = suggestedName || 'download';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            return true;
          } catch (err) {
            console.error('Anchor download failed', err);
          }
          return false;
        }

        if (!src) return;
        if (src.startsWith('data:')) {
          const parts = src.split(',');
          const m = parts[0].match(/data:([^;]+);base64/);
          const contentType = m ? m[1] : 'application/octet-stream';
          const b64 = parts[1] || '';
          const bin = atob(b64);
          const len = bin.length;
          const arr = new Uint8Array(len);
          for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
          const blob = new Blob([arr], { type: contentType });
          await saveBlob(blob, filename);
          return;
        }
        try {
          const resp = await fetch(src);
          if (!resp.ok) throw new Error('Fetch failed');
          const blob = await resp.blob();
          await saveBlob(blob, filename || 'download');
        } catch (err) {
          console.error('Download failed', err);
          try { alert('Download failed'); } catch (e) {}
        }
      } catch (err) {
        console.error('download handler error', err);
      }
    };
  }, []);

  return null;
}
