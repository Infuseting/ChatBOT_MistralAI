"use client";
import { useEffect } from "react";
import Chatbot from "./components/Chatbot";
import Navbar from "./components/Navbar";
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { newThread, readOpenThreadMarker, readThreadCache, findThreadById, setActualThread } from './utils/Thread';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const init = async () => {
      try {
        const marker = readOpenThreadMarker();
        if (marker) {
          const cached = readThreadCache(marker.id);
          if (cached) {
            setActualThread(cached);
            router.replace(marker.path);
            return;
          }
          const found = await findThreadById(marker.id);
          if (found) {
            setActualThread(found);
            router.replace(marker.path);
            return;
          }
        }

        newThread();
      } catch (e) {
      }
    };

    init();
  }, []);

  return (
    <main className="w-full h-screen flex flex-row">
      <Navbar />
      <Chatbot />
      <ToastContainer />
      
    </main>
  );
}