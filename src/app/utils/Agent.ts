import { Mistral } from "@mistralai/mistralai";
import { Thread } from "./Thread";
import { Message } from "./Message";
import { getApiKey } from "./ApiKey";
import { getContext } from "./Context";
import { utcNow, utcNowPlus } from "./DateUTC";
import { startActiveRequest, activeRequests } from "./DynamicMessage";
import { getLastMessage, getHistory, cleanupCancelledMessages } from "./Message";
import { getActualModel } from "./Models";
import { setActualThread, updateAllThreadsList, updateActualThread } from "./Thread";
import { updateThreadCache } from "./ThreadCache";
import { createServerThread, syncServerThread } from "./Thread";
import { generateUUID } from "./crypto";
function extractThinkingAndText(response: any) {
  const thinking: string[] = [];
  const texts: string[] = [];
  const web_references: Array<Record<string, any>> = [];

  if (!response || !Array.isArray(response.outputs)) {
    return { thinking, texts, web_references };
  }

  for (const output of response.outputs) {
    if (!output || !output.type) continue;
    if (output.type === "tool.execution" || output.type === "tool_exec" || output.type === "tool.execution.result") {
      const toolName = output.name ?? output.tool ?? 'tool';
      let argsStr = '';
      if (typeof output.arguments === 'string') {
        try {
          argsStr = JSON.stringify(JSON.parse(output.arguments));
        } catch {
          argsStr = output.arguments;
        }
      } else if (typeof output.arguments === 'object' && output.arguments !== null) {
        try {
          argsStr = JSON.stringify(output.arguments);
        } catch {
          argsStr = String(output.arguments);
        }
      } else {
        argsStr = String(output.arguments ?? '');
      }
      thinking.push(`Tool: ${toolName} → ${argsStr}`);
    }

    if (output.type === "message.output") {
      const content = output.content;
      if (typeof content === "string") {
        texts.push(content);
      } else if (Array.isArray(content)) {
        for (const item of content) {
          if (!item) continue;
          // plain text pieces
          if (item.type === "text" && typeof item.text === "string") {
            texts.push(item.text);
            continue;
          }
          if (typeof item === "string") {
            texts.push(item);
            continue;
          }
          if (item.type === "tool_reference" || item.type === "web_reference" || item.type === "tool.reference") {
            web_references.push({
              tool: item.tool ?? item.name ?? null,
              url: item.url ?? null,
              title: item.title ?? null,
              description: item.description ?? null,
              favicon: item.favicon ?? null,
              raw: item
            });
            continue;
          }
          if (typeof item.text === "string") {
            texts.push(item.text);
            continue;
          }
          if (typeof item.content === "string") {
            texts.push(item.content);
            continue;
          }
          if (Array.isArray(item.content)) {
            for (const sub of item.content) {
              if (sub && typeof sub === "object" && typeof sub.text === "string") texts.push(sub.text);
              else if (typeof sub === "string") texts.push(sub);
            }
          }
        }
      } else if (typeof content === "object" && content !== null) {
        if (typeof content.text === "string") texts.push(content.text);
        else if (typeof content.content === "string") texts.push(content.content);
        else if (Array.isArray(content.content)) {
          for (const item of content.content) {
            if (item && typeof item.text === "string") texts.push(item.text);
            else if (typeof item === "string") texts.push(item);
          }
        }
      }
    }
  }

  return { thinking, texts, web_references };
}
async function createAgent() {
    const client = new Mistral({apiKey: getApiKey()});
    await client.beta.agents.create({
        model: getActualModel(),
        name: "MistralAI Chat BOT Chat Agent",
        instructions: "Use the tools to answer the user's questions.",
        description: "Agent able to do anything.",
    });
}

async function existAgent() {
    const client = new Mistral({apiKey: getApiKey()});
    const agents = await client.beta.agents.list();
    return agents.some(a => a.name === "MistralAI Chat BOT Chat Agent");
}
async function getAgent() {
    const client = new Mistral({apiKey: getApiKey()});
    const agents = await client.beta.agents.list();
    return agents.find(a => a.name === "MistralAI Chat BOT Chat Agent");
}

