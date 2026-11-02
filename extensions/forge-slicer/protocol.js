// Public protocol identity. No session, password or API key is stored here.
export const PROTOCOL = Object.freeze({
  version: 1,
  extension_id: "lkalcgppeejlaioplgipmmgdcpncofck",
  host_name: "com.elevare3d.forge_slicer",
  profile_id: "bambu-a1-04-pla-020-v1",
  profiles: ["bambu-a1-04-pla-020-v1", "bambu-a2l-04-pla-020-v1"],
  chunk_bytes: 393216,
  max_file_bytes: 67108864,
  allowed_origins: ["https://elevare3d.lovable.app", "https://id-preview--f4da8107-e6b0-434d-90a9-de1c21edf12f.lovable.app", "https://elevare3d.com.br"],
});

export function allowedSender(sender, internal = false) {
  if (internal) return sender?.id === PROTOCOL.extension_id;
  try {
    const url = new URL(sender?.url || "");
    return !sender?.id && PROTOCOL.allowed_origins.includes(url.origin)
      && (sender.origin == null || sender.origin === url.origin)
      && (sender.frameId == null || sender.frameId === 0);
  } catch { return false; }
}

export function validateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value.id)) throw new Error("Solicitação inválida.");
  const fields = { hello: [], begin: ["name", "size", "sha256", "profile_id"], chunk: ["part", "base64"],
    slice: [], read: ["part"], finish: [], cancel: [] }[value.op];
  if (!fields || Object.keys(value).some(key => !["id", "op", ...fields].includes(key))) throw new Error("Operação não permitida.");
  if (value.op === "begin" && (typeof value.name !== "string" || value.name.length > 200 || /[\\/\x00-\x1f]/.test(value.name)
    || !/\.(stl|3mf)$/i.test(value.name) || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > PROTOCOL.max_file_bytes
    || !/^[a-f0-9]{64}$/.test(value.sha256 || "") || !PROTOCOL.profiles.includes(value.profile_id))) throw new Error("Arquivo ou perfil não suportado.");
  if (["chunk", "read"].includes(value.op) && (!Number.isSafeInteger(value.part) || value.part < 0
    || value.part >= Math.ceil(PROTOCOL.max_file_bytes / PROTOCOL.chunk_bytes))) throw new Error("Bloco inválido.");
  if (value.op === "chunk" && (typeof value.base64 !== "string" || !value.base64.length || value.base64.length > 524288
    || value.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.base64))) throw new Error("Bloco inválido.");
  return value;
}

export function makerLink(value) {
  try {
    const source = new URL(value);
    if (source.protocol !== "https:" || !["makerworld.com", "www.makerworld.com"].includes(source.hostname)) return "";
    const match = source.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/(\d+)(?:-[^/]*)?\/?$/i);
    if (!match) return "";
    const canonical = new URL(`https://makerworld.com/models/${match[1]}`);
    const profile = source.searchParams.get("profileId") || source.hash.match(/^#profileId-(\d+)$/)?.[1];
    if (profile && /^\d+$/.test(profile)) canonical.searchParams.set("profileId", profile);
    return canonical.href;
  } catch { return ""; }
}
