import { Message } from "./Message";

type Messages = Message[];

export function getTrees(Messages: Messages) {
    const tree: { [key: string]: string } = {};
    Messages.forEach(msg => {
        tree[msg.parentId ?? 'root'] = msg.id;
    });
    return tree;
}

export type { Messages };
