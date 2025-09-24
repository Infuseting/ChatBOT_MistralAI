import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureDate } from '@/app/utils/DateUTC';
import { threadId } from 'worker_threads';

function generateUUID(): string {
  // Prefer the platform crypto.randomUUID if available, otherwise fallback to a UUIDv4 polyfill.
  try {
    const rnd = (globalThis as any).crypto?.randomUUID;
    if (typeof rnd === 'function') return rnd();
  } catch (_) {
    // ignore and fallback
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function GET(_req: NextRequest) {
  try {
    // Support fetching a shared thread by share code: /api/thread?shareCode=CODE
    try {
      const shareCode = _req.nextUrl.searchParams.get('shareCode');
      if (shareCode) {
        const share = await prisma.share.findUnique({ where: { code: shareCode }, include: { thread: { include: { messages: true } } } });
        if (!share || !share.thread) return NextResponse.json({ error: 'Share not found' }, { status: 404 });
        const thread = share.thread;
        // return thread in a compact shape similar to the client-side expectations
        return NextResponse.json({
          id: thread.id,
          idThread: thread.idThread ?? thread.id,
          name: thread.name,
          createdAt: thread.createdAt,
          context: thread.context ?? null,
          model: thread.model ?? null,
          messages: thread.messages ?? [],
        });
      }
    } catch (e) {
      console.error('GET /api/thread shareCode handler error', e);
      // fallthrough to listing all threads
    }

    // Support fetching a thread by external idThread with permission check: /api/thread?idThread=ID
    try {
      const idThread = _req.nextUrl.searchParams.get('idThread');
      if (idThread) {
        // resolve user from request (Authorization header or access_token cookie)
        async function resolveUserFromRequest(req: NextRequest) {
          try {
            const authHeader = req.headers.get('authorization') ?? '';
            let token: string | null = null;
            if (authHeader.toLowerCase().startsWith('bearer ')) token = authHeader.slice(7).trim();
            if (!token) {
              const cookie = req.headers.get('cookie') ?? '';
              const match = cookie.match(/(?:^|; )access_token=([^;]+)/);
              if (match) token = decodeURIComponent(match[1]);
            }
            if (!token) return null;
            const dbToken = await prisma.accessToken.findUnique({ where: { token }, include: { user: true } });
            if (!dbToken || !dbToken.user) return null;
            if (dbToken.expiresAt && dbToken.expiresAt.getTime() < Date.now()) return null;
            return dbToken.user;
          } catch (err) {
            console.error('resolveUserFromRequest error', err);
            return null;
          }
        }

        const user = await resolveUserFromRequest(_req);
        if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

        const thread = await prisma.thread.findUnique({ where: { idThread: idThread }, include: { messages: true } });
        if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
        if (thread.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

        return NextResponse.json({
          id: thread.id,
          idThread: thread.idThread ?? thread.id,
          name: thread.name,
          createdAt: thread.createdAt,
          context: thread.context ?? null,
          model: thread.model ?? null,
          messages: thread.messages ?? [],
        });
      }
    } catch (e) {
      console.error('GET /api/thread idThread handler error', e);
      // fallthrough to listing all threads
    }

    const rows = await prisma.thread.findMany({ include: { messages: true }, orderBy: { createdAt: 'asc' } });
    return NextResponse.json(rows);
  } catch (err) {
    console.error('GET /api/thread error', err);
    return NextResponse.json({ error: 'Failed to list threads' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log('POST /api/thread body:', JSON.stringify(body));
    const action = body?.action ?? 'create';

    // helper: resolve user from Authorization header or cookie (access_token)
    async function resolveUserFromRequest(req: NextRequest) {
      try {
        const authHeader = req.headers.get('authorization') ?? '';
        let token: string | null = null;
        if (authHeader.toLowerCase().startsWith('bearer ')) token = authHeader.slice(7).trim();
        if (!token) {
          const cookie = req.headers.get('cookie') ?? '';
          const match = cookie.match(/(?:^|; )access_token=([^;]+)/);
          if (match) token = decodeURIComponent(match[1]);
        }
        if (!token) return null;
        const dbToken = await prisma.accessToken.findUnique({ where: { token }, include: { user: true } });
        if (!dbToken || !dbToken.user) return null;
        if (dbToken.expiresAt && dbToken.expiresAt.getTime() < Date.now()) return null;
        return dbToken.user;
      } catch (err) {
        console.error('resolveUserFromRequest error', err);
        return null;
      }
    }

    if (action === 'create') {
      const data = body?.data ?? {};
      const user = await resolveUserFromRequest(req);
      if (!user) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }
      // ensure we set userId for the required relation
      const payload = { ...data, userId: user.id };
        try {
        const created = await prisma.thread.create({ data: payload, include: { messages: true } });
        return NextResponse.json(created, { status: 201 });
      } catch (err) {
        console.error('prisma.thread.create failed', err && (err as any).stack ? (err as any).stack : err);
        const message = (err && (err as any).message) ? (err as any).message : 'prisma create failed';
        if (process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Failed to create thread' }, { status: 500 });
        return NextResponse.json({ error: message, stack: (err && (err as any).stack) ? (err as any).stack : undefined }, { status: 500 });
      }
    }
    if (action === 'share') {
      const idThread = body?.idThread;
      if (!idThread || typeof idThread !== 'string') {
        return NextResponse.json({ error: 'idThread is required' }, { status: 400 });
      }

      try {
        const user = await resolveUserFromRequest(req);
        if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

        // find thread by external idThread
        const thread = await prisma.thread.findUnique({ where: { idThread: idThread } });
        if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
        if (thread.userId !== user.id) {
          return NextResponse.json({ error: 'Forbidden: no permission to share this thread' }, { status: 403 });
        }
        const existingShare = await prisma.share.findFirst({
          where: { idThread: thread.id, userId: user.id },
        });
        if (existingShare) {
          return NextResponse.json({ ok: true, share: existingShare }, { status: 200 });
        }
        const code = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
        const share = await prisma.share.create({
          data: {
            code,
            thread: { connect: { id: thread.id } },
            user: { connect: { id: user.id } },
          },
        });
        return NextResponse.json({ ok: true, share }, { status: 201 });
      } catch (err) {
        console.error('Share creation failed', err);
        return NextResponse.json({ error: 'Failed to create share' }, { status: 500 });
      }
    }
    if (action === 'sync') {
      const messages = body?.messages ?? [];
      if (!Array.isArray(messages)) return NextResponse.json({ error: 'Invalid messages' }, { status: 400 });
      
        const mapped: any[] = [];
        for (const m of messages) {
          mapped.push({
            id: generateUUID(),
            idMessage: m.idMessage ?? undefined,
            idThread: m.idThread ?? undefined,
            sender: m.sender ?? m.role ?? 'user',
            text: m.text ?? m.content ?? '',
            thinking: m.thinking ?? '',
            parentId: m.parentId,
            sentAt: m.date ? ensureDate(m.date) : ensureDate(undefined)
          });
        }
        const threads = await prisma.thread.findMany();

       
        if (mapped.length === 0) return NextResponse.json({ ok: true, inserted: 0 });

        const result = await prisma.message.createMany({
          data: mapped,
          skipDuplicates: true,
        });

        return NextResponse.json({ ok: true, inserted: result.count });
      
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('POST /api/thread error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
