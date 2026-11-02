import { PROTOCOL, makerLink } from "./protocol.js";

const status = document.getElementById("status"), check = document.getElementById("check");
let makerUrl = "";
chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
  makerUrl = makerLink(tabs[0]?.url || "");
  document.getElementById("maker-notice").hidden = !makerUrl;
}).catch(() => { /* The page URL is optional; no other browsing data is read. */ });
document.getElementById("open-forge").addEventListener("click", () => {
  const url = new URL("/comercial/produtos", PROTOCOL.allowed_origins[0]);
  url.searchParams.set("novo", "1"); url.searchParams.set("aba", "producao");
  if (makerUrl) url.searchParams.set("makerworld", makerUrl);
  void chrome.tabs.create({ url: url.href });
});
check.addEventListener("click", () => {
  check.disabled = true; status.textContent = "Conferindo conector local…";
  const client = chrome.runtime.connect({ name: "forge-slicer-v1" });
  const id = crypto.randomUUID(); let complete = false;
  const finish = text => {
    if (complete) return; complete = true; clearTimeout(timer); status.textContent = text; check.disabled = false;
    try { client.disconnect(); } catch { /* already closed */ }
  };
  const timer = setTimeout(() => finish("Conector indisponível. Instale o pacote e tente novamente."), 10000);
  client.onMessage.addListener(response => {
    if (response.id !== id || complete) return;
    finish(response.ok ? `Conectado · Bambu Studio ${response.engine_version || ""}. Pronto para fatiar pelo Forge.` : response.error || "Instale o conector local.");
  });
  client.onDisconnect.addListener(() => { void chrome.runtime.lastError; finish("Conector indisponível. Instale o pacote e tente novamente."); });
  client.postMessage({ id, op: "hello" });
});
