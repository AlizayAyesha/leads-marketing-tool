/** Google Maps place links are listing provenance, not a company website. */

export function isGoogleMapsUrl(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return false;
  try {
    const url = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host === "maps.app.goo.gl") return true;
    if ((host === "goo.gl" || host === "maps.app.goo.gl") && path.startsWith("/maps")) return true;
    if (host === "maps.google.com" || host.startsWith("maps.google.")) return true;
    if (host.startsWith("maps.") && host.includes("google")) return true;
    const googleHost =
      host === "google.com" ||
      host.endsWith(".google.com") ||
      /^google\.[a-z.]+$/.test(host);
    if (googleHost && (path === "/maps" || path.startsWith("/maps/"))) return true;
  } catch {
    return /google\.[^/\s]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(raw);
  }
  return false;
}
