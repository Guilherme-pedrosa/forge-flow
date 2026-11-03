import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductExternalImport } from "./makerworld-import";
import { downloadMakerWorldProject, makerWorldProjectPending, makerWorldPublicProjects, MAX_MAKERWORLD_PROJECT_BYTES, publicMakerWorldProjectUrl } from "./makerworld-project";

const url = "https://makerworld.bblmw.com/makerworld/model/project/model.3mf";
const project = { name: "Natal.3mf", url, sizeBytes: null };
const reference = (files: unknown[]) => ({ files }) as ProductExternalImport;
const response = (bytes: Uint8Array = new Uint8Array([80, 75, 3, 4, 42]), headers: Record<string, string> = {}) => new Response(bytes.slice().buffer as ArrayBuffer, { status: 200, headers });
afterEach(() => vi.restoreAllMocks());

describe("public MakerWorld project acquisition", () => {
  it("uses only an explicit public 3MF URL supplied by the source and deduplicates it", () => {
    const file = { ...project, size_bytes: 123, download_available: true };
    expect(makerWorldPublicProjects(reference([file, file, { ...file, url: null }, { ...file, name: "photo.png" }]))).toEqual([{ ...project, sizeBytes: 123 }]);
    expect(makerWorldProjectPending(reference([{ name: "Natal.3mf", url: null }]))).toMatch(/não disponibilizou um download público/);
  });
  it.each(["http://makerworld.bblmw.com/makerworld/model/a.3mf", "https://makerworld.bblmw.com.evil.test/makerworld/model/a.3mf", "https://user:secret@makerworld.bblmw.com/makerworld/model/a.3mf", "https://makerworld.bblmw.com:444/makerworld/model/a.3mf", "https://makerworld.com/login/a.3mf", "https://makerworld.bblmw.com/makerworld/model/a.3mf#other", "https://makerworld.bblmw.com/api/a.3mf", "https://127.0.0.1/makerworld/model/a.3mf"])("rejects non-public project location %s", value => {
    expect(publicMakerWorldProjectUrl(value)).toBeNull();
  });
  it("downloads actual project bytes without credentials, redirects or proxying", async () => {
    const fetcher = vi.fn().mockResolvedValue(response());
    const file = await downloadMakerWorldProject(project, undefined, fetcher);
    expect(file.name).toBe("Natal.3mf"); expect(file.size).toBe(5);
    expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({ mode: "cors", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" }));
  });
  it("rejects authentication pages, corrupt ZIPs and truncated responses", async () => {
    await expect(downloadMakerWorldProject(project, undefined, vi.fn().mockResolvedValue(response(undefined, { "content-type": "text/html" })))) .rejects.toThrow(/outro formato/);
    await expect(downloadMakerWorldProject(project, undefined, vi.fn().mockResolvedValue(response(new Uint8Array([1, 2, 3, 4]))))).rejects.toThrow(/3MF válido/);
    await expect(downloadMakerWorldProject(project, undefined, vi.fn().mockResolvedValue(response(undefined, { "content-length": "10" })))).rejects.toThrow(/incompleta/);
  });
  it("stops oversized or cancelled downloads and explains CORS failures", async () => {
    const fetcher = vi.fn();
    await expect(downloadMakerWorldProject({ ...project, sizeBytes: MAX_MAKERWORLD_PROJECT_BYTES + 1 }, undefined, fetcher)).rejects.toThrow(/64 MB/);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(downloadMakerWorldProject(project, undefined, vi.fn().mockResolvedValue(response(undefined, { "content-length": String(MAX_MAKERWORLD_PROJECT_BYTES + 1) })))).rejects.toThrow(/64 MB/);
    const controller = new AbortController(); controller.abort();
    await expect(downloadMakerWorldProject(project, controller.signal, fetcher)).rejects.toHaveProperty("name", "AbortError");
    await expect(downloadMakerWorldProject(project, undefined, vi.fn().mockRejectedValue(new TypeError("CORS")))).rejects.toThrow(/rede ou CORS/);
  });
});
