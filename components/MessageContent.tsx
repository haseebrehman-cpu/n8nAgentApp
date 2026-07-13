"use client";

import ReactMarkdown from "react-markdown";
import { sanitizeReply } from "@/lib/sanitize";

export default function MessageContent({ content }: { content: string }) {
  const cleaned = sanitizeReply(content);

  return (
    <div className="w-full text-left text-[13.5px] leading-relaxed text-slate-700">
      <ReactMarkdown
        components={{
          p: ({ children }) => (
            <p className="mb-2.5 text-left last:mb-0">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-slate-900">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-slate-700">{children}</em>,
          ul: ({ children }) => (
            <ul className="mb-2.5 list-disc space-y-1 pl-4 text-left last:mb-0">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 list-decimal space-y-3 pl-4 text-left last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="pl-0.5 text-left marker:font-semibold marker:text-slate-900">
              {children}
            </li>
          ),
          a: ({ children }) => (
            <span className="font-medium text-slate-800">{children}</span>
          ),
          img: () => null,
          h1: ({ children }) => (
            <p className="mb-2 text-left text-[15px] font-semibold text-slate-900">
              {children}
            </p>
          ),
          h2: ({ children }) => (
            <p className="mb-2 text-left text-[14px] font-semibold text-slate-900">
              {children}
            </p>
          ),
          h3: ({ children }) => (
            <p className="mb-1.5 text-left text-[13.5px] font-semibold text-slate-900">
              {children}
            </p>
          ),
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
