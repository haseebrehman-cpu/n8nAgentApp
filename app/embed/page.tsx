import ChatWidget from "@/components/ChatWidget";
import EmbedTransparent from "@/components/EmbedTransparent";

export default function EmbedPage() {
  return (
    <EmbedTransparent>
      <style>{`
        html, body {
          background: transparent !important;
          background-color: transparent !important;
          color-scheme: light;
        }
      `}</style>
      <main className="m-0 h-screen w-screen overflow-hidden bg-transparent p-0">
        <ChatWidget />
      </main>
    </EmbedTransparent>
  );
}
