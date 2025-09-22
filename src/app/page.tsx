import Chatbot from "./components/Chatbot";
import Navbar from "./components/Navbar";
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export default function Home() {
  
  return (
    <main className="w-full h-screen flex flex-row">
      <Navbar />
      <Chatbot />
      <ToastContainer />
    </main>
  );
}