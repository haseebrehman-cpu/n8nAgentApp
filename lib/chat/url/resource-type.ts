/**
 * Detect RDX storefront page type and extract the resource handle from a URL.
 */

export type RdxResourceType =
  | "product"
  | "collection"
  | "blog"
  | "page"
  | "policy";

export interface DetectedRdxResource {
  type: RdxResourceType;
  /** Primary handle (product / collection / page / policy / article). */
  handle: string;
  /** Blog handle when type is `blog`. */
  blogHandle?: string;
  /** Normalized pathname used for detection. */
  pathname: string;
  url: URL;
}

export type ResourceDetectionResult =
  | { ok: true; resource: DetectedRdxResource }
  | { ok: false; reason: "unsupported_path" | "missing_handle" };

function cleanSegment(segment: string): string {
  return decodeURIComponent(segment).trim();
}

/**
 * Map an official RDX URL pathname to a catalog/CMS resource.
 *
 * Supported:
 * - `/products/{handle}`
 * - `/collections/{handle}`
 * - `/blogs/{blogHandle}/{articleHandle}`
 * - `/blogs/{blogHandle}/articles/{articleHandle}`
 * - `/pages/{handle}`
 * - `/policies/{handle}`
 */
export function detectRdxResourceType(url: URL): ResourceDetectionResult {
  const pathname = url.pathname.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  const segments = pathname.split("/").filter(Boolean).map(cleanSegment);

  if (segments[0] === "products" || segments[0] === "") {
    const handle = segments[1];
    if (!handle) return { ok: false, reason: "missing_handle" };
    return {
      ok: true,
      resource: { type: "product", handle, pathname, url },
    };
  }

  if (segments[0] === "collections") {
    const handle = segments[1];
    if (!handle) return { ok: false, reason: "missing_handle" };
    // Ignore nested collection paths like /collections/{h}/products
    return {
      ok: true,
      resource: { type: "collection", handle, pathname, url },
    };
  }

  if (segments[0] === "blogs") {
    const blogHandle = segments[1];
    if (!blogHandle) return { ok: false, reason: "missing_handle" };

    let articleHandle: string | undefined;
    if (segments[2] === "articles") {
      articleHandle = segments[3];
    } else if (segments[2] && segments[2] !== "tagged") {
      articleHandle = segments[2];
    }

    if (!articleHandle) return { ok: false, reason: "missing_handle" };
    return {
      ok: true,
      resource: {
        type: "blog",
        handle: articleHandle,
        blogHandle,
        pathname,
        url,
      },
    };
  }

  if (segments[0] === "pages") {
    const handle = segments[1];
    if (!handle) return { ok: false, reason: "missing_handle" };
    return {
      ok: true,
      resource: { type: "page", handle, pathname, url },
    };
  }

  if (segments[0] === "policies") {
    const handle = segments[1];
    if (!handle) return { ok: false, reason: "missing_handle" };
    return {
      ok: true,
      resource: { type: "policy", handle, pathname, url },
    };
  }

  return { ok: false, reason: "unsupported_path" };
}

export function resourceTypeLabel(type: RdxResourceType): string {
  switch (type) {
    case "product":
      return "product";
    case "collection":
      return "collection";
    case "blog":
      return "blog article";
    case "page":
      return "page";
    case "policy":
      return "policy";
  }
}
