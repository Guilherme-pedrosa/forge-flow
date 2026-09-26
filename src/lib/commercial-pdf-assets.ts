import { supabase } from "@/integrations/supabase/client";
import type { PdfImage, PdfAssets } from "./commercial-pdf";
import type { CommercialDocument, DocumentCompany } from "./commercial-document";

async function loadImage(url: string, timeout: number): Promise<PdfImage | null> {
  let objectUrl = "";
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      (async () => {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" && !/^data:image\/(png|jpeg|webp);base64,/i.test(url)) return null;
        const storage = parsed.origin === new URL(import.meta.env.VITE_SUPABASE_URL).origin && parsed.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
        let blob: Blob;
        if (storage) {
          const { data, error } = await supabase.storage.from(storage[1]).download(decodeURIComponent(storage[2]));
          if (error || !data) return null;
          blob = data;
        } else {
          const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(timeout) });
          if (!response.ok) return null;
          blob = await response.blob();
        }
        if (expired || !/^image\/(png|jpeg|webp)$/i.test(blob.type) || blob.size > 8 * 1024 * 1024) return null;
        objectUrl = URL.createObjectURL(blob);
        const source = new Image(); source.src = objectUrl; await source.decode();
        const scale = Math.min(1, 800 / Math.max(source.naturalWidth, source.naturalHeight));
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(source.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
        const context = canvas.getContext("2d"); if (!context) return null;
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        return { data: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
      })(),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeout); }),
    ]);
  } catch { return null; }
  finally { expired = true; clearTimeout(timer!); if (objectUrl) URL.revokeObjectURL(objectUrl); }
}

export async function commercialPdfAssets(document: CommercialDocument, company: DocumentCompany): Promise<{ assets: PdfAssets; missingImages: number }> {
  const urls = [...new Set([company.logo_url, ...document.items.map(item => item.imageUrl)].filter((url): url is string => !!url))];
  const images = new Map<string, PdfImage>(); let next = 0, missingImages = 0;
  // A slow image host must not delay an entire customer document indefinitely.
  const deadline = Date.now() + 6000;
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (next < urls.length) {
      const url = urls[next++], remaining = deadline - Date.now();
      const image = remaining > 0 ? await loadImage(url, remaining) : null;
      if (image) images.set(url, image); else missingImages++;
    }
  }));
  return { assets: { logo: company.logo_url ? images.get(company.logo_url) : null, items: images }, missingImages };
}
