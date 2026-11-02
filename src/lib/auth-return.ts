/** Keep a protected local destination through login without adding browser storage. */
export function localAuthReturn(value: unknown): string | null {
  const unsafe = (text: string) => [...text].some(character => character === "\\" || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127);
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.length > 2048 || unsafe(value)) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || unsafe(decoded)) return null;
    const url = new URL(value, "https://forge.invalid");
    if (url.origin !== "https://forge.invalid" || ["/login", "/signup", "/setup"].includes(new URL(decoded, "https://forge.invalid").pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return null; }
}
