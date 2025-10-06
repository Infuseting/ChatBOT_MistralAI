import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureDate } from '@/app/utils/DateUTC';


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
  const share = await prisma.share.findUnique({ where: { code: shareCode }, include: { thread: { include: { messages: { include: { attachments: { include: { data: true } } } } } } } });
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

        // If `limit` or `before` query params are provided, return a paginated
        // page of messages rather than the full thread blob. This allows the
        // client to lazy-load messages on scroll.
        const limitParam = Number(_req.nextUrl.searchParams.get('limit') ?? '') || null;
        const beforeParam = _req.nextUrl.searchParams.get('before') ?? null; // ISO timestamp
        if (limitParam) {
          const limit = Math.max(1, Math.min(200, limitParam));
          const where: any = { idThread: idThread };
          if (beforeParam) where.sentAt = { lt: new Date(beforeParam) };
          const msgs = await prisma.message.findMany({ where, include: { attachments: { include: { data: true } } }, orderBy: { sentAt: 'desc' }, take: limit });
          // return messages in chronological order (oldest first)
          const mapped = msgs.reverse().map(m => ({
            idMessage: m.idMessage,
            id: m.id,
            text: m.text,
            thinking: m.thinking,
            sender: m.sender,
            timestamp: m.sentAt,
            parentId: m.parentId,
            attachments: m.attachments ?? []
          }));
          return NextResponse.json({ ok: true, messages: mapped });
        }

        const thread = await prisma.thread.findUnique({ where: { idThread: idThread }, include: { messages: { include: { attachments: { include: { data: true } } } } } });
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
    // Support pagination using `limit` and `before` (ISO timestamp). By default
    // messages are NOT included to keep the thread list lightweight. To fetch
    // messages for a given thread use the `idThread` handler with `limit`/`before`.
    const access_token = _req.headers.get('authorization')?.split(' ')[1] || _req.cookies.get('access_token')?.value;
    let rows : any[] = [];
    const limitParam = Number(_req.nextUrl.searchParams.get('limit') ?? '') || 20;
    const beforeParam = _req.nextUrl.searchParams.get('before') ?? null; // ISO timestamp
    const limit = Math.max(1, Math.min(200, limitParam));

    if (access_token) {
      try {
        const dbToken = await prisma.accessToken.findUnique({
          where: { token: access_token },
          include: { user: true },
        });
        if (dbToken?.user) {
          const where: any = { userId: dbToken.user.id };
          if (beforeParam) {
            // paginate by updatedAt: return threads updated before the provided timestamp
            where.updatedAt = { lt: new Date(beforeParam) };
          }
          const threads = await prisma.thread.findMany({
            where,
            select: { idThread: true, id: true, name: true, createdAt: true, updatedAt: true, context: true, model: true },
            orderBy: { updatedAt: 'desc' },
            take: limit,
          });
          // normalize idThread/id into id for client expectations
          rows = threads.map(t => ({ id: t.idThread ?? t.id, name: t.name, createdAt: t.createdAt, updatedAt: t.updatedAt, context: t.context, model: t.model }));
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

      // collect unique external thread ids used in the payload
      const externalThreadIds = Array.from(new Set((messages.map((m: any) => m.idThread).filter(Boolean))));
      if (externalThreadIds.length === 0) return NextResponse.json({ ok: true, inserted: 0 });

      // load server threads for those external ids
      const serverThreads = await prisma.thread.findMany({ where: { idThread: { in: externalThreadIds } } });
      const threadByExternal: Record<string, any> = {};
      for (const t of serverThreads) threadByExternal[t.idThread] = t;

      // resolve user (if any) and available shares for these threads
      const user = await resolveUserFromRequest(req);
      const threadInternalIds = serverThreads.map(t => t.id);
      const shares = threadInternalIds.length ? await prisma.share.findMany({ where: { idThread: { in: threadInternalIds } } }) : [];
      const threadsWithShare = new Set(shares.map(s => s.idThread));

      // filter allowed messages: target an existing thread and either owner or shared
      const allowedMessages = messages.filter((m: any) => {
        const ext = m.idThread;
        if (!ext) return false;
        const t = threadByExternal[ext];
        if (!t) return false;
        if (user && t.userId === user.id) return true;
        if (threadsWithShare.has(t.id)) return true;
        return false;
      });

      if (allowedMessages.length === 0) return NextResponse.json({ ok: true, inserted: 0 });

      // deduplicate by idMessage and remove existing ones
      const candidateIds = Array.from(new Set(allowedMessages.map((m: any) => m.idMessage).filter(Boolean)));
      const existing = candidateIds.length ? await prisma.message.findMany({ where: { idMessage: { in: candidateIds } }, select: { idMessage: true } }) : [];
      const existingSet = new Set(existing.map(e => e.idMessage));
      const newMessages = allowedMessages.filter((m: any) => m.idMessage && !existingSet.has(m.idMessage));
      if (newMessages.length === 0) return NextResponse.json({ ok: true, inserted: 0 });

      // prepare bulk message create payload
      const createManyPayload = newMessages.map((m: any) => {
        const t = threadByExternal[m.idThread];
        return {
          idMessage: m.idMessage,
          idThread: t.idThread,
          sender: m.sender ?? m.role ?? 'user',
          text: m.text ?? m.content ?? '',
          thinking: m.thinking ?? '',
          parentId: m.parentId ?? undefined,
          sentAt: m.date ? ensureDate(m.date) : new Date()
        };
      });

      // bulk insert messages
      if (createManyPayload.length > 0) {
        await prisma.message.createMany({ data: createManyPayload, skipDuplicates: true });
      }

      const insertedIds = newMessages.map((m: any) => m.idMessage).filter(Boolean);

      // fetch DB id for created messages
      const createdMessages = insertedIds.length ? await prisma.message.findMany({ where: { idMessage: { in: insertedIds } }, select: { idMessage: true, id: true } }) : [];
      const dbIdByExternal: Record<string, string> = {};
      for (const cm of createdMessages) dbIdByExternal[cm.idMessage] = cm.id;

      // batch Data upsert/create
      const dataMap: Record<string, string> = {};
      for (const m of newMessages) {
        const atts = Array.isArray(m.attachments) ? m.attachments : (m.attachments ? [m.attachments] : []);
        for (const a of atts) {
          const sha = a?.data?.sha256 ?? a?.sha256 ?? null;
          const dataVal = a?.data?.data ?? '';
          if (sha && !dataMap[sha]) dataMap[sha] = dataVal;
        }
      }
      const dataCreate = Object.keys(dataMap).map(s => ({ sha256: s, data: dataMap[s] }));
      if (dataCreate.length > 0) {
        await (prisma as any).data.createMany({ data: dataCreate, skipDuplicates: true });
      }

      // batch attachments create
      const attachmentsCreate: any[] = [];
      for (const m of newMessages) {
        const dbId = dbIdByExternal[m.idMessage];
        if (!dbId) continue;
        const atts = Array.isArray(m.attachments) ? m.attachments : (m.attachments ? [m.attachments] : []);
        for (const a of atts) {
          const sha = a?.data?.sha256 ?? a?.sha256 ?? '';
          attachmentsCreate.push({
            fileName: a?.fileName ?? a?.name ?? '',
            extension: a?.fileType ?? a?.extension ?? '',
            type: a?.type ?? 'file',
            libraryId: a?.libraryId ?? '',
            messageId: dbId,
            sha256: sha ?? ''
          });
        }
      }
      if (attachmentsCreate.length > 0) {
        await (prisma as any).attachment.createMany({ data: attachmentsCreate, skipDuplicates: true });
      }

      // update threads updatedAt
      try {
        const affectedThreadInternalIds = Array.from(new Set(newMessages.map((m: any) => (threadByExternal[m.idThread]?.id)).filter(Boolean)));
        if (affectedThreadInternalIds.length > 0) {
          await prisma.thread.updateMany({ where: { id: { in: affectedThreadInternalIds } }, data: { updatedAt: new Date() } });
        }
      } catch (e) {}

      return NextResponse.json({ ok: true, inserted: insertedIds.length, insertedIds });
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
