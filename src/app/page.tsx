import Chatbot from "./components/Chatbot";
import Navbar from "./components/Navbar";


export default function Home() {
  return (
    <main className="w-full h-screen flex flex-row">
      <Navbar />
      <Chatbot />
    </main>
  );
}
