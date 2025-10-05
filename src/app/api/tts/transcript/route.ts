import { NextRequest } from 'next/server';

/**
 * POST /api/tts/transcript
 * Supports two actions via request body:
 * - { validate: true } -> calls https://api.infuseting.fr/tts/validate with the api_key and returns JSON
 * - { audio: dataUrl } or { url: 'https://...' } -> fetches/accepts audio and forwards to https://api.infuseting.fr/tts/transcript
 */
export async function POST(request: Request) {
  try {
    // Try parse JSON first (most clients will send JSON referencing a data URL or remote URL)
    const body = await request.json().catch(() => ({}));

    // Use server-side API key only
    const apiKey = process.env.TTS_API_KEY ?? process.env.INFUSETING_API_KEY ?? '';

    // Validate action
    if (body?.validate) {
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Server TTS API key not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      const validateUrl = 'https://api.infuseting.fr/tts/validate';
      const res = await fetch(validateUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: apiKey }) });
      const txt = await res.text().catch(() => '');
      try {
        const json = JSON.parse(txt || '{}');
        return new Response(JSON.stringify(json), { status: res.ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(txt, { status: res.ok ? 200 : 502, headers: { 'Content-Type': 'text/plain' } });
      }
    }

    // Transcript action
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Server TTS API key not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    // Determine audio source: data URL in body.audio, or remote URL in body.url
    let arrayBuffer: ArrayBuffer | null = null;
    let mime = 'application/octet-stream';

    if (body?.audio && typeof body.audio === 'string') {
      // data URL e.g. data:audio/webm;base64,AAAA
      const m = body.audio.match(/^data:(.+);base64,(.*)$/);
      if (!m) return new Response(JSON.stringify({ error: 'Invalid data URL' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      mime = m[1] || mime;
      const b64 = m[2];
      const binary = Buffer.from(b64, 'base64');
      arrayBuffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
    } else if (body?.url && typeof body.url === 'string') {
      // fetch remote URL
      const res = await fetch(body.url);
      if (!res.ok) return new Response(JSON.stringify({ error: 'Failed to fetch audio url', status: res.status }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      mime = res.headers.get('content-type') || mime;
      arrayBuffer = await res.arrayBuffer();
    } else {
      return new Response(JSON.stringify({ error: 'audio (data URL) or url required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Build FormData with api_key + file (provider expects multipart)
    const providerUrl = 'https://api.infuseting.fr/tts/transcript';
    const form = new FormData();
    form.append('api_key', apiKey);
    // Create a Blob from the arrayBuffer
    const blob = new Blob([arrayBuffer], { type: mime });
    form.append('file', blob, 'audio');

    const providerRes = await fetch(providerUrl, { method: 'POST', body: form });
    if (!providerRes.ok) {
      const txt = await providerRes.text().catch(() => '');
      return new Response(JSON.stringify({ error: 'Provider error', detail: txt }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    // Provider likely returns JSON with transcript; try parse
    const contentType = providerRes.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await providerRes.json().catch(() => null);
      return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Fallback: return text
    const txt = await providerRes.text().catch(() => '');
    return new Response(txt, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  } catch (err: any) {
    console.error('/api/tts/transcript error', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
