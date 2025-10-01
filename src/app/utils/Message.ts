
// Message shape used throughout the application to represent a chat message.
// Fields:
// - id: unique identifier of the message
// - text: the visible content of the message
// - thinking: optional assistant internal content / tool output log
// - sender: either 'user' or 'assistant'
// - timestamp: Date when message was created/sent
// - parentId: id of the parent message (conversation thread linking)
// - status: 'sync' when persisted remotely, 'local' when local-only

import { Mistral } from "@mistralai/mistralai"
import { getApiKey } from "./ApiKey"
import { utcNow, utcNowPlus } from "./DateUTC"
import { createServerThread, getHistory, getLastMessage, readThreadCache, setThreadCache, syncServerThread, Thread, updateActualThread, updateAllThreadsList, updateThreadCache } from "./Thread"
import { arrayBufferToBase64, computeMD5, generateUUID, toBase64 } from "./crypt"
import { runAgent, extractThinkingAndText } from "./Agent"

// - attachmentId: optional id pointing to uploaded attachments or libraries
type Data = {
    md5: string,
    data: string
}

type Attachment = {
    fileName: string,
    extension: string,
    type: 'file' | 'image' | 'video' | 'audio',
    librariesId: string,
    data?: Data
    status?: 'sync' | 'local' | undefined
}

type Message = {
    id: string,
    text: string,
    thinking: string,
    sender: 'user' | 'assistant',
    timestamp: Date,
    parentId: string,
    status: 'sync' | 'local' | undefined,
    attachments?: Attachment[]
}






export async function handleMessageSend(thread: Thread, content: string, selectedFiles: File[] = [], imageGeneration : boolean = false) {
    const lastMessage = getLastMessage(thread);
    const history = getHistory(thread, lastMessage);
    const attachments = await generateAttachmentsFromFiles(selectedFiles);
    const userMessage: Message = {
        id: generateUUID() ?? '',
        text: content,
        thinking : "",
        sender: 'user',
    timestamp: utcNow(),
        parentId: lastMessage?.id ?? 'root',
        status: 'local'
        ,
        attachments: attachments
    };
    const newMessage: Message = {
        id: generateUUID(),
        text: '...',
        thinking : '',
        sender: 'assistant',
    timestamp: utcNowPlus(1000),
        parentId: userMessage?.id ?? 'root',
        status: 'local',
        attachments: []
    }
    thread.messages = [...(thread.messages ?? []), userMessage, newMessage];
    updateThreadCache(thread);
    console.log(thread);

    const messagesList = [
            
            ...history,
            {
                role: "user",
                content: content
            }
        ];

    
    const { chatResponse, attachmentId } = await runAgent(thread, userMessage, selectedFiles, messagesList, imageGeneration);
    console.log(chatResponse);
    if (!chatResponse || !chatResponse.outputs || chatResponse.outputs.length === 0) {
        newMessage.text = "Error: no response";
        newMessage.thinking = "";
        return;
    }
    const { thinking, texts, web_references, images } = extractThinkingAndText(chatResponse);
    
    console.log('Thinking:', thinking, 'Texts:', texts);
    console.log(images);       
    newMessage.text = texts.join('\n');
    newMessage.thinking = thinking.join('\n');
    updateActualThread();
    updateThreadCache(thread);
    
    if ((thread.status as any) !== 'remote') {
        await createServerThread(thread);
    }
    await syncServerThread(thread);
    thread.date = utcNow();
    updateAllThreadsList(thread);
    const url = `/${thread.id}`;
    if (typeof window !== 'undefined' && window.history && window.history.pushState) {
        window.history.pushState({}, '', url);
    } 
}

