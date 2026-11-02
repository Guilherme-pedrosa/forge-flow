import protocol from "../../extensions/forge-slicer/protocol.json";

export const LOCAL_SLICER_PROFILE_ID = protocol.profile_id;
export const LOCAL_SLICER_PROFILES = [
  { id: protocol.profiles[0], label: "A1" }, { id: protocol.profiles[1], label: "A2L" },
];
const CHUNK_BYTES = protocol.chunk_bytes, MAX_FILE_BYTES = protocol.max_file_bytes;
export type LocalSlicerInfo = { profile_id: string; engine_version: string; profiles?: string[] };
export type LocalSlicerStats = { time_seconds: number; weight_grams: number; engine: string; engine_version: string; normalizations: string[] };
type Message = Record<string, unknown>;
type PortListener<T> = { addListener(listener: T): void; removeListener(listener: T): void };
type ExtensionPort = {
  postMessage(message: Message): void; disconnect(): void;
  onMessage: PortListener<(message: unknown) => void>; onDisconnect: PortListener<() => void>;
};
type Runtime = { connect(id: string, options: { name: string }): ExtensionPort; lastError?: { message?: string } };
const aborted = () => new DOMException("Fatiamento cancelado.", "AbortError");
const record = (value: unknown): Message => value && typeof value === "object" && !Array.isArray(value) ? value as Message : {};
const checkAbort = (signal?: AbortSignal) => { if (signal?.aborted) throw aborted(); };
const validFileName = (name: string) => name.length <= 240 && !/[/\\]/.test(name) && ![...name].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer))].map(value => value.toString(16).padStart(2, "0")).join("");
}
function encode(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function connect(signal?: AbortSignal, onProgress?: (progress: number) => void) {
  checkAbort(signal);
  const runtime = (globalThis as typeof globalThis & { chrome?: { runtime?: Runtime } }).chrome?.runtime;
  if (!runtime?.connect) throw new Error("Instale a extensão Forge e o fatiador local neste computador.");
  const port = runtime.connect(protocol.extension_id, { name: "forge-slicer-v1" });
  let closed = false;
  const pending = new Map<string, { resolve: (value: Message) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  function dispose(reason = new Error("O fatiador local foi desconectado.")) {
    if (closed) return;
    closed = true;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(reason); }
    pending.clear();
    port.onMessage.removeListener(message); port.onDisconnect.removeListener(disconnected);
    signal?.removeEventListener("abort", cancel);
    try { port.disconnect(); } catch { /* The browser may already have closed it. */ }
  }
  function cancel() {
    if (!closed) {
      try { port.postMessage({ id: crypto.randomUUID(), op: "cancel" }); } catch { /* Disconnect also cancels the native session. */ }
    }
    dispose(aborted());
  }
  function disconnected() { dispose(new Error(runtime?.lastError?.message || "A extensão ou o fatiador local foi desconectado.")); }
  function message(raw: unknown) {
    const value = record(raw);
    if (value.event === "progress" && typeof value.progress === "number" && Number.isFinite(value.progress) && value.progress >= 0 && value.progress <= 100) {
      onProgress?.(value.progress); return;
    }
    if (typeof value.id !== "string" || !pending.has(value.id)) return;
    const request = pending.get(value.id)!; pending.delete(value.id); clearTimeout(request.timer);
    if (value.ok === true) request.resolve(value);
    else request.reject(new Error(typeof value.error === "string" ? value.error.slice(0, 1000) : "O fatiador local enviou uma resposta inválida."));
  }
  port.onMessage.addListener(message); port.onDisconnect.addListener(disconnected);
  signal?.addEventListener("abort", cancel, { once: true });
  const request = (op: string, fields: Message = {}, timeout = 30000): Promise<Message> => {
    checkAbort(signal);
    if (closed) return Promise.reject(new Error("O fatiador local foi desconectado."));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("O fatiador local não respondeu. Confira a instalação e tente novamente.")); cancel(); }, timeout);
      pending.set(id, { resolve, reject, timer });
      try { port.postMessage({ ...fields, id, op }); } catch (error) { dispose(error instanceof Error ? error : new Error("Não foi possível conectar ao fatiador local.")); }
    });
  };
  return { request, cancel, async finish() { try { if (!closed) await request("finish", {}, 3000); } finally { dispose(); } } };
}
function readInfo(value: Message): LocalSlicerInfo {
  if (value.profile_id !== LOCAL_SLICER_PROFILE_ID || typeof value.engine_version !== "string" || !value.engine_version.trim() || value.engine_version.length > 100)
    throw new Error("O fatiador local não oferece o perfil Bambu A1, bico 0,4 mm, PLA e camada 0,20 mm.");
  if (value.profiles !== undefined && (!Array.isArray(value.profiles) || !value.profiles.length || value.profiles.length > protocol.profiles.length
    || new Set(value.profiles).size !== value.profiles.length || value.profiles.some(id => typeof id !== "string" || !protocol.profiles.includes(id))))
    throw new Error("O conector informou modelos de impressão inválidos.");
  return { profile_id: value.profile_id, engine_version: value.engine_version, ...(value.profiles !== undefined ? { profiles: value.profiles as string[] } : {}) };
}

