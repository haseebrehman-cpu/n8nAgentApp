"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold text-slate-900">Something went wrong</h1>
      <p className="max-w-md text-sm text-slate-600">
        Please try again. If the problem continues, refresh the page.
      </p>
      {error.digest ? (
        <p className="text-xs text-slate-400">Reference: {error.digest}</p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Try again
      </button>
    </main>
  );
}
