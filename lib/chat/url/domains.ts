/**
 * Official RDX Sports storefront hosts accepted for URL deep-links.
 */

/** Apex hosts (without www). */
export const OFFICIAL_RDX_HOSTS = [
  "rdxsports.co.uk",
  "rdxsports.com",
  "rdxsports.fr",
  "rdxsports.de",
  "rdxsports.es",
  "rdxsports.eu",
] as const;

export type OfficialRdxHost = (typeof OFFICIAL_RDX_HOSTS)[number];

/** Normalize hostname and strip a leading `www.`. */
export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^www\./, "");
}

/** True when the host is an official RDX storefront (www allowed). */
export function isOfficialRdxHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return (OFFICIAL_RDX_HOSTS as readonly string[]).includes(normalized);
}
