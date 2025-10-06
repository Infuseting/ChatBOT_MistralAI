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
import { generateAttachmentFromFiles, getLibrariesId } from "./Attachments";
import { showErrorToast } from './toast';
import { playTTSForText } from "./useAudioAnalyzer";


function extractThinkingAndText(response: any) {
  const thinking: string[] = [];
  // images will become an ordered array mixing text and image items in the order they appear
  const images: Array<Record<string, any>> = [];

  if (!response || !Array.isArray(response.outputs)) {
    return { thinking, images };
  }

  for (const output of response.outputs) {
    if (!output || !output.type) continue;
    // Detect image-generation style outputs at top level
    if (output.type === 'image' || output.type === 'image_generation' || output.type === 'image.output') {
      const url = output.url ?? output.src ?? output.location ?? null;
      const data = output.data ?? output.base64 ?? output.b64 ?? null;
      const mime = output.mime ?? output.file_type ?? 'image/png';
      const filename = output.fileName ?? output.filename ?? `image.${mime.split('/').pop()}`;
      images.push({ type: 'image', url, data, mime, filename, raw: output });
      continue;
    }

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
        images.push({ type: 'text', text: content, raw: output });
      } else if (Array.isArray(content)) {
        for (const item of content) {
          if (!item) continue;
          // plain text pieces
          if (item.type === "text" && typeof item.text === "string") {
            images.push({ type: 'text', text: item.text, raw: item });
            continue;
          }
          if (typeof item === "string") {
            images.push({ type: 'text', text: item, raw: item });
            continue;
          }
          if (item.type === "tool_reference" || item.type === "web_reference" || item.type === "tool.reference") {
            // push a short human-readable entry into thinking in the order it appears
            const title = item.title ?? item.name ?? null;
            const url = item.url ?? null;
            const desc = item.description ?? null;
            const tool = item.tool ?? null;
            const entry = `WebRef${title ? `: ${title}` : ''}${url ? ` (${url})` : ''}${tool ? ` [via ${tool}]` : ''}${desc ? ` - ${desc}` : ''}`;
            thinking.push(entry);
            continue;
          }
          // image items inside content arrays
          if (item.type === 'image' || item.type === 'image_reference' || item.type === 'image.output') {
            images.push({ type: 'image', url: item.url ?? item.src ?? null, data: item.data ?? item.base64 ?? null, mime: item.mime ?? item.file_type ?? 'image/png', filename: item.filename ?? item.fileName ?? null, raw: item });
            continue;
          }
          // Support Mistral connector tool_file chunks which reference a generated file by id
          if (item.type === 'tool_file' || item.type === 'tool.file' || item.type === 'tool_file_chunk' || item.file_id || item.fileId) {
            const fileId = item.file_id ?? item.fileId ?? item.file ?? null;
            const fileName = item.file_name ?? item.fileName ?? item.name ?? null;
            const fileType = item.file_type ?? item.fileType ?? null;
            if (fileId) {
              images.push({ type: 'image', fileId, filename: fileName, mime: fileType, url: null, raw: item });
            }
            continue;
          }
          if (typeof item.text === "string") {
            images.push({ type: 'text', text: item.text, raw: item });
            continue;
          }
          if (typeof item.content === "string") {
            images.push({ type: 'text', text: item.content, raw: item });
            continue;
          }
          if (Array.isArray(item.content)) {
            for (const sub of item.content) {
              if (sub && typeof sub === "object" && typeof sub.text === "string") images.push({ type: 'text', text: sub.text, raw: sub });
              else if (typeof sub === "string") images.push({ type: 'text', text: sub, raw: sub });
              else if (sub && typeof sub === 'object' && (sub.type === 'image' || sub.type === 'image_reference')) {
                images.push({ type: 'image', url: sub.url ?? sub.src ?? null, data: sub.data ?? sub.base64 ?? null, mime: sub.mime ?? sub.file_type ?? 'image/png', filename: sub.filename ?? sub.fileName ?? null, raw: sub });
              }
            }
          }
        }
      } else if (typeof content === "object" && content !== null) {
        if (typeof content.text === "string") images.push({ type: 'text', text: content.text, raw: content });
        else if (typeof content.content === "string") images.push({ type: 'text', text: content.content, raw: content });
        else if (Array.isArray(content.content)) {
          for (const item of content.content) {
            if (item && typeof item.text === "string") images.push({ type: 'text', text: item.text, raw: item });
            else if (typeof item === "string") images.push({ type: 'text', text: item, raw: item });
            else if (item && typeof item === 'object' && (item.type === 'image' || item.type === 'image_reference')) {
              images.push({ type: 'image', url: item.url ?? item.src ?? null, data: item.data ?? item.base64 ?? null, mime: item.mime ?? item.file_type ?? 'image/png', filename: item.filename ?? item.fileName ?? null, raw: item });
            }
          }
        }
      }
    }
  }

  return { thinking, images };
}

