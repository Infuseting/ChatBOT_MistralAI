
// Message shape used throughout the application to represent a chat message.
// Fields:
// - id: unique identifier of the message
// - text: the visible content of the message
// - thinking: optional assistant internal content / tool output log
// - sender: either 'user' or 'assistant'
// - timestamp: Date when message was created/sent
// - parentId: id of the parent message (conversation thread linking)
// - status: 'sync' when persisted remotely, 'local' when local-only
// - attachmentId: optional id pointing to uploaded attachments or libraries
type Message = {
    id: string,
    text: string,
    thinking: string,
    sender: 'user' | 'assistant',
    timestamp: Date,
    parentId: string,
    // 'cancelled' indicates a locally cancelled assistant response which should not be synced to the server
    status: 'sync' | 'local' | 'cancelled' | undefined,
    attachmentId?: string 
}

export type { Message };