async function createDocsLibrary(thread: Thread, userMessage: Message, files: File[]) {
    if (files.length === 0) return null;
    const client = new Mistral({apiKey: getApiKey()});
    const library =  await client.beta.libraries.create({
        name: `Library for thread ${userMessage.id}`,
        description: `Auto-created library for thread ${userMessage.id}`,
    });
    if (!library || !library.id) return null;

    const uploadedDocs: any[] = [];
    for (const file of files) {
        try {
            const uploadedDoc = await client.beta.libraries.documents.upload({
                libraryId: library.id,
                requestBody: { file: file as any },
            });
            if (uploadedDoc) uploadedDocs.push(uploadedDoc);
            try {
                console.log('uploaded doc', JSON.stringify(uploadedDoc, null, 2));
            } catch (e) {
                console.log('uploaded doc (raw)', uploadedDoc);
            }
        } catch (err) {
            console.error('Failed uploading document to library', err, file.name);
        }
    }

    // helper: poll document status using the dedicated status endpoint.
    // Treat common in-progress values as needing wait, and final states as done.
    const waitForProcessing = async (docId: string, timeoutMs = 180000, intervalMs = 2000) => {
        const start = Date.now();
        // status values we've seen: 'Running', 'Queued', 'Processing', 'Completed', 'Failed', 'Error'
        const inProgress = new Set(['running', 'queued', 'processing']);
        const success = new Set(['completed', 'done', 'succeeded']);
        const failed = new Set(['failed', 'error', 'errored']);

        while (Date.now() - start < timeoutMs) {
            try {
                // use the status endpoint which returns a ProcessingStatusOut
                const statusRes = await client.beta.libraries.documents.status({ libraryId: library.id, documentId: docId });
                console.log('Document status response', { documentId: docId, statusRes });
                const statusRaw = (statusRes as any)?.processingStatus ?? (statusRes as any)?.status ?? null;
                const status = statusRaw ? String(statusRaw).toLowerCase() : null;

                if (!status) {
                    // if we can't parse a status, try fetching full metadata as a fallback
                    try {
                        const info = await client.beta.libraries.documents.get({ libraryId: library.id, documentId: docId });
                        console.log('Document metadata fallback', info);
                        const fallbackStatus = (info as any)?.processingStatus ?? (info as any)?.processing?.status ?? null;
                        const fb = fallbackStatus ? String(fallbackStatus).toLowerCase() : null;
                        if (fb && !inProgress.has(fb)) return info;
                    } catch (e) {
                        // ignore and continue
                    }
                } else {
                    if (success.has(status)) {
                        // finished successfully
                        try {
                            const info = await client.beta.libraries.documents.get({ libraryId: library.id, documentId: docId });
                            return info;
                        } catch (e) {
                            return statusRes;
                        }
                    }
                    if (failed.has(status)) {
                        console.warn('Document processing failed', { documentId: docId, status });
                        return statusRes;
                    }
                    // if status is inProgress, wait and retry
                    if (!inProgress.has(status)) {
                        // unknown but not explicitly in-progress; treat as done
                        try {
                            const info = await client.beta.libraries.documents.get({ libraryId: library.id, documentId: docId });
                            return info;
                        } catch (e) {
                            return statusRes;
                        }
                    }
                }
            } catch (e) {
                console.warn('Error while polling document status, will retry', e);
            }
            await new Promise(r => setTimeout(r, intervalMs));
        }
        console.warn('Timeout while waiting for document processing', { documentId: docId, timeoutMs });
        return null;
    };

    // wait for each uploaded document to finish processing (best effort)
    for (const d of uploadedDocs) {
        try {
            const docId = d?.id ?? d?.documentId ?? d;
            const finalInfo = await waitForProcessing(docId);
            try {
                console.log('Final document info', JSON.stringify(finalInfo ?? d, null, 2));
            } catch (e) {
                console.log('Final document info (raw)', finalInfo ?? d);
            }
            // Try to fetch extracted text (if available) for debugging
            try {
                const textContent = await client.beta.libraries.documents.textContent({ libraryId: library.id, documentId: docId });
                try {
                    console.log('Extracted text content for document', docId, JSON.stringify(textContent, null, 2));
                } catch (e) {
                    console.log('Extracted text content for document', docId, textContent);
                }
            } catch (e) {
                console.warn('Could not fetch extracted text content for', docId, e);
            }
        } catch (e) {
            console.warn('Error while waiting for document processing', e);
        }
    }

    userMessage.attachmentId = library.id;
    return { library, uploadedDocs };
}

