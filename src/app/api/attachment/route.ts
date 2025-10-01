import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

/**
 * POST /api/auth/email/login
 *
 * Request body (JSON):
 * - email: string (user email)
 * - password: string (plain-text password)
 *
 * Response:
 * - 200: { ok: true } and an httpOnly `access_token` cookie on successful login
 * - 400: { error: 'Missing email or password' } when required fields are missing
 * - 400: { error: 'Account exists with different sign-in method' } when provider mismatch
 * - 401: { error: 'Invalid credentials' } when authentication fails
 * - 500: { error: 'Server error' } on unexpected failures
 */
export async function POST(request: Request) {
    try {

        


        const body = await request.json();
        const requestType = body.requestType as string | undefined;
        if (requestType === 'md5') {
            const md5 = body.md5 as string | undefined;
            if (!md5) return NextResponse.json({ error: 'Missing md5' }, { status: 400 });
            const data = await prisma.data.findUnique({ where: { md5 } });
            if (!data) return NextResponse.json({ ok : false });
            return NextResponse.json({ ok: true });
        }
        else if (requestType === 'data_upload') {
            const md5 = body.md5 as string | undefined;
            const data = body.data as string | undefined;
            if (!md5 || !data) return NextResponse.json({ error: 'Missing md5 or data' }, { status: 400 });
            const insert = await prisma.data.upsert({
                where: { md5 },
                update: { data },
                create: { md5, data }
            });
            return NextResponse.json({ ok: true, dataId: insert.id });
        }
        else if (requestType === 'create') {
            const fileName = body.fileName as string | undefined;
            const extension = body.extension as string | undefined;
            const type = body.type as 'file' | 'image' | 'video' | 'audio' | undefined;
            const librariesId = body.librariesId as string | undefined;
            const messageId = body.messageId as string | undefined;
            const dataId = body.dataId as string | undefined;
            if (!fileName || !extension || !type || !librariesId || !messageId || !dataId) {
                return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
            }
            const insert = await prisma.attachment.create({
                data: {
                    fileName,
                    extension,
                    type,
                    librariesId,
                    messageId,
                    dataId
                }
            });
            return NextResponse.json({ ok: true, attachmentId: insert.id });

        }
        else if (requestType === 'attachment_get') {
            const messageId = body.messageId as string | undefined;
            const format = body.format as 'full' | 'metadata'
            if (!messageId) {
                return NextResponse.json({ error: 'Missing messageId' }, { status: 400 });
            }
            if (format === 'metadata') {
                const attachments = await prisma.attachment.findMany({
                    where: { messageId }
                });
                return NextResponse.json({ ok: true, attachments });
            }
            else if (format === 'full') {
                const attachments = await prisma.attachment.findMany({
                    where: { messageId },
                    include: { data: true }
                });
                return NextResponse.json({ ok: true, attachments });
            }
            return NextResponse.json({ error: 'Invalid format' }, { status: 400 });
        }
        else if (requestType === 'attachment_delete') {
            const attachmentId = body.attachmentId as string | undefined;
            if (!attachmentId) {
                return NextResponse.json({ error: 'Missing attachmentId' }, { status: 400 });
            }
            await prisma.attachment.delete({
                where: { id: attachmentId }
            });
            return NextResponse.json({ ok: true });
        }
        else if (requestType === 'update_librariesId') {
            const attachmentId = body.attachmentId as string | undefined;
            const librariesId = body.librariesId as string | undefined;
            if (!attachmentId || !librariesId) {
                return NextResponse.json({ error: 'Missing attachmentId or librariesId' }, { status: 400 });
            }
            await prisma.attachment.update({
                where: { id: attachmentId },
                data: { librariesId }
            });
            return NextResponse.json({ ok: true });
        }
        else if (requestType === 'get_librariesId') {
            const md5 = body.md5 as string | undefined;
            if (!md5) return NextResponse.json({ error: 'Missing md5' }, { status: 400 });
            const data = await prisma.data.findUnique({ where: { md5 }, include: { attachments: true } });
            if (!data) return NextResponse.json({ error: 'Data not found' }, { status: 404 });
            const librariesIds = data.attachments.map(att => att.librariesId);
            return NextResponse.json({ ok: true, librariesIds });
        }
    }
    catch (error) {
        console.log(error);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
