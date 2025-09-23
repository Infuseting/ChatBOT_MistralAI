type User = {
    id: string;
    name: string;
    picture?: string;
};

export function isUser(obj: any): obj is User {
    return obj && typeof obj.id === 'string' && typeof obj.name === 'string';
}

export async function getUser(access_token: string): Promise<User | null> {
    const res = await fetch('/api/user', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${access_token}` },
    });
    if (!res.ok) throw new Error('Failed to fetch user');
    const data = await res.json();
    return isUser(data) ? data : null;
}

export type { User };