import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chat Embed",
  robots: { index: false, follow: false },
};

export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="embed-frame m-0 h-screen w-screen overflow-hidden bg-transparent p-0">
      {children}
    </div>
  );
}
