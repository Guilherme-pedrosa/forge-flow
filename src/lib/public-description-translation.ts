// Only public source descriptions are sent here; never send client notes or edited ERP text.
// Provider contract: https://mymemory.translated.net/doc/spec.php (500 UTF-8 bytes per segment).
const cache = new Map<string, string>();
const bytes = (text: string) => new TextEncoder().encode(text).length;
export function translationSegments(text: string): string[] {
  const chunks: string[] = [];
  for (const paragraph of text.match(/[^\n]+(?:\n+|$)|\n+/gu) || []) {
    let current = "";
    for (const word of paragraph.match(/\S+\s*|\s+/gu) || []) {
      if (bytes(current + word) > 480 && current) { chunks.push(current); current = ""; }
      for (const char of word) { if (bytes(current + char) > 480) { chunks.push(current); current = ""; } current += char; }
    }
    if (current) chunks.push(current);
  }
  return chunks;
}
export async function translatePublicDescription(text: string, source: string, signal: AbortSignal): Promise<string> {
  if (!text.trim() || source === "pt") return text;
  if (!["en", "es", "fr", "de", "it", "zh-CN", "ja"].includes(source)) throw new Error("Selecione o idioma original.");
  if (text.length > 15000) throw new Error("Descrição muito longa para a tradução gratuita. Preserve o original ou preencha a descrição em português.");
  const result: string[] = [];
  for (const chunk of translationSegments(text)) {
    if (!chunk.trim()) { result.push(chunk); continue; }
    if (signal.aborted) throw new DOMException("Tradução cancelada", "AbortError"); const key = `${source}:${chunk.trim()}`;
    let translated = cache.get(key);
    if (!translated) {
      const controller = new AbortController(); const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(abort, 12000);
      try {
        const url = new URL("https://api.mymemory.translated.net/get"); url.searchParams.set("q", chunk.trim()); url.searchParams.set("langpair", `${source}|pt-BR`);
        const response = await fetch(url.toString(), { signal: controller.signal, credentials: "omit", headers: { Accept: "application/json" } });
        const data = await response.json();
        if (response.status === 429 || data.quotaFinished || Number(data.responseStatus) === 429 || /MYMEMORY WARNING|USED ALL AVAILABLE FREE/i.test(data.responseData?.translatedText || "")) throw new Error("O limite diário da tradução gratuita foi atingido. O original foi preservado; tente novamente depois ou edite em português.");
        if (!response.ok || Number(data.responseStatus) !== 200 || typeof data.responseData?.translatedText !== "string" || !data.responseData.translatedText.trim()) throw new Error("O serviço de tradução está indisponível. O original foi preservado; tente novamente.");
        translated = data.responseData.translatedText.trim(); cache.set(key, translated);
        if (cache.size > 300) cache.delete(cache.keys().next().value!);
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof Error && error.name === "AbortError") throw new Error("A tradução demorou mais que o esperado. O original foi preservado; tente novamente.");
        throw error;
      } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
    }
    const suffix = chunk.match(/\s+$/)?.[0] || "";
    result.push(translated + suffix);
  }
  if (signal.aborted) throw new DOMException("Tradução cancelada", "AbortError"); return result.join("").trim();
}
