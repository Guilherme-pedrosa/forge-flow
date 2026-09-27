import { useState } from "react";

export function ImportedModelImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!src || failedUrl === src) return <div className={`${className || ""} flex items-center justify-center p-3 text-center text-xs text-muted-foreground`} role="img" aria-label={alt}>{src ? "Não foi possível carregar esta foto." : "Foto não disponibilizada pelo autor."}</div>;
  return <img src={src} alt={alt} className={className} referrerPolicy="no-referrer" onError={() => setFailedUrl(src)} />;
}