export async function handleRegenerateMessage(thread : Thread, message: Message, model : string) {
    if (message.sender !== 'assistant') return;
    if (!thread || !message) return;
    const msgs = thread.messages ?? [];
    const parentId = message.parentId ?? null;
    const userMessage : Message | null = msgs.find(m => m.id === parentId && m.sender === 'user') ?? null;
    if (!userMessage) return;
    if (!parentId) return;

    const history = getHistory(thread, msgs.find(m => m.id === parentId) ?? null);
    const newMessage: Message = {
        id: generateUUID(),
        text: 'Regenerate Message',
        thinking : '',
        sender: 'assistant',
        timestamp: utcNowPlus(1000),
        parentId: parentId,
        status: 'local',
        attachments: []
    }
    thread.messages = [...msgs, newMessage];
    updateActualThread();
    updateThreadCache(thread);
    const client = new Mistral({apiKey: getApiKey()});
    const messagesList = [
            
            ...history,
        ];
    const { chatResponse, attachmentId } = await runAgent(thread, userMessage, [], messagesList);
    console.log(chatResponse);
    if (!chatResponse || !chatResponse.outputs || chatResponse.outputs.length === 0) {
        newMessage.text = "Error: no response";
        newMessage.thinking = "";
        return;
    }
    const { thinking, texts } = extractThinkingAndText(chatResponse);
    newMessage.text = texts.join('\n');
    newMessage.thinking = thinking.join('\n');
    updateActualThread();
    updateThreadCache(thread);
    if ((thread.status as any) !== 'remote') {
        await createServerThread(thread);
    }
    await syncServerThread(thread);
    thread.date = utcNow();
    updateAllThreadsList(thread);
    const url = `/${thread.id}`;
    if (typeof window !== 'undefined' && window.history && window.history.pushState) {
        window.history.pushState({}, '', url);
    }
    return newMessage;    
}

export async function handleEditMessage(thread : Thread, message: Message, editMessage : string) {
    if (message.sender !== 'user') return;
    if (!thread || !message) return;
    const msgs = thread.messages ?? [];
    const parentId = message.parentId ?? null;
    const attachments = message.attachments ?? [];
    if (!parentId) return;
    const history = getHistory(thread, msgs.find(m => m.id === parentId) ?? null);
    const newUserMessage: Message = {
        id: generateUUID(),
        text: editMessage,
        thinking : '',
        sender: 'user',
        timestamp: utcNowPlus(1000),
        parentId: parentId,
        status: 'local',
        attachments: attachments
    }
    
    const newMessage: Message = {
        id: generateUUID(),
        text: '...',
        thinking : '',
        sender: 'assistant',
        timestamp: utcNowPlus(2000),
        parentId: newUserMessage.id,
        status: 'local',
        attachments : []
    }
    thread.messages = [...msgs, newUserMessage, newMessage];
    updateActualThread();
    updateThreadCache(thread);
    const client = new Mistral({apiKey: getApiKey()});
    const messagesList = [
            
            ...history,
            {
                role: "user",
                content: editMessage
            },
            
        
        ];
    const { chatResponse, attachmentId } = await runAgent(thread, newUserMessage, [], messagesList);
    console.log(chatResponse);
    if (!chatResponse || !chatResponse.outputs || chatResponse.outputs.length === 0) {
        newMessage.text = "Error: no response";
        newMessage.thinking = "";
        return;
    }
    const { thinking, texts } = extractThinkingAndText(chatResponse);
    newMessage.text = texts.join('\n');
    newMessage.thinking = thinking.join('\n');

    updateActualThread();
    updateThreadCache(thread);
    if ((thread.status as any) !== 'remote') {
        await createServerThread(thread);
    }
    await syncServerThread(thread);
    thread.date = utcNow();
    updateAllThreadsList(thread);
    const url = `/${thread.id}`;
    if (typeof window !== 'undefined' && window.history && window.history.pushState) {
        window.history.pushState({}, '', url);
    }

}

export async function generateDataFromFile(file: File) {
    const text = await file.text()
    const md5 = await computeMD5(text);
    const data = await toBase64(text);
    return { md5, data: data };
}
export async function generateAttachmentsFromFiles(files: File[]) : Promise<Attachment[]> {
    if (files.length === 0) return [];
    const attachments: Attachment[] = [];
    for (const file of files) {
        const fileName = file.name.split('.').slice(0, -1).join('.') || file.name;
        const fileType = file.name.split('.').pop() ?? '';
        const type = 'file';
        const librariesId = '';
        const Data : Data = await generateDataFromFile(file);
        attachments.push({ fileName, extension: fileType, type, librariesId, data: Data, status: 'local' });
    }

    return attachments;
}



export type { Message, Attachment, Data };
