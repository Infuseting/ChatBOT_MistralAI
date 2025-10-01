import { Mistral } from "@mistralai/mistralai";
import { getApiKey } from "./ApiKey";
import { getActualModel } from "./Models";
import { Thread } from "./Thread";
import { Message } from "./Message";
import { getContext } from "./Context";
import { fromBase64 } from "./crypt";

export function extractThinkingAndText(response: any) {
  const thinking: string[] = [];
  const texts: string[] = [];
    const web_references: Array<Record<string, any>> = [];
    const images: Array<Record<string, any>> = [];

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

        // Handle tool file chunks produced by tools (image generation, uploads, etc.)
        if (output.type === 'tool_file' || output.type === 'tool.file' || output.type === 'tool.file_chunk') {
            // Expected shapes: { fileId, fileName?, fileType?, tool? }
            const fileId = output.fileId ?? output.file_id ?? output.arguments?.fileId ?? output.arguments?.file_id ?? null;
            const fileName = output.fileName ?? output.file_name ?? output.arguments?.fileName ?? output.arguments?.file_name ?? null;
            const fileType = output.fileType ?? output.file_type ?? output.arguments?.fileType ?? output.arguments?.file_type ?? null;
            if (fileId) {

                images.push({ fileId, fileName, fileType, raw: output });
            }
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
                    // tool_file entries can appear inside message content arrays as well
                    if (item.type === 'tool_file' || item.type === 'tool.file' || item.type === 'tool_file_chunk') {
                        const fileId = item.fileId ?? item.file_id ?? item.file ?? item.fileId ?? null;
                        const fileName = item.fileName ?? item.file_name ?? null;
                        const fileType = item.fileType ?? item.file_type ?? null;
                        if (fileId) {
                            const url = (typeof window !== 'undefined' && window.location && window.location.origin)
                                ? `${window.location.origin}/api/files/download?fileId=${encodeURIComponent(String(fileId))}`
                                : `/api/files/download?fileId=${encodeURIComponent(String(fileId))}`;
                            images.push({ fileId, fileName, fileType, url, raw: item });
                        }
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

  return { thinking, texts, web_references, images };
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
async function getLibrariesIdFromMD5(md5: string | undefined) {
  if (!md5) return null;
  const response = await fetch('/api/attachment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requestType: 'get_librariesId',
      md5
    }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.librariesIds ?? null;
}
async function createDocsLibrary(thread: Thread, userMessage: Message) {
  const client = new Mistral({apiKey: getApiKey()})
  for (const msg of thread.messages ?? []) {
    if (msg.status != 'sync') {
      for (const att of msg.attachments ?? []) {
        const librariesId = await getLibrariesIdFromMD5(att.data?.md5);
        let librarieId = '';
        for (const libId of librariesId ?? []) {
          const lib = await client.beta.libraries.get({libraryId: libId})
          console.log(lib);
          if (lib != null) {librarieId = lib.id; break}
        }
        att.librariesId = librarieId;
        if (att.librariesId == '') {
          const lib = await client.beta.libraries.create({name:`file : ${att.data?.md5}`})
          const fileText = await fromBase64(att.data?.data ?? '');
          const fileName = att.fileName; 
          console.log(file);
          const uploadedDoc = await client.beta.libraries.documents.upload({
                libraryId: lib.id,
                requestBody: { file: file },
            });
        }

      }
    }         
  }
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

async function updateAgent(thread: Thread, userMessage : Message, image : boolean = false) {
    const client = new Mistral({apiKey: getApiKey()});
    
    const text = String(userMessage?.text ?? '').trim();

    const codeRegex = /```|(?:\b(?:code|script|javascript|typescript|python|java|c\+\+|cpp|c#|csharp|ruby|go|rust|bash|shell|sh|dockerfile|sql|query|compile|execute|run|debug|stack trace|traceback|function\s+\w+|class\s+\w+)\b)/i;
    const imageRegex = /\b(image|picture|photo|generate image|create image|render|illustration|draw|logo|portrait|avatar|icon|png|jpg|jpeg|svg|midjourney|dalle|stable diffusion|sdxl)\b/i;
    
    const needCodeInterpreter: boolean = codeRegex.test(text);
    const needWebSearch: boolean = true;
    const needImageGeneration: boolean = image ;
    const needFileTool: boolean = (userMessage.attachments && userMessage.attachments.length > 0) ?? false;

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
    if (needWebSearch && !needImageGeneration) tools.push({ type: "web_search" });
    if (needCodeInterpreter && !needImageGeneration) tools.push({ type: "code_interpreter" });
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

export async function runAgent(thread: Thread, userMessage: Message, files : File[] = [], messagesList: any[] = [], imageGeneration : boolean = false) {
    const client = new Mistral({apiKey: getApiKey()});
    let libraryId =  userMessage;
    console.log(userMessage)
    if (files.length > 0) {
        const docsLibrary = await createDocsLibrary(thread, userMessage);
        libraryId = (docsLibrary as any)?.library?.id ?? (docsLibrary as any)?.id ?? '';
    }
    if (!(await existAgent())) await createAgent();

    const updatedAgent = await updateAgent(thread, userMessage, imageGeneration);
    console.log('messagesList', messagesList);
    console.log('updatedAgent before starting conversation', updatedAgent);

    if (!updatedAgent || !updatedAgent.id) {
        console.error('No agent available to start the conversation. Aborting start call.', { updatedAgent });
        return { chatResponse: null, attachmentId: libraryId ?? null };
    }
    return;
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
        console.error('Error starting conversation', err);
        // return the error wrapped so caller can handle it gracefully
        return { chatResponse: null, attachmentId: libraryId ?? null };
    }
    

    return { chatResponse, attachmentId: libraryId ?? null };

    
}
