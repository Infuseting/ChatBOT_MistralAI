"use client";
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Navbar from '../../components/Navbar';
import Chatbot from '../../components/Chatbot';
import { readThreadCache, setActualThread, threadExists } from '../../utils/Thread';
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
    try {
      const exists = threadExists(code);
      if (!exists) {
        router.replace('/');
        return;
      }
      const found = readThreadCache().find(t => t.id === code) ?? null;
      if (!found) {
        router.replace('/');
        return;
      }
      setActualThread(found);
    } catch (e) {
      router.replace('/');
      return;
    }
    setLoaded(true);
  }, [params?.code]);

  if (!loaded) return <div className="p-4">Opening shared thread...</div>;

  return (
    <main className="w-full h-screen flex flex-row">
      <Navbar />
      <Chatbot />
      <ToastContainer />
    </main>
  );
}
