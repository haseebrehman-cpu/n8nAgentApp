import type { Metadata } from "next";
import EmbedTransparent from "@/components/EmbedTransparent";

export const metadata: Metadata = {
  title: "Chat Embed",
  robots: { index: false, follow: false },
};

/** Runs before paint so the iframe never flashes white on the storefront. */
const EMBED_BOOTSTRAP = `
(function () {
  var html = document.documentElement;
  html.classList.add("embed-frame");
  html.style.background = "transparent";
  html.style.backgroundColor = "transparent";
  html.style.colorScheme = "light";
  function paintBody() {
    var body = document.body;
    if (!body) return;
    body.classList.add("embed-frame");
    body.style.background = "transparent";
    body.style.backgroundColor = "transparent";
    body.style.overflow = "hidden";
  }
  if (document.body) paintBody();
  else document.addEventListener("DOMContentLoaded", paintBody);
})();
`;

export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: EMBED_BOOTSTRAP }} />
      <EmbedTransparent>
        <div className="m-0 h-screen w-screen overflow-hidden bg-transparent p-0">
          {children}
        </div>
      </EmbedTransparent>
    </>
  );
}
