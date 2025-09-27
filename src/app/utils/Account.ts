export async function deleteAccount() {
    try {
        const res = await fetch('/api/auth/delete', { method: 'DELETE' });
        if (!res.ok) {
            const txt = await res.text();
            console.error('Delete failed', txt);
            return false;
        }
        if (typeof window !== 'undefined') {
            localStorage.removeItem('google_credential');
        }
        return true;
    } catch (err) {
        console.error('Delete account error', err);
        return false;
    }
}