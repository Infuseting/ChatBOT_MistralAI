import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureDate } from '@/app/utils/DateUTC';

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
      // ensure we map idThread -> threadId and date -> sentAt
      try {
        const distinctIdThreads = Array.from(new Set(messages.map((m: any) => m.idThread).filter(Boolean)));
        const threads = await prisma.thread.findMany({ where: { idThread: { in: distinctIdThreads } }, select: { idThread: true, id: true } });
        const mapIdThreadToId: Record<string, string> = {};
        for (const t of threads) mapIdThreadToId[t.idThread] = t.id;

        const mapped: any[] = [];
        const externalParents: (string | null)[] = [];
        for (const m of messages) {
          const threadInternalId = mapIdThreadToId[m.idThread];
          if (!threadInternalId) {
            console.warn('Skipping message for unknown thread idThread=', m.idThread);
            continue;
          }
          console.log(m);
          const externalParent = m.parentId ?? null;
          externalParents.push(typeof externalParent === 'string' ? externalParent : null);
            mapped.push({
            idMessage: m.idMessage ?? m.id ?? undefined,
            idThread: threadInternalId,
            sender: m.sender ?? m.role ?? 'user',
            text: m.text ?? m.content ?? '',
            thinking: m.thinking ?? '',
              parentId: externalParent,
              sentAt: m.date ? ensureDate(m.date) : ensureDate(undefined)
          });
        }

       
        if (mapped.length === 0) return NextResponse.json({ ok: true, inserted: 0 });
        console.log('Syncing messages, mapped count=', mapped.length);
        try {
          // Debug: check which idMessage values already exist in DB
          try {
            const incomingIds = mapped.map(m => m.idMessage).filter(Boolean);
            if (incomingIds.length > 0) {
              const existing = await prisma.message.findMany({ where: { idMessage: { in: incomingIds } }, select: { idMessage: true, id: true, idThread: true } });
              console.log('Existing messages with same idMessage:', existing);
              if (process.env.NODE_ENV !== 'production') {
                // attach debug info to response when not in production
                const result = await prisma.message.createMany({ data: mapped, skipDuplicates: true });
                const inserted = (result && typeof (result as any).count === 'number') ? (result as any).count : undefined;
                console.log('prisma.message.createMany result', result);
                return NextResponse.json({ ok: true, inserted, existing, mappedCount: mapped.length });
              }
            }
          } catch (dbgErr) {
            console.error('debug check for existing messages failed', dbgErr);
          }

          const result = await prisma.message.createMany({ data: mapped, skipDuplicates: true });
          const inserted = (result && typeof (result as any).count === 'number') ? (result as any).count : 0;
          console.log('prisma.message.createMany result', result);

          // If createMany inserted 0 rows, fall back to per-row insertion to surface errors
          if (!inserted) {
            const perRowErrors: any[] = [];
            let success = 0;
            for (const row of mapped) {
              try {
                await prisma.message.create({ data: row });
                success++;
              } catch (e: any) {
                perRowErrors.push({ row, error: (e && e.message) ? e.message : String(e) });
                console.error('prisma.message.create failed for row', row, e);
              }
            }
            if (process.env.NODE_ENV !== 'production') {
              return NextResponse.json({ ok: true, inserted: success, perRowErrors, mappedCount: mapped.length });
            }
            return NextResponse.json({ ok: true, inserted: success });
          }

          return NextResponse.json({ ok: true, inserted });
        } catch (err) {
          console.error('prisma.message.createMany failed', err && (err as any).stack ? (err as any).stack : err);
          // fallback to individual inserts
          let success = 0;
          for (const row of mapped) {
            try { await prisma.message.create({ data: row }); success++; } catch (e) { console.error('prisma.message.create failed for row', row, e); }
          }
          return NextResponse.json({ ok: true, inserted: success });
        }
      } catch (err) {
        console.error('POST /api/thread sync handler error', err);
        return NextResponse.json({ error: 'sync failed' }, { status: 500 });
      }
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('POST /api/thread error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
