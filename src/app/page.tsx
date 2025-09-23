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
    try {
      const marker = readOpenThreadMarker();
      if (marker) {
        // try cached thread first
        const cached = readThreadCache(marker.id);
        if (cached) {
          setActualThread(cached);
          // navigate to the original path containing the code
          router.replace(marker.path);
          return;
        }

        // try to find in provider
        const found = findThreadById(marker.id);
        if (found) {
          setActualThread(found);
          router.replace(marker.path);
          return;
        }
        // otherwise fallthrough to create a fresh thread at /
      }

      // default: create and set a fresh local thread when opening /
      newThread();
    } catch (e) {
      // ignore in case functions aren't available server-side
    }
  }, []);

  return (
    <main className="w-full h-screen flex flex-row">
      <Navbar />
      <Chatbot />
      <ToastContainer />
    </main>
  );
}