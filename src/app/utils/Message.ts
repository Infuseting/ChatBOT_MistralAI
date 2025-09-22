type Message = { 
    id : string, 
    text: string,
    thinking : string,
    sender: 'user' | 'assistant',
    timestamp: Date,
    parentId?: string
}

export type { Message };