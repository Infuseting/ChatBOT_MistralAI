"use client";
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Navbar from '../../components/Navbar';
import Chatbot from '../../components/Chatbot';
import { readThreadCache, setActualThread, threadExists, openSharedThread } from '../../utils/Thread';
import { ToastContainer } from 'react-toastify';

export default function SharePage() {
  const params = useParams();
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const code = params?.code as string | undefined;
    if (!code) {
      router.replace('/');
      return;
    }

    (async () => {
      try {
        const found = readThreadCache(code) ?? null;
        if (found) {
          setActualThread(found);
        } else {
          // openSharedThread performs an API fetch and is async
          await openSharedThread(code);
        }
      } catch (err) {
        console.error('Failed to open shared thread', err);
        router.replace('/');
        return;
      } finally {
        setLoaded(true);
      }
    })();
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
