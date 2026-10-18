function normalizedHost(value: string): string | null {
  if (!value || /[\s/\\?#@%]/.test(value)) return null;
  try { return new URL(`https://${value}`).host.toLowerCase(); }
  catch { return null; }
}

/** Redirect only explicitly configured page aliases to the fixed canonical origin. */
export function canonicalPageRedirect(
  url: string,
  method: string,
  host: string,
  canonicalOrigin?: string,
  redirectHosts = "",
): URL | null {
  if (!["GET", "HEAD"].includes(method) || !canonicalOrigin) return null;
  try {
    const canonical = new URL(canonicalOrigin);
    if (!["http:", "https:"].includes(canonical.protocol) || canonical.username || canonical.password) return null;
    const requestHost = normalizedHost(host);
    if (!requestHost || requestHost === normalizedHost(canonical.host)) return null;
    const aliases = redirectHosts.split(",").map(value => normalizedHost(value.trim())).filter(Boolean);
    if (!aliases.includes(requestHost)) return null;
    const source = new URL(url);
    const destination = new URL(canonical.origin);
    destination.pathname = source.pathname;
    destination.search = source.search;
    return destination;
  } catch { return null; }
}
