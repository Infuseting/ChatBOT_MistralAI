type Message = { 
    id : string, 
    text: string,
    thinking : string,
    sender: 'user' | 'assistant',
    timestamp: Date,
    parentId: string,
    status : 'sync' | 'local' | undefined
}

export type { Message };