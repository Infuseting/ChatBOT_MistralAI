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



async function updateAgent(thread: Thread, userMessage : Message, librariesId : string[]) {
    const client = new Mistral({apiKey: getApiKey()});
    
    const text = String(userMessage?.text ?? '').trim();

    const codeRegex = /```|(?:\b(?:code|script|javascript|typescript|python|java|c\+\+|cpp|c#|csharp|ruby|go|rust|bash|shell|sh|dockerfile|sql|query|compile|execute|run|debug|stack trace|traceback|function\s+\w+|class\s+\w+)\b)/i;
    const imageRegex = /\b(image|picture|photo|generate image|create image|render|illustration|draw|logo|portrait|avatar|icon|png|jpg|jpeg|svg|midjourney|dalle|stable diffusion|sdxl)\b/i;
    
    const needCodeInterpreter: boolean = codeRegex.test(text);
    const needWebSearch: boolean = true;
    const needImageGeneration: boolean = imageRegex.test(text);
    const needFileTool: boolean = librariesId.length > 0;

    let agent = await getAgent();
    if (!agent) {
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
    if (needFileTool) tools.push({ type: "document_library", libraryIds: [...librariesId] });

    const websearchAgent = await client.beta.agents.update({
        agentId: agent.id,
        agentUpdateRequest: {
            model: thread.model ?? getActualModel(),
            instructions: thread.context || getContext() || "You are a helpful assistant.",
            tools
        },
    });
    return websearchAgent;
    
}

async function runAgent(thread: Thread, userMessage: Message, messagesList: any[] = []) {
    if (!(await existAgent())) await createAgent();
    let librariesId = await getLibrariesId(userMessage);
    const updatedAgent = await updateAgent(thread, userMessage, librariesId ?? []);
    if (!updatedAgent || !updatedAgent.id) {
        console.error('No agent available to start the conversation. Aborting start call.', { updatedAgent });
        return { chatResponse: null, attachmentId: librariesId ?? null };
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
        return { chatResponse: {"detail": [{"msg": err}]}, attachmentId: librariesId ?? null };
    }
    

    return { chatResponse, attachmentId: librariesId ?? null };

    
}





export async function handleMessageSend(thread: Thread, content: string, selectedFiles: File[] = []) {
    try { cleanupCancelledMessages(thread, true); } catch (e) {}
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

    
    const { chatResponse } = await runAgent(thread, userMessage, messagesList);

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
    const { chatResponse, attachmentId } = await runAgent(thread, userMessage, messagesList);
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
    const { chatResponse, attachmentId } = await runAgent(thread, newUserMessage, messagesList);
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