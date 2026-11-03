import type { ProductExternalImport } from "./makerworld-import";

export const MAX_MAKERWORLD_PROJECT_BYTES = 64 * 1024 * 1024;
export const MAKERWORLD_PROJECT_TIMEOUT_MS = 30_000;
export type MakerWorldPublicProject = { name: string; url: string; sizeBytes: number | null };

/** Only URLs actually supplied by MakerWorld are considered. This is the exact
 * public CDN already used by imported MakerWorld assets, never an API/login URL. */
export function publicMakerWorldProjectUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "makerworld.bblmw.com" || url.port
      || url.username || url.password || url.hash || !/^\/makerworld\/model\/.+\.3mf$/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

export function makerWorldPublicProjects(reference: ProductExternalImport): MakerWorldPublicProject[] {
  const seen = new Set<string>();
  return reference.files.flatMap(file => {
    const url = publicMakerWorldProjectUrl(file.url);
    if (!file.download_available || !url || !/\.3mf$/i.test(file.name.trim()) || seen.has(url)) return [];
    seen.add(url);
    return [{ name: file.name, url, sizeBytes: file.size_bytes }];
  });
}

export function makerWorldProjectPending(reference: ProductExternalImport): string {
  const named = reference.files.filter(file => /\.3mf$/i.test(file.name.trim()));
  return named.length
    ? "O MakerWorld informou um projeto 3MF, mas não disponibilizou um download público compatível. Baixe o 3MF no original e envie-o aqui para fatiar."
    : "O MakerWorld não disponibilizou um projeto 3MF público. Envie o 3MF para preservar as placas e cores; um STL não contém a pintura multicolorida do projeto.";
}

/** Browser CORS is deliberately enforced. No cookies, account tokens, redirects
 * or proxy fallback are used to obtain a protected project. */
export async function downloadMakerWorldProject(project: MakerWorldPublicProject, signal?: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<File> {
  const url = publicMakerWorldProjectUrl(project.url);
  if (!url || !/\.3mf$/i.test(project.name.trim())) throw new Error("O projeto não contém uma URL pública 3MF compatível fornecida pelo MakerWorld.");
  if (project.sizeBytes != null && (!Number.isFinite(project.sizeBytes) || project.sizeBytes <= 0 || project.sizeBytes > MAX_MAKERWORLD_PROJECT_BYTES))
    throw new Error("Use um projeto 3MF de até 64 MB.");
  if (signal?.aborted) throw new DOMException("Download cancelado", "AbortError");
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, MAKERWORLD_PROJECT_TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetcher(url, { method: "GET", mode: "cors", credentials: "omit", redirect: "error",
      referrerPolicy: "no-referrer", cache: "no-store", signal: controller.signal });
    if (!response.ok || response.redirected || response.type === "opaque" || response.url && response.url !== url)
      throw new Error("O MakerWorld não disponibilizou o download público deste projeto. Baixe o 3MF no original e envie-o aqui.");
    const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (type && !["application/octet-stream", "binary/octet-stream", "application/zip", "application/3mf", "model/3mf", "application/vnd.ms-package.3dmanufacturing-3dmodel+xml"].includes(type))
      throw new Error("O download retornou uma página ou outro formato. Envie o projeto 3MF obtido no MakerWorld.");
    const rawLength = response.headers.get("content-length");
    const length = rawLength !== null && /^\d+$/.test(rawLength) ? Number(rawLength) : null;
    if (length != null && (length <= 0 || length > MAX_MAKERWORLD_PROJECT_BYTES)) throw new Error("Use um projeto 3MF de até 64 MB.");
    if (!response.body) throw new Error("O download público do projeto está vazio.");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      if (controller.signal.aborted) throw new DOMException("Download cancelado", "AbortError");
      const part = await reader.read();
      if (controller.signal.aborted) throw new DOMException("Download cancelado", "AbortError");
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_MAKERWORLD_PROJECT_BYTES) throw new Error("Use um projeto 3MF de até 64 MB.");
      chunks.push(part.value);
    }
    if (!size || length != null && !response.headers.has("content-encoding") && size !== length)
      throw new Error("O projeto foi recebido de forma incompleta. Tente novamente ou envie o 3MF original.");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4)
      throw new Error("O download não contém um projeto 3MF válido. Envie o arquivo original.");
    const name = project.name.trim().replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 180).replace(/\.3mf$/i, "") + ".3mf";
    return new File([bytes], name, { type: "model/3mf" });
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Download cancelado", "AbortError");
    if (timedOut) throw new Error("O download do projeto demorou mais de 30 segundos. Tente novamente ou envie o 3MF original.");
    if (error instanceof TypeError) throw new Error("O MakerWorld não liberou o download direto para o Forge (rede ou CORS). Baixe o 3MF no original e envie-o aqui.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    try { await reader?.cancel(); } catch { /* Already closed or cancelled. */ }
  }
}