// Helper: download a generated file from Mistral files API and return data URL + sha256
async function fetchGeneratedFileAsDataUrl(fileId: string): Promise<{ dataUrl: string; sha256: string } | null> {
  try {
    if (!fileId) return null;
    const client = new Mistral({ apiKey: getApiKey() });
    // The SDK exposes client.files.download({ file_id }) that returns a stream/Response-like object.
    // We try a few shapes to be tolerant across SDK versions.
    // Preferred: client.files.download({ file_id: fileId }).read()
    // Fallback: client.files.download(fileId)
    let raw: any = null;
    try {
      const dl = await (client as any).files?.download?.({ fileId: fileId } as any);
      const anyDl: any = dl;
      if (!anyDl) {
        // try alternate signature
        const alt = await (client as any).files?.download?.(fileId as any);
        raw = alt as any;
      } else if (typeof anyDl.arrayBuffer === 'function') {
        raw = await anyDl.arrayBuffer();
      } else if (anyDl && anyDl.body) {
        // body may be a ReadableStream
        try {
          raw = await new Response(anyDl.body as any).arrayBuffer();
        } catch (e) {
          raw = anyDl;
        }
      } else {
        raw = anyDl;
      }
    } catch (e) {
      console.error('Failed to download file from Mistral SDK', e);
      return null;
    }

    // raw may be ArrayBuffer, Uint8Array, ReadableStream, or Buffer-like
    let arrayBuffer: ArrayBuffer | null = null;
    if (raw instanceof ArrayBuffer) arrayBuffer = raw;
    else if (raw && raw.buffer instanceof ArrayBuffer) arrayBuffer = raw.buffer;
    else if (raw instanceof Uint8Array) arrayBuffer = raw.buffer as ArrayBuffer;
    else if (raw && typeof raw.getReader === 'function') {
      // ReadableStream (browser). Try to convert using Response(stream)
      try {
        arrayBuffer = await new Response(raw as any).arrayBuffer();
      } catch (e) {
        // Fallback: read via reader
        try {
          const reader = (raw as any).getReader();
          const chunks: Uint8Array[] = [];
          let totalLength = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
              chunks.push(chunk);
              totalLength += chunk.length;
            }
          }
          const out = new Uint8Array(totalLength);
          let offset = 0;
          for (const c of chunks) {
            out.set(c, offset);
            offset += c.length;
          }
          arrayBuffer = out.buffer;
        } catch (er) {
          console.error('Error reading ReadableStream via reader', er);
        }
      }
    } else if (typeof raw === 'string') {
      // maybe base64 already
      // try to detect data: prefix
      if (raw.startsWith('data:')) return { dataUrl: raw, sha256: '' } as any;
      // else treat as url
      const resp = await fetch(raw);
      if (!resp.ok) return null;
      arrayBuffer = await resp.arrayBuffer();
    } else if (raw && raw.data) {
      // Buffer-like
      try {
        arrayBuffer = Uint8Array.from(raw.data).buffer;
      } catch (e) {}
    }

    if (!arrayBuffer) {
      console.error('Unable to convert downloaded file to ArrayBuffer', raw);
      return null;
    }

    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const sha256 = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    // convert to base64 data url
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      const chunk = uint8.subarray(i, i + chunkSize);
      let chunkStr = '';
      for (let j = 0; j < chunk.length; j++) chunkStr += String.fromCharCode(chunk[j]);
      binary += chunkStr;
    }
    const base64 = btoa(binary);
    // default mime unknown; caller may override
    const dataUrl = `data:application/octet-stream;base64,${base64}`;
    return { dataUrl, sha256 };
  } catch (e) {
    console.error('fetchGeneratedFileAsDataUrl error', e);
    return null;
  }
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



