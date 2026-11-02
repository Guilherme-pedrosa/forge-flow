import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import protocol from "../../extensions/forge-slicer/protocol.json";
import { detectLocalSlicer, sliceWithLocalExtension } from "./local-slicer-extension";

type Message = Record<string, unknown>;
const info = { profile_id: protocol.profile_id, engine_version: "02.08.02.61" };
const stats = { time_seconds: 3600, weight_grams: 25.5, engine: "Bambu Studio", engine_version: info.engine_version, normalizations: [] };
const output = new Uint8Array([80, 75, 3, 4, 9]);
async function hash(bytes: Uint8Array) { return [...new Uint8Array(await webcrypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join(""); }
function file(bytes = new Uint8Array([1, 2, 3]), name = "modelo.3mf") {
  const value = new File([bytes], name);
  Object.defineProperty(value, "arrayBuffer", { value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) });
  return value;
}
function install(handler: (message: Message) => Promise<Message | null> | Message | null) {
  const messages = new Set<(value: unknown) => void>(), disconnects = new Set<() => void>();
  const port = { postMessage: vi.fn((message: Message) => { void Promise.resolve(handler(message)).then(response => {
    if (response) for (const listener of [...messages]) listener({ id: message.id, ok: true, ...response });
  }); }), disconnect: vi.fn(), onMessage: { addListener: (listener: (value: unknown) => void) => messages.add(listener), removeListener: (listener: (value: unknown) => void) => messages.delete(listener) },
  onDisconnect: { addListener: (listener: () => void) => disconnects.add(listener), removeListener: (listener: () => void) => disconnects.delete(listener) } };
  const connect = vi.fn(() => port);
  vi.stubGlobal("chrome", { runtime: { connect } });
  return { port, connect, disconnect: () => { for (const listener of [...disconnects]) listener(); }, operations: () => port.postMessage.mock.calls.map(([message]) => message.op) };
}
async function host(overrides: Partial<Record<string, Message | null>> = {}) {
  const result = { file_name: "modelo-fatiado.3mf", size: output.length, sha256: await hash(output), chunks: 1, stats };
  let sourceHash = "";
  return install(message => {
    if (message.op === "begin") sourceHash = String(message.sha256);
    const response: Message | null = Object.prototype.hasOwnProperty.call(overrides, String(message.op)) ? overrides[String(message.op)]!
      : message.op === "hello" ? info : message.op === "slice" ? result : message.op === "read" ? { part: message.part, base64: btoa(String.fromCharCode(...output)) } : {};
    return message.op === "slice" && response && response.stats ? { ...response, stats: {
      profile_id: info.profile_id, input_sha256: sourceHash, output_sha256: response.sha256, ...response.stats as Message,
    } } : response;
  });
}
beforeEach(() => { Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true }); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("local slicer extension protocol", () => {
  it("uses the explicitly supported A2L profile without replacing it by A1", async () => {
    const a2l = protocol.profiles[1];
    const local = await host({ hello: { ...info, profiles: protocol.profiles }, slice: { file_name: "a2l.3mf", size: output.length, sha256: await hash(output), chunks: 1, stats: { ...stats, profile_id: a2l } } });
    const result = await sliceWithLocalExtension(file(), { profileId: a2l });
    expect(result.file.name).toBe("a2l.3mf"); expect(local.port.postMessage.mock.calls.map(([message]) => message).find(message => message.op === "begin")).toMatchObject({ profile_id: a2l }); expect(local.operations()).toContain("finish");
  });
  it("rejects A2L on an old A1-only host before uploading or slicing", async () => {
    const local = await host();
    await expect(sliceWithLocalExtension(file(), { profileId: protocol.profiles[1] })).rejects.toThrow("Atualize o conector local");
    expect(local.operations()).not.toContain("begin"); expect(local.operations()).not.toContain("chunk"); expect(local.operations()).not.toContain("slice");
  });
  it("rejects A1 statistics for a requested A2L slice before reading its output bytes", async () => {
    const local = await host({ hello: { ...info, profiles: protocol.profiles } });
    await expect(sliceWithLocalExtension(file(), { profileId: protocol.profiles[1] })).rejects.toThrow("origem ou o hash");
    expect(local.operations()).toContain("slice"); expect(local.operations()).not.toContain("read"); expect(local.operations()).toContain("cancel");
  });
  it("detects through hello and finish without starting slicing or uploading", async () => {
    const local = await host();
    await expect(detectLocalSlicer()).resolves.toEqual(info);
    expect(local.connect).toHaveBeenCalledExactlyOnceWith(protocol.extension_id, { name: "forge-slicer-v1" });
    expect(local.operations()).toEqual(["hello", "finish"]);
    expect(local.port.disconnect).toHaveBeenCalledOnce();
  });
  it("returns unavailable when runtime is missing or the native profile is unsupported", async () => {
    vi.stubGlobal("chrome", undefined);
    await expect(detectLocalSlicer()).resolves.toBeNull();
    const local = await host({ hello: { ...info, profile_id: "unsupported-a2l" } });
    await expect(detectLocalSlicer()).resolves.toBeNull();
    expect(local.operations()).not.toContain("slice");
  });
  it("transfers bounded chunks, checks input and result hashes, and cleans the native session", async () => {
    const local = await host(), progress = vi.fn(), input = new Uint8Array(protocol.chunk_bytes + 3).fill(7);
    const result = await sliceWithLocalExtension(file(input), { onProgress: progress });
    expect(result.file.name).toBe("modelo-fatiado.3mf"); expect(result.file.size).toBe(output.length); expect(result.stats).toEqual(stats);
    const requests = local.port.postMessage.mock.calls.map(([message]) => message);
    expect(requests.find(message => message.op === "begin")).toMatchObject({ name: "modelo.3mf", size: input.length, sha256: await hash(input), profile_id: info.profile_id });
    const chunks = requests.filter(message => message.op === "chunk");
    expect(chunks.map(chunk => [chunk.part, String(chunk.base64).length])).toEqual([[0, 524288], [1, 4]]);
    expect(local.operations()).toEqual(["hello", "begin", "chunk", "chunk", "slice", "read", "finish"]);
    expect(JSON.stringify(requests)).not.toMatch(/access_token|worker_token|supabase|password|public_key/);
    expect(progress).toHaveBeenLastCalledWith(100); expect(local.port.disconnect).toHaveBeenCalledOnce();
  });
  it("cancels and disconnects while slicing, without leaving an unbounded pending request", async () => {
    const local = await host({ slice: null }), controller = new AbortController();
    const slicing = sliceWithLocalExtension(file(), { signal: controller.signal });
    const rejected = expect(slicing).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(local.operations()).toContain("slice"));
    controller.abort(); await rejected;
    expect(local.operations()).toContain("cancel"); expect(local.port.disconnect).toHaveBeenCalledOnce();
  });
  it("rejects a native disconnect during slicing and malformed result sizes before reading", async () => {
    const local = await host({ slice: null });
    const slicing = sliceWithLocalExtension(file());
    const rejected = expect(slicing).rejects.toThrow(/desconectado/);
    await vi.waitFor(() => expect(local.operations()).toContain("slice")); local.disconnect(); await rejected;
    const malformed = await host({ slice: { file_name: "bad.3mf", size: protocol.max_file_bytes + 1, sha256: "a".repeat(64), chunks: 1, stats } });
    await expect(sliceWithLocalExtension(file())).rejects.toThrow(/3MF válido/);
    expect(malformed.operations()).not.toContain("read"); expect(malformed.operations()).toContain("cancel");
  });
  it("rejects corrupt or incomplete output and never returns an unchecked File", async () => {
    await host({ read: { part: 0, base64: "AA==" } });
    await expect(sliceWithLocalExtension(file())).rejects.toThrow(/incompleta/);
    await host({ slice: { file_name: "bad.3mf", size: output.length, sha256: "b".repeat(64), chunks: 1, stats } });
    await expect(sliceWithLocalExtension(file())).rejects.toThrow(/hash/);
    await host({ read: { part: 1, base64: btoa(String.fromCharCode(...output)) } });
    await expect(sliceWithLocalExtension(file())).rejects.toThrow(/Bloco/);
  });
  it("requires statistics to identify this source, output hash and supported profile", async () => {
    await host({ slice: { file_name: "other.3mf", size: output.length, sha256: await hash(output), chunks: 1, stats: { ...stats, input_sha256: "f".repeat(64) } } });
    await expect(sliceWithLocalExtension(file())).rejects.toThrow(/origem ou o hash/);
    await host({ slice: { file_name: "other.3mf", size: output.length, sha256: await hash(output), chunks: 1, stats: { ...stats, profile_id: "other" } } });
    await expect(sliceWithLocalExtension(file())).rejects.toThrow(/origem ou o hash/);
  });
  it("does not connect for an oversized or unsupported input", async () => {
    const local = await host(), oversized = file(); Object.defineProperty(oversized, "size", { value: protocol.max_file_bytes + 1 });
    await expect(sliceWithLocalExtension(oversized)).rejects.toThrow(/até 64 MB/);
    await expect(sliceWithLocalExtension(file(output, "model.obj"))).rejects.toThrow(/STL ou 3MF/);
    expect(local.connect).not.toHaveBeenCalled();
  });
});
