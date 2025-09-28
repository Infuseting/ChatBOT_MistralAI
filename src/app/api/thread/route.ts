import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureDate } from '@/app/utils/DateUTC';

/**
 * Small helper: generate a UUID string.
 *
 * Uses the platform crypto.randomUUID when available; otherwise falls back
 * to a RFC4122 v4-like pseudo-random implementation.
 */
function generateUUID(): string {
  try {
    const rnd = (globalThis as any).crypto?.randomUUID;
    if (typeof rnd === 'function') return rnd();
  } catch (e) {
    // ignore and fall back
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * GET /api/thread
 *
 * Supports several modes depending on query parameters:
 * - ?shareCode=CODE : return the shared thread (publicly accessible)
 * - ?idThread=ID   : return a specific thread when authenticated and owner
 * - no params      : return the list of threads for the authenticated user
 */
export async function GET(_req: NextRequest) {
  try {
    // 1) Support fetching a shared thread by share code: /api/thread?shareCode=CODE
    try {
      const shareCode = _req.nextUrl.searchParams.get('shareCode');
      if (shareCode) {
        const share = await prisma.share.findUnique({ where: { code: shareCode }, include: { thread: { include: { messages: true } } } });
        if (!share || !share.thread) return NextResponse.json({ error: 'Share not found' }, { status: 404 });
        const thread = share.thread;
        // Return a compact shape expected by client code
        return NextResponse.json({
          id: thread.id,
          idThread: thread.idThread ?? thread.id,
          name: thread.name,
          createdAt: thread.createdAt,
          updatedAt: thread.updatedAt,
          context: thread.context ?? null,
          model: thread.model ?? null,
          messages: thread.messages ?? [],
        });
      }
    } catch (e) {
      console.error('GET /api/thread shareCode handler error', e);
      // fallthrough to listing all threads
    }

    // 2) Support fetching a thread by external idThread with permission check: /api/thread?idThread=ID
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
          updatedAt: thread.updatedAt,
          context: thread.context ?? null,
          model: thread.model ?? null,
          messages: thread.messages ?? [],
        });
      }
    } catch (e) {
      console.error('GET /api/thread idThread handler error', e);
      // fallthrough to listing all threads
    }

    // 3) Default: list threads for the authenticated user
    const access_token = _req.headers.get('authorization')?.split(' ')[1] || _req.cookies.get('access_token')?.value;
    let rows : any[] = [];
    if (access_token) {
      try {
        const dbToken = await prisma.accessToken.findUnique({
          where: { token: access_token },
          include: { user: true },
        });
        if (dbToken?.user) {
          const threads = await prisma.thread.findMany({
            where: { userId: dbToken.user.id },
            include: { messages: true },
            orderBy: { createdAt: 'asc' },
          });
          rows = threads;
        } else {
          rows = [];
        }
      } catch (err) {
        console.error('GET /api/thread token lookup failed', err);
        rows = [];
      }
    }
    return NextResponse.json(rows);
  } catch (err) {
    console.error('GET /api/thread error', err);
    return NextResponse.json({ error: 'Failed to list threads' }, { status: 500 });
  }
}

/**
 * POST /api/thread
 *
 * Handles multiple actions specified by body.action:
 * - create: create a new thread (requires authentication). Body: { action: 'create', data: {...} }
 * - share: create or return a share code for a thread owned by the user. Body: { action: 'share', idThread }
 * - sync: bulk-insert messages (used for synchronization/import). Body: { action: 'sync', messages: [...] }
 * - update: update thread metadata (name, context, model). Body: { action: 'update', idThread, data }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // keep a debug line for request inspection during development
    console.log('POST /api/thread body:', JSON.stringify(body));
    const action = body?.action ?? 'create';

    // Reusable helper that resolves the user from Authorization header or cookie
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
          sentAt: m.date ? ensureDate(m.date) : ensureDate(undefined),
          attachmentId: m.attachmentId,
        });
      }

      if (mapped.length === 0) return NextResponse.json({ ok: true, inserted: 0 });

      const result = await prisma.message.createMany({
        data: mapped,
        skipDuplicates: true,
      });
      // Update the thread's updatedAt to the current time for the affected thread
      await prisma.thread.update({
        where: { idThread: mapped[0].idThread },
        data: { updatedAt: new Date() },
      });

      return NextResponse.json({ ok: true, inserted: result.count });
    }

    if (action === 'update') {
      const idThread = body?.idThread;
      if (!idThread || typeof idThread !== 'string') return NextResponse.json({ error: 'idThread is required' }, { status: 400 });
      const data = body?.data ?? {};
      try {
        const user = await resolveUserFromRequest(req);
        if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        const thread = await prisma.thread.findUnique({ where: { idThread: idThread } });
        if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
        if (thread.userId !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

        const allowed: any = {};
        if (typeof data.name === 'string') allowed.name = data.name;
        if (typeof data.context === 'string') allowed.context = data.context;
        if (typeof data.model === 'string') allowed.model = data.model;

        const updated = await prisma.thread.update({ where: { id: thread.id }, data: allowed, include: { messages: true } });
        return NextResponse.json({ ok: true, thread: updated });
      } catch (err) {
        console.error('POST /api/thread update failed', err);
        return NextResponse.json({ error: 'Failed to update thread' }, { status: 500 });
      }
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('POST /api/thread error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
