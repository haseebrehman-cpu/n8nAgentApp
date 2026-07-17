import ChatWidgetLoader from "@/components/chat/ChatWidgetLoader";

const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME || "Our Store";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-linear-to-b from-slate-50 to-slate-100 px-6 text-center">
      <span className="mb-4 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
        AI Shopping Assistant
      </span>
      <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
        Welcome to {STORE_NAME}
      </h1>
      <p className="mt-4 max-w-xl text-base text-slate-600">
        Have a question about our products? Our AI assistant is standing by.
        Click the chat bubble in the bottom-right corner to get instant answers
        about prices, sizes, and availability.
      </p>
      <ChatWidgetLoader />
    </main>
  );
}
