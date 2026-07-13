"use client";

import { useEffect } from "react";

/** Makes html/body transparent so the Shopify store shows through the iframe. */
export default function EmbedTransparent({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    const prev = {
      htmlBg: html.style.background,
      htmlScheme: html.style.colorScheme,
      bodyBg: body.style.background,
      bodyOverflow: body.style.overflow,
    };

    html.style.background = "transparent";
    html.style.colorScheme = "light";
    body.style.background = "transparent";
    body.style.overflow = "hidden";
    html.classList.add("embed-frame");
    body.classList.add("embed-frame");

    return () => {
      html.style.background = prev.htmlBg;
      html.style.colorScheme = prev.htmlScheme;
      body.style.background = prev.bodyBg;
      body.style.overflow = prev.bodyOverflow;
      html.classList.remove("embed-frame");
      body.classList.remove("embed-frame");
    };
  }, []);

  return <>{children}</>;
}
