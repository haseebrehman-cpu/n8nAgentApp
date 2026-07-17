"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