async function getDocsLibrary(libraryId: string) {
    const client = new Mistral({apiKey: getApiKey()});
    const libraries = await client.beta.libraries.list();
    return libraries.data.find(l => l.id === libraryId) ?? null;
}
export async function getDocsInLibrary(libraryId: string) {
    const client = new Mistral({apiKey: getApiKey()});
    const docs = await client.beta.libraries.documents.list({ libraryId });
    return docs;
}

async function updateAgent(thread: Thread, userMessage : Message, libraryId : string) {
    const client = new Mistral({apiKey: getApiKey()});
    
    const text = String(userMessage?.text ?? '').trim();

    const codeRegex = /```|(?:\b(?:code|script|javascript|typescript|python|java|c\+\+|cpp|c#|csharp|ruby|go|rust|bash|shell|sh|dockerfile|sql|query|compile|execute|run|debug|stack trace|traceback|function\s+\w+|class\s+\w+)\b)/i;
    const imageRegex = /\b(image|picture|photo|generate image|create image|render|illustration|draw|logo|portrait|avatar|icon|png|jpg|jpeg|svg|midjourney|dalle|stable diffusion|sdxl)\b/i;
    
    const needCodeInterpreter: boolean = codeRegex.test(text);
    const needWebSearch: boolean = true;
    const needImageGeneration: boolean = imageRegex.test(text);
    console.log(libraryId)
    const needFileTool: boolean = libraryId !== '';

    let agent = await getAgent();
    if (!agent) {
        // ensure agent exists
        if (!(await existAgent())) {
            await createAgent();
        }
        agent = await getAgent();
    }
    if (!agent || !agent.id) {
        throw new Error('Agent not available');
    }

    const tools: any[] = [];
    if (needWebSearch) tools.push({ type: "web_search" });
    if (needCodeInterpreter) tools.push({ type: "code_interpreter" });
    if (needImageGeneration) tools.push({ type: "image_generation" });
    if (needFileTool) tools.push({ type: "document_library", libraryIds: [libraryId] });

    const websearchAgent = await client.beta.agents.update({
        agentId: agent.id,
        agentUpdateRequest: {
            model: thread.model ?? getActualModel(),
            instructions: thread.context || getContext() || "You are a helpful assistant.",
            tools
        },
    });
    const library = await getDocsLibrary(libraryId);
    console.log('Using library', library);
    console.log('Updated/created agent with tools', websearchAgent);
    return websearchAgent;
    
}

async function runAgent(thread: Thread, userMessage: Message, files : File[] = [], messagesList: any[] = []) {
    const client = new Mistral({apiKey: getApiKey()});
    let libraryId =  userMessage.attachmentId
    console.log(userMessage)
    if (files.length > 0) {
        const docsLibrary = await createDocsLibrary(thread, userMessage, files);
        libraryId = (docsLibrary as any)?.library?.id ?? (docsLibrary as any)?.id ?? '';
    }
    if (!(await existAgent())) await createAgent();

    const updatedAgent = await updateAgent(thread, userMessage, libraryId ?? '');
    console.log('messagesList', messagesList);
    console.log('updatedAgent before starting conversation', updatedAgent);

    if (!updatedAgent || !updatedAgent.id) {
        console.error('No agent available to start the conversation. Aborting start call.', { updatedAgent });
        return { chatResponse: null, attachmentId: libraryId ?? null };
    }

    let chatResponse: any = null;
    try {
        const debugClient = new Mistral({ apiKey: getApiKey(), debugLogger: console });
        console.log('Starting conversation with agentId', updatedAgent.id, 'and inputs', messagesList);
        chatResponse = await debugClient.beta.conversations.start({
            agentId: updatedAgent.id,
            inputs: [
                ...messagesList
            ]
        });
        console.log('chatResponse', chatResponse);
    } catch (err) {
        return { chatResponse: {"detail": [{"msg": err}]}, attachmentId: libraryId ?? null };
    }
    

    return { chatResponse, attachmentId: libraryId ?? null };

    
}

export async function handleMessageSend(thread: Thread, content: string, selectedFiles: File[] = []) {
    // If there are any cancelled assistant messages from a previous cancelled operation,
    // remove them along with their parent user messages so the new send starts from a clean state.
    try { cleanupCancelledMessages(thread, true); } catch (e) {}
    const lastMessage = getLastMessage(thread);
    const history = getHistory(thread, lastMessage);
    

    const userMessage: Message = {
        id: generateUUID() ?? '',
        text: content,
        thinking : "",
        sender: 'user',
    timestamp: utcNow(),
        parentId: lastMessage?.id ?? 'root',
        status: 'local'
        ,
        attachmentId: ''
    };
    const newMessage: Message = {
        id: generateUUID(),
        text: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 50 50" class="spinner" role="img" aria-label="loading"><circle cx="25" cy="25" r="20" fill="none" stroke="#cbd5e1" stroke-width="5"/><path fill="#3b82f6" d="M25 5a1 1 0 0 1 1 1v6a1 1 0 0 1-2 0V6a1 1 0 0 1 1-1z"><animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/></path></svg>',
        thinking : '',
        sender: 'assistant',
    timestamp: utcNowPlus(1000),
        parentId: userMessage?.id ?? 'root',
        status: 'local',
        attachmentId: ''
    }
    thread.messages = [...(thread.messages ?? []), userMessage, newMessage];
    updateThreadCache(thread);
    try { setActualThread(thread); } catch (e) {}
    try { updateActualThread(); } catch (e) {}
    // Register active request so UI can offer cancellation
    try { startActiveRequest(thread.id, newMessage.id ?? ''); } catch (e) {}
        

    const messagesList = [
            
            ...history,
            {
                role: "user",
                content: content
            }
        ];

    
    const { chatResponse, attachmentId } = await runAgent(thread, userMessage, selectedFiles, messagesList);
    console.log(chatResponse);
    // If the request was cancelled, activeRequests entry will have been removed by cancelActiveRequest
    if (!activeRequests.has(thread.id)) return;
    if (!chatResponse || !chatResponse.outputs || chatResponse.outputs.length === 0) {
        newMessage.text = `<p class='text-red-500'>${chatResponse.detail[0].msg}</p>`;
        newMessage.thinking = "";
        return;
    }
    const { thinking, texts } = extractThinkingAndText(chatResponse);
    console.log('Thinking:', thinking, 'Texts:', texts);
    newMessage.text = texts.join('\n');
    newMessage.thinking = thinking.join('\n');
    updateThreadCache(thread);
        
    updateActualThread();
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
    try { activeRequests.delete(thread.id); } catch (e) {}
}

export async function handleRegenerateMessage(thread : Thread, message: Message, model : string) {
    if (message.sender !== 'assistant') return;
    if (!thread || !message) return;
    // Remove any cancelled assistant messages for this thread before regenerating.
    try { cleanupCancelledMessages(thread, false); } catch (e) {}
    const msgs = thread.messages ?? [];
    const parentId = message.parentId ?? null;
    const userMessage : Message | null = msgs.find(m => m.id === parentId && m.sender === 'user') ?? null;
    if (!userMessage) return;
    if (!parentId) return;

    const history = getHistory(thread, msgs.find(m => m.id === parentId) ?? null);
    const newMessage: Message = {
        id: generateUUID(),
        text: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 50 50" class="spinner" role="img" aria-label="loading"><circle cx="25" cy="25" r="20" fill="none" stroke="#cbd5e1" stroke-width="5"/><path fill="#3b82f6" d="M25 5a1 1 0 0 1 1 1v6a1 1 0 0 1-2 0V6a1 1 0 0 1 1-1z"><animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/></path></svg>',
        thinking : '',
        sender: 'assistant',
        timestamp: utcNowPlus(1000),
        parentId: parentId,
        status: 'local',
        attachmentId: ''
    }
    thread.messages = [...msgs, newMessage];
    updateThreadCache(thread);
    try { setActualThread(thread); } catch (e) {}
    try { updateActualThread(); } catch (e) {}
    try { startActiveRequest(thread.id, newMessage.id ?? ''); } catch (e) {}
    const client = new Mistral({apiKey: getApiKey()});
    const messagesList = [
            
            ...history,
        ];
    const { chatResponse, attachmentId } = await runAgent(thread, userMessage, [], messagesList);
    console.log(chatResponse);
    if (!activeRequests.has(thread.id)) return;
    if (!chatResponse || !chatResponse.outputs || chatResponse.outputs.length === 0) {
        newMessage.text = "Error: no response";
        newMessage.thinking = "";
        return;
    }
    const { thinking, texts } = extractThinkingAndText(chatResponse);
    newMessage.text = texts.join('\n');
    newMessage.thinking = thinking.join('\n');
    updateThreadCache(thread);
    updateActualThread();
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
    try { activeRequests.delete(thread.id); } catch (e) {}
    return newMessage;    
}

export async function handleEditMessage(thread : Thread, message: Message, editMessage : string) {
    if (message.sender !== 'user') return;
    if (!thread || !message) return;
    // Remove cancelled assistant messages and their parent user messages before performing an edit-based resend.
    try { cleanupCancelledMessages(thread, true); } catch (e) {}
    const msgs = thread.messages ?? [];
    const parentId = message.parentId ?? null;
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
        attachmentId: message.attachmentId
    }
    
    const newMessage: Message = {
        id: generateUUID(),
        // Use a simple inline SVG spinner for loading state when regenerating
        text: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 50 50" class="spinner" role="img" aria-label="loading"><circle cx="25" cy="25" r="20" fill="none" stroke="#cbd5e1" stroke-width="5"/><path fill="#3b82f6" d="M25 5a1 1 0 0 1 1 1v6a1 1 0 0 1-2 0V6a1 1 0 0 1 1-1z"><animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/></path></svg>',
        thinking : '',
        sender: 'assistant',
        timestamp: utcNowPlus(2000),
        parentId: newUserMessage.id,
        status: 'local',
        attachmentId: ''
    }
    thread.messages = [...msgs, newUserMessage, newMessage];
    try { setActualThread(thread); } catch (e) {}
    try { updateActualThread(); } catch (e) {}
    updateThreadCache(thread);
    try { startActiveRequest(thread.id, newMessage.id ?? ''); } catch (e) {}
        
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
    if (!activeRequests.has(thread.id)) return;
    if (!chatResponse || !chatResponse.outputs || chatResponse.outputs.length === 0) {
        newMessage.text = "Error: no response";
        newMessage.thinking = "";
        return;
    }
    const { thinking, texts } = extractThinkingAndText(chatResponse);
    newMessage.text = texts.join('\n');
    newMessage.thinking = thinking.join('\n');

    updateActualThread();
    if ((thread.status as any) !== 'remote') {
        await createServerThread(thread);
    }
    await syncServerThread(thread);
    thread.date = utcNow();
    updateThreadCache(thread);
    updateAllThreadsList(thread);
    const url = `/${thread.id}`;
    if (typeof window !== 'undefined' && window.history && window.history.pushState) {
        window.history.pushState({}, '', url);
    }

}