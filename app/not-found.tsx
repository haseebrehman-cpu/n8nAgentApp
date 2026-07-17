import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="text-sm text-slate-600">That page does not exist.</p>
      <Link
        href="/"
        className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Back home
      </Link>
    </main>
  );
}
