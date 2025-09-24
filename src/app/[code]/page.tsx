"use client";
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Navbar from '../components/Navbar';
import Chatbot from '../components/Chatbot';
import { readThreadCache, setActualThread, threadExists } from '../utils/Thread';
import { openOrCreateThreadWithId } from '../utils/Thread';
import { ToastContainer } from 'react-toastify';

export default function CodePage() {
  const params = useParams();
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const code = params?.code as string | undefined;
    if (!code) {
      router.replace('/');
      return;
    }
    try {
      
        // not in local cache — ask server if user has permission to open this thread
        (async () => {
          try {
            const res = await fetch(`/api/thread?idThread=${encodeURIComponent(code)}`);
            if (!res.ok) {
              console.warn('Server refused opening thread', res.status);
              router.replace('/');
              return;
            }
            const payload = await res.json().catch(() => null);
            if (!payload) {
              router.replace('/');
              return;
            }
            const thread = await openOrCreateThreadWithId(payload.idThread ?? payload.id ?? code);
            thread.name = payload.name ?? thread.name;
            thread.context = payload.context ?? thread.context ?? '';
            thread.model = payload.model ?? thread.model;
            thread.date = payload.createdAt ? new Date(payload.createdAt) : thread.date;
            // map messages
            thread.messages = (payload.messages ?? []).map((m: any) => ({
              id: m.idMessage ?? m.id ?? '',
              text: m.text ?? m.content ?? '',
              thinking: m.thinking ?? '',
              sender: m.sender ?? m.role ?? 'user',
              timestamp: m.sentAt ? new Date(m.sentAt) : (m.timestamp ? new Date(m.timestamp) : (m.date ? new Date(m.date) : new Date())),
              parentId: m.parentId ?? null,
              status: 'sync'
            }));
            // mark as remote
            thread.status = 'remote';
            thread.share = false;
            
            setActualThread(thread);
          } catch (err) {
            console.error('Failed to load thread from server', err);
            router.replace('/');
            return;
          }
        })();
    } catch (e) {
      router.replace('/');
      return;
    }

    
    setLoaded(true);
  }, [params?.code]);

  if (!loaded) return;

  return (
    <main className="w-full h-screen flex flex-row">
      <Navbar />
      <Chatbot />
      <ToastContainer />
    </main>
  );
}