async function updateAgent(thread: Thread, userMessage : Message, librariesId : string[], imageGeneration : boolean = false, audio : boolean = false): Promise<any> {
    const client = new Mistral({apiKey: getApiKey()});
    
    const text = String(userMessage?.text ?? '').trim();

    const codeRegex = /```|(?:\b(?:code|script|javascript|typescript|python|java|c\+\+|cpp|c#|csharp|ruby|go|rust|bash|shell|sh|dockerfile|sql|query|compile|execute|run|debug|stack trace|traceback|function\s+\w+|class\s+\w+)\b)/i;

    const needCodeInterpreter: boolean = codeRegex.test(text);
    const needWebSearch: boolean = imageGeneration ? false : true;
    const needImageGeneration: boolean = imageGeneration;
    const needFileTool: boolean = librariesId.length > 0;

    let agent = await getAgent();
    if (!agent) {
        if (!(await existAgent())) {
            await createAgent();
        }
        agent = await getAgent();
    }
    if (!agent || !(agent as any).id) {
        throw new Error('Agent not available');
    }

    const tools: any[] = [];
    if (needWebSearch) tools.push({ type: "web_search" });
    if (needCodeInterpreter) tools.push({ type: "code_interpreter" });
    if (needImageGeneration) tools.push({ type: "image_generation" });
    if (needFileTool) tools.push({ type: "document_library", libraryIds: [...librariesId] });
    console.log(tools)
    let websearchAgent: any;
    try {
       websearchAgent = await client.beta.agents.update({
          agentId: (agent as any).id,
          agentUpdateRequest: {
              model: thread.model ?? getActualModel(),
              instructions: `${audio ? 'You are in a phone conversation with a human. You need to answer their questions and help them. Keep your answers short and to the point. \n\n' : ''} ${thread.context}` || getContext() || "You are a helpful assistant.",
              tools
          },
      });
    } catch (e) {
      console.error('Error updating agent:', e);
      websearchAgent = e;
      
    }
    return websearchAgent;
    
}

async function runAgent(thread: Thread, userMessage: Message, messagesList: any[] = [], imageGeneration : boolean = false, audio : boolean = false) {
  try {
    if (!(await existAgent())) await createAgent();
  } catch (err) {
    console.error('Failed to ensure agent exists', err);
    return { chatResponse: { detail: [{ msg: String(err) }] }, attachmentId: null };
  }

  let librariesId = null;
  try {
    librariesId = await getLibrariesId(userMessage);
  } catch (err) {
    console.error('getLibrariesId failed', err);
    // continue with null librariesId but return structured error to caller
    return { chatResponse: { detail: [{ msg: String(err) }] }, attachmentId: null };
  }

  let updatedAgent: any = null;
  try {
    updatedAgent = await updateAgent(thread, userMessage, librariesId ?? [], imageGeneration, audio);
  } catch (err) {
    console.error('updateAgent failed', err);
    return { chatResponse: { detail: [{ msg: String(err) }] }, attachmentId: librariesId ?? null };
  }

  if (!updatedAgent || !updatedAgent.id) {
    console.error('No agent available to start the conversation. Aborting start call.', { updatedAgent });
    return { chatResponse: { detail: [{ msg: 'No agent available to start the conversation' }] }, attachmentId: librariesId ?? null };
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
  } catch (err: any) {
    console.error('Conversation start failed', err);
    // Normalize SDK errors into the same structured shape used elsewhere
    const msg = err?.message ?? String(err);
    return { chatResponse: { detail: [{ msg }] }, attachmentId: librariesId ?? null };
  }
    

    return { chatResponse, attachmentId: librariesId ?? null };

    
}





export async function handleMessageSend(thread: Thread, content: string, selectedFiles: File[] = [], imageGeneration : boolean = false) {
  try { cleanupCancelledMessages(thread, true); } catch (e) {}
  // Validate API key before proceeding
  try {
    const key = getApiKey();
    const ok = key ? await (await import('./ApiKey')).isValidApiKey(key) : false;
    if (!ok) {
      try { showErrorToast('Clé API manquante ou invalide — ouverture des paramètres.'); } catch (e) {}
  try { window.dispatchEvent(new CustomEvent('openModelSettings', { detail: { panel: 'modele' } } as any)); } catch (e) {}
      return;
    }
  } catch (e) {}
    const lastMessage = getLastMessage(thread);
    const history = getHistory(thread, lastMessage);
    const attachments = await generateAttachmentFromFiles(selectedFiles);
    

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
        text: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 50 50" class="spinner" role="img" aria-label="loading"><circle cx="25" cy="25" r="20" fill="none" stroke="#cbd5e1" stroke-width="5"/><path fill="#3b82f6" d="M25 5a1 1 0 0 1 1 1v6a1 1 0 0 1-2 0V6a1 1 0 0 1 1-1z"><animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/></path></svg>',
        thinking : '',
        sender: 'assistant',
    timestamp: utcNowPlus(1000),
        parentId: userMessage?.id ?? 'root',
        status: 'local',
        attachments: []
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

    
    const { chatResponse } = await runAgent(thread, userMessage, messagesList, imageGeneration);
    if (!activeRequests.has(thread.id)) return;
    if (!chatResponse || !chatResponse.outputs || chatResponse.outputs.length === 0) {
        newMessage.text = `<p class='text-red-500'>${chatResponse.detail[0].msg}</p>`;
        newMessage.thinking = "";
        userMessage.status = 'cancelled';
        newMessage.status = 'cancelled';
        return;
    }
    const { thinking, images } = extractThinkingAndText(chatResponse);
    console.log('Thinking:', thinking, 'OrderedContent:', images);
    newMessage.thinking = thinking.join('\n');
    newMessage.text = '';
    await renderOrderedContentToMessage(images, newMessage);
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

export async function handleRegenerateMessage(thread : Thread, message: Message, model : string, imageGeneration : boolean = false) {
  // Validate API key before proceeding
  try {
    const key = getApiKey();
    const ok = key ? await (await import('./ApiKey')).isValidApiKey(key) : false;
    if (!ok) {
      try { showErrorToast('Clé API manquante ou invalide — ouverture des paramètres.'); } catch (e) {}
  try { window.dispatchEvent(new CustomEvent('openModelSettings', { detail: { panel: 'modele' } } as any)); } catch (e) {}
      return;
    }
  } catch (e) {}
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
        attachments: []
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
    const { chatResponse, attachmentId } = await runAgent(thread, userMessage, messagesList, imageGeneration);
    console.log(chatResponse);
    if (!activeRequests.has(thread.id)) return;
    if (!chatResponse || !chatResponse.outputs || chatResponse.outputs.length === 0) {
        newMessage.text = `<p class='text-red-500'>${chatResponse.detail[0].msg}</p>`;
        newMessage.thinking = "";
        newMessage.status = 'cancelled';
        return;
    }
  const { thinking, images } = extractThinkingAndText(chatResponse);
  // Render ordered content (interleaved text and images) into the message
  newMessage.text = '';
  await renderOrderedContentToMessage(images, newMessage);
  newMessage.thinking = thinking.join('\n');
  // images already rendered and attached by renderOrderedContentToMessage
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

export async function handleEditMessage(thread : Thread, message: Message, editMessage : string, imageGeneration : boolean = false) {
  // Validate API key before proceeding
  try {
    const key = getApiKey();
    const ok = key ? await (await import('./ApiKey')).isValidApiKey(key) : false;
    if (!ok) {
      try { showErrorToast('Clé API manquante ou invalide — ouverture des paramètres.'); } catch (e) {}
  try { window.dispatchEvent(new CustomEvent('openModelSettings', { detail: { panel: 'modele' } } as any)); } catch (e) {}
      return;
    }
  } catch (e) {}

  if (message.sender !== 'user') return;
    if (!thread || !message) return;
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
        attachments: message.attachments
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
        attachments: []
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
    const { chatResponse, attachmentId } = await runAgent(thread, newUserMessage, messagesList, imageGeneration);
    console.log(chatResponse);
    if (!activeRequests.has(thread.id)) return;
    if (!chatResponse || !chatResponse.outputs || chatResponse.outputs.length === 0) {
        newMessage.text = `<p class='text-red-500'>${chatResponse.detail[0].msg}</p>`;
        newMessage.thinking = "";
        newMessage.status = 'cancelled';
        newUserMessage.status = 'cancelled';
        return;
    }
    const { thinking, images } = extractThinkingAndText(chatResponse);
    newMessage.text = '';
    await renderOrderedContentToMessage(images, newMessage);
    newMessage.thinking = thinking.join('\n');
    // images already rendered and attached by renderOrderedContentToMessage

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

async function getAudioTranscription(audioBlob: Blob): Promise<{ transcribeAudio: string; lang: string | null }> {
  if (!audioBlob) return { transcribeAudio: '', lang: null };
  const client = new Mistral({apiKey: getApiKey()});


  const transcriptionResponse = await client.audio.transcriptions.complete({
    model: "voxtral-mini-latest",
    file: {
      fileName: "audio.mp3",
      content: audioBlob,
    },
    // language: "en"
  });

  if (!transcriptionResponse || !transcriptionResponse.text) {
    return { transcribeAudio: '', lang: null };
  }
  return { transcribeAudio: transcriptionResponse.text, lang: transcriptionResponse.language ?? 'en' };
}
export async function handleAudioSend(thread: Thread, audioBlob: Blob) {
 try { cleanupCancelledMessages(thread, true); } catch (e) {}
  try {
    const key = getApiKey();
    const ok = key ? await (await import('./ApiKey')).isValidApiKey(key) : false;
    if (!ok) {
      try { showErrorToast('Clé API manquante ou invalide — ouverture des paramètres.'); } catch (e) {}
  try { window.dispatchEvent(new CustomEvent('openModelSettings', { detail: { panel: 'modele' } } as any)); } catch (e) {}
      return;
    }
  } catch (e) {}
    const lastMessage = getLastMessage(thread);
    const history = getHistory(thread, lastMessage);
    
    const { transcribeAudio, lang } = await getAudioTranscription(audioBlob);
    const userMessage: Message = {
        id: generateUUID() ?? '',
        text: '<i>Transcription de l\'audio en cours...</i>',
        thinking : "",
        sender: 'user',
    timestamp: utcNow(),
        parentId: lastMessage?.id ?? 'root',
        status: 'local'
        ,
        attachments: []
    };
    const newMessage: Message = {
        id: generateUUID(),
        text: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 50 50" class="spinner" role="img" aria-label="loading"><circle cx="25" cy="25" r="20" fill="none" stroke="#cbd5e1" stroke-width="5"/><path fill="#3b82f6" d="M25 5a1 1 0 0 1 1 1v6a1 1 0 0 1-2 0V6a1 1 0 0 1 1-1z"><animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="1s" repeatCount="indefinite"/></path></svg>',
        thinking : '',
        sender: 'assistant',
    timestamp: utcNowPlus(1000),
        parentId: userMessage?.id ?? 'root',
        status: 'local',
        attachments: []
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
                content: transcribeAudio
            }
        ];

    
    const { chatResponse } = await runAgent(thread, userMessage, messagesList, false, true);
    if (!activeRequests.has(thread.id)) return;
    if (!chatResponse || !chatResponse.outputs || chatResponse.outputs.length === 0) {
        newMessage.text = `<p class='text-red-500'>${chatResponse.detail[0].msg}</p>`;
        newMessage.thinking = "";
        userMessage.status = 'cancelled';
        newMessage.status = 'cancelled';
        return;
    }
    userMessage.text = transcribeAudio;
    const { thinking, images } = extractThinkingAndText(chatResponse);
    console.log('Thinking:', thinking, 'OrderedContent:', images);
    newMessage.thinking = thinking.join('\n');
    newMessage.text = '';
    await renderOrderedContentToMessage(images, newMessage);
    updateThreadCache(thread);
    try { await playTTSForText(newMessage.text); } catch (e) { console.warn('playTTSForText failed', e); }
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

// Helper: fetch remote image URL and return data URL + sha256
async function fetchImageAsDataUrl(url: string): Promise<{ dataUrl: string; sha256: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const arrayBuffer = await blob.arrayBuffer();
    // compute sha256
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const sha256 = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    // convert to base64 data url
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      const chunk = uint8.subarray(i, i + chunkSize);
      let chunkStr = '';
      for (let j = 0; j < chunk.length; j++) chunkStr += String.fromCharCode(chunk[j]);
      binary += chunkStr;
    }
    const base64 = btoa(binary);
    const contentType = blob.type || 'image/png';
    const dataUrl = `data:${contentType};base64,${base64}`;
    return { dataUrl, sha256 };
  } catch (e) {
    console.error('Failed to fetch/convert image', url, e);
    return null;
  }
}

// Render ordered content array (texts and images) into the message: append text and attach images inline preserving order
async function renderOrderedContentToMessage(imagesArr: any[], newMessage: Message) {
  if (!Array.isArray(imagesArr) || imagesArr.length === 0) return;
  // ensure text is a string so concatenation works predictably
  if (typeof newMessage.text !== 'string') newMessage.text = String(newMessage.text ?? '');
  for (const item of imagesArr) {
    try {
      if (!item) continue;

      // Treat anything with a text/content property as text (more tolerant)
      const textCandidate = typeof item.text === 'string' ? item.text
        : typeof item.content === 'string' ? item.content
        : null;
      if (item.type === 'text' || textCandidate) {
        const toAppend = String(textCandidate ?? item.text ?? item.content ?? '');
        newMessage.text = `${newMessage.text}${newMessage.text ? '\n\n' : ''}${toAppend}`;
        continue;
      }

      // Image-ish items: be permissive about different shapes (fileId, file_id, url, data)
      const isImageLike = item.type === 'image' || item.type === 'image_reference' || item.type === 'image.output' || item.fileId || item.file_id || item.url || item.data;
      if (isImageLike) {
        const filename = item.filename ?? item.fileName ?? item.name ?? `mistral_image_${Date.now()}.png`;
        const mime = item.mime ?? item.fileType ?? item.file_type ?? 'image/png';
        let dataField = '';
        let sha = '';

        const fileId = item.fileId ?? item.file_id ?? item.file ?? null;
        if (fileId) {
          const fetched = await fetchGeneratedFileAsDataUrl(fileId);
          if (fetched) {
            dataField = fetched.dataUrl;
            sha = fetched.sha256;
          } else {
            continue;
          }
        } else {
          const source = item.data ?? item.base64 ?? item.url ?? item.src ?? null;
          if (!source) continue;
          if (typeof source === 'string' && source.startsWith('data:')) {
            dataField = source;
          } else if (typeof source === 'string' && (source.startsWith('http://') || source.startsWith('https://'))) {
            const fetched = await fetchImageAsDataUrl(source);
            if (fetched) {
              dataField = fetched.dataUrl;
              sha = fetched.sha256;
            } else {
              dataField = `url:${source}`;
            }
          } else {
            dataField = String(source);
          }
        }

        const attachment = {
          fileName: filename,
          fileType: mime,
          type: 'image' as const,
          status: 'local' as const,
          data: {
            sha256: sha,
            data: dataField
          }
        } as any;
        newMessage.attachments = [...(newMessage.attachments ?? []), attachment];

        try {
          const mdSrc = typeof dataField === 'string'
            ? (dataField.startsWith('data:') ? dataField : (dataField.startsWith('url:') ? dataField.slice(4) : dataField))
            : '';
          if (mdSrc) {
            newMessage.text = `${newMessage.text}${newMessage.text ? '\n\n' : ''}![${filename}](${mdSrc})`;
          }
        } catch (e) { /* ignore markdown rendering errors */ }
      }
    } catch (e) {
      console.error('Error rendering ordered content', e);
    }
  }
}