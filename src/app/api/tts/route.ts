import { NextRequest } from 'next/server';

/**
 * POST /api/tts
 * Supports two actions via request body:
 * - { validate: true, api_key?: string } -> calls https://api.infuseting.fr/tts/validate with the api_key and returns JSON
 * - { text: string, lang?: string, api_key?: string } -> calls https://api.infuseting.fr/tts/generate and returns audio bytes (mp3)
 */
export async function POST(request: Request) {
  try {
  const body = await request.json().catch(() => ({}));
  // Use server-side API key only (do not accept api_key from client)
  const apiKey = process.env.TTS_API_KEY ?? process.env.INFUSETING_API_KEY ?? '';

    // Validate action
    if (body?.validate) {
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Server TTS API key not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      const validateUrl = 'https://api.infuseting.fr/tts/validate';
      const res = await fetch(validateUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: apiKey }) });
      const txt = await res.text().catch(() => '');
      // Try parse JSON, otherwise return raw text
      try {
        const json = JSON.parse(txt || '{}');
        return new Response(JSON.stringify(json), { status: res.ok ? 200 : 502, headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(txt, { status: res.ok ? 200 : 502, headers: { 'Content-Type': 'text/plain' } });
      }
    }

    // Generate action (default)
    const text = body?.text ?? '';
    const lang = body?.lang ?? 'fr';
    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'text is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    const generateUrl = 'https://api.infuseting.fr/tts/generate';

    // Prepare provider body
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Server TTS API key not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    const providerBody = { api_key: apiKey, text, lang };
    const res = await fetch(generateUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(providerBody) });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return new Response(JSON.stringify({ error: 'Provider error', detail: txt }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const arrayBuffer = await res.arrayBuffer();
    // The Infuseting endpoint returns an mp3 binary; set audio/mpeg
    return new Response(arrayBuffer, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
  } catch (err: any) {
    console.error('/api/tts error', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
