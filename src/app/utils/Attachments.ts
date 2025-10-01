import { Mistral } from "@mistralai/mistralai"
import { Message } from "./Message"
import { Thread } from "./Thread"
import { getApiKey } from "./ApiKey"

export type Attachment = {
    fileName : string,
    fileType : string,
    type: 'file' | 'image' | 'video' | 'audio',
    libraryId?: string,
    status: 'sync' | 'local' | undefined,
    data : Data
}

export type Data = {
    sha256 : string,
    data: string
}

export async function generateAttachmentFromFiles(files: File[]) : Promise<Attachment[]> {
    const attachments: Attachment[] = [];

    const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000; // 32KB chunks to avoid call stack issues
        let binary = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            let chunkStr = '';
            for (let j = 0; j < chunk.length; j++) {
                chunkStr += String.fromCharCode(chunk[j]);
            }
            binary += chunkStr;
        }
        return btoa(binary);
    };

    for (const file of files) {
        const arrayBuffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
        const sha256 = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        const base64Data = arrayBufferToBase64(arrayBuffer);
        const extension = file.name.split('.').pop() || '';
        const fileType = file.type || `application/${extension}`;
        let type: 'file' | 'image' | 'video' | 'audio' = 'file';
        if (file.type.startsWith('image/')) type = 'image';
        else if (file.type.startsWith('video/')) type = 'video';
        else if (file.type.startsWith('audio/')) type = 'audio';
        attachments.push({
            fileName: file.name,
            fileType,
            type,
            status: 'local',
            data: {
                sha256,
                data: `data:${fileType};base64,${base64Data}`
            }
        });
    }
    return attachments;
}


export async function getLibrariesId(userMessage : Message) : Promise<string[]> {
    const client = new Mistral({apiKey: getApiKey()});
    const librariesId: string[] = [];
    for (const att of userMessage.attachments || []) {
        console.log("-------------------------------------------------------");
        if (att.libraryId) {
            console.log('Attachment already has libraryId, verifying existence:', att.fileName, att.libraryId);
            const lib = await client.beta.libraries.get({ libraryId: att.libraryId });

            if (lib && lib.id && !librariesId.includes(lib.id)) { console.log('Library found for attachment:', att.fileName, lib.id); librariesId.push(lib.id) }
            else {
                console.log('LibraryId not found, creating new library for attachment:', att.fileName);
                const lib = await client.beta.libraries.create({
                    name: `File ${att.fileName}`,
                    description: `${att.data.sha256}`,
                });
                if (lib && lib.id) {
                    librariesId.push(lib.id);
                    att.libraryId = lib.id;
                }
                try {
                    const file = await getFileFromBase64(att);
                    await client.beta.libraries.documents.upload({
                        libraryId: lib.id,
                        requestBody: {
                            file: file,
                        }
                        
                    });
                } catch (e) {
                    console.error('Error uploading document to library:', e);
                }
            }
        } else {
            console.log('Uploading new attachment to library:', att.fileName);
            const libs = await client.beta.libraries.list();
            let lib = libs.data.find(l => l.description === att.data.sha256);
            if (!lib) {
                console.log('No existing library found for this attachment, creating new one.');
                lib = await client.beta.libraries.create({
                    name: `File ${att.fileName}`,
                    description: `${att.data.sha256}`,
                });
                if (lib && lib.id) {
                    librariesId.push(lib.id);
                    att.libraryId = lib.id;
                }
                try {
                    const file = await getFileFromBase64(att);
                    await client.beta.libraries.documents.upload({
                        libraryId: lib.id,
                        requestBody: {
                            file: file,
                        }
                        
                    });
                } catch (e) {
                    console.error('Error uploading document to library:', e);
                }
                
            }
            else {
                console.log('Library already exists for this attachment:', lib.id);
                if (lib && lib.id && !librariesId.includes(lib.id)) librariesId.push(lib.id);
                att.libraryId = lib.id;
            }
        }

    }
    return librariesId;
}

export async function getFileFromBase64(attachments: Attachment ) {
    const file = new File(
        [Uint8Array.from(atob(attachments.data.data.split(',')[1]), c => c.charCodeAt(0))],
        attachments.fileName,
        { type: attachments.fileType }
    );
    return file;
}