/** Detection opens a short-lived native session and never starts slicing. */
export async function detectLocalSlicer({ signal }: { signal?: AbortSignal } = {}): Promise<LocalSlicerInfo | null> {
  let session: ReturnType<typeof connect> | undefined;
  try {
    session = connect(signal);
    return readInfo(await session.request("hello", {}, 3000));
  } catch { return null; }
  finally { await session?.finish().catch(() => {}); }
}

export async function sliceWithLocalExtension(file: File, { signal, onProgress, profileId = LOCAL_SLICER_PROFILE_ID }: { signal?: AbortSignal; onProgress?: (progress: number) => void; profileId?: string } = {}): Promise<{ file: File; stats: LocalSlicerStats }> {
  checkAbort(signal);
  if (!/\.(stl|3mf)$/i.test(file.name) || !validFileName(file.name) || !file.size || file.size > MAX_FILE_BYTES)
    throw new Error("Escolha um STL ou 3MF de até 64 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkAbort(signal);
  if (bytes.length !== file.size) throw new Error("O arquivo foi lido de forma incompleta.");
  const hash = await sha256(bytes); checkAbort(signal);
  const session = connect(signal, progress => onProgress?.(45 + Math.round(progress * .4)));
  try {
    const info = readInfo(await session.request("hello"));
    if (!(info.profiles ?? [info.profile_id]).includes(profileId)) throw new Error("Atualize o conector local para fatiar com este modelo de impressora.");
    await session.request("begin", { name: file.name, size: bytes.length, sha256: hash, profile_id: profileId });
    for (let part = 0; part < Math.ceil(bytes.length / CHUNK_BYTES); part++) {
      await session.request("chunk", { part, base64: encode(bytes.subarray(part * CHUNK_BYTES, (part + 1) * CHUNK_BYTES)) });
      onProgress?.(Math.round(Math.min(bytes.length, (part + 1) * CHUNK_BYTES) / bytes.length * 40));
    }
    onProgress?.(45);
    const result = await session.request("slice", {}, 11 * 60 * 1000);
    if (!Number.isInteger(result.size) || Number(result.size) < 4 || Number(result.size) > MAX_FILE_BYTES
      || result.chunks !== Math.ceil(Number(result.size) / CHUNK_BYTES) || typeof result.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(result.sha256)
      || typeof result.file_name !== "string" || !/\.3mf$/i.test(result.file_name) || !validFileName(result.file_name))
      throw new Error("O fatiador local não retornou um 3MF válido e completo.");
    const rawStats = record(result.stats);
    if (rawStats.profile_id !== profileId || rawStats.input_sha256 !== hash || rawStats.output_sha256 !== result.sha256)
      throw new Error("A origem ou o hash do resultado local não corresponde a este arquivo.");
    if (typeof rawStats.time_seconds !== "number" || !Number.isFinite(rawStats.time_seconds) || rawStats.time_seconds <= 0 || rawStats.time_seconds > 31536000
      || typeof rawStats.weight_grams !== "number" || !Number.isFinite(rawStats.weight_grams) || rawStats.weight_grams <= 0 || rawStats.weight_grams > 1000000
      || rawStats.engine !== "Bambu Studio" || rawStats.engine_version !== info.engine_version
      || rawStats.normalizations != null && (!Array.isArray(rawStats.normalizations) || rawStats.normalizations.length > 100 || rawStats.normalizations.some(value => typeof value !== "string" || value.length > 1000)))
      throw new Error("O fatiador local não informou tempo e filamento válidos.");
    const stats: LocalSlicerStats = { time_seconds: rawStats.time_seconds, weight_grams: rawStats.weight_grams,
      engine: "Bambu Studio", engine_version: info.engine_version, normalizations: (rawStats.normalizations as string[] | undefined) ?? [] };
    const output = new Uint8Array(Number(result.size));
    for (let part = 0; part < Number(result.chunks); part++) {
      const chunk = await session.request("read", { part });
      if (chunk.part !== part || typeof chunk.base64 !== "string" || !chunk.base64.length || chunk.base64.length > 524288 || chunk.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk.base64))
        throw new Error("Bloco do 3MF local inválido.");
      const decoded = atob(chunk.base64), expected = Math.min(CHUNK_BYTES, output.length - part * CHUNK_BYTES);
      if (decoded.length !== expected) throw new Error("O 3MF local foi recebido de forma incompleta.");
      for (let index = 0; index < decoded.length; index++) output[part * CHUNK_BYTES + index] = decoded.charCodeAt(index);
      onProgress?.(85 + Math.round((part + 1) / Number(result.chunks) * 14));
    }
    if (await sha256(output) !== result.sha256) throw new Error("O hash do 3MF local não confere. Fatie novamente.");
    if (output[0] !== 80 || output[1] !== 75 || output[2] !== 3 || output[3] !== 4) throw new Error("O resultado local não é um arquivo 3MF.");
    checkAbort(signal);
    const sliced = new File([output], result.file_name, { type: "model/3mf" });
    await session.finish(); onProgress?.(100);
    return { file: sliced, stats };
  } catch (error) { session.cancel(); throw error; }
}
