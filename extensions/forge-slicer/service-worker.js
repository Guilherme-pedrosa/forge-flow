import { PROTOCOL, allowedSender, validateRequest } from "./protocol.js";

let active = null;

/** Relay bytes only while the user has an active operation. No alarms, idle
 * polls, remote fetches, account cookies or stored model files. */
export function attachClient(client, internal, api = chrome) {
  if (client.name !== "forge-slicer-v1" || !allowedSender(client.sender, internal)) { client.disconnect(); return; }
  let native = null, closed = false, deadline;
  const pending = new Map();
  function send(value) { if (!closed) { try { client.postMessage(value); } catch { close(); } } }
  function close() {
    if (closed) return;
    closed = true; clearTimeout(deadline); pending.clear();
    if (active === client) active = null;
    try { native?.disconnect(); } catch { /* already gone */ }
    try { client.disconnect(); } catch { /* already gone */ }
  }
  client.onDisconnect.addListener(close);
  client.onMessage.addListener(message => {
    let request;
    try {
      request = validateRequest(message);
      if (active && active !== client) throw new Error("O fatiador está em uso. Aguarde a simulação atual.");
      if (pending.has(request.id) || pending.size && request.op !== "cancel") throw new Error("Aguarde o bloco anterior.");
      if (!native) {
        active = client;
        native = api.runtime.connectNative(PROTOCOL.host_name);
        deadline = setTimeout(() => {
          for (const [id] of pending) send({ id, ok: false, error: "A operação local ultrapassou o tempo limite." });
          close();
        }, 660000);
        native.onMessage.addListener(response => {
          if (closed || !response || typeof response !== "object") return;
          if (response.event === "progress") { send({ event: "progress", progress: Number(response.progress) || 0 }); return; }
          const operation = pending.get(response.id);
          if (!operation || typeof response.ok !== "boolean") return;
          pending.delete(response.id); send(response);
          if (["finish", "cancel"].includes(operation)) close();
        });
        native.onDisconnect.addListener(() => {
          // Reading lastError consumes Chrome's native-host error without
          // forwarding system paths or private configuration to the page.
          void api.runtime.lastError;
          for (const [id] of pending) send({ id, ok: false, error: "O conector local foi encerrado ou ainda não está instalado. Instale o conector e tente novamente." });
          close();
        });
      }
      pending.set(request.id, request.op);
      native.postMessage(request);
    } catch (error) {
      send({ id: typeof message?.id === "string" ? message.id : "invalid", ok: false, error: error.message || "Falha na conexão local." });
      if (!native || request?.op === "cancel") close();
    }
  });
}

if (typeof chrome !== "undefined" && chrome.runtime) {
  chrome.runtime.onConnectExternal.addListener(client => attachClient(client, false));
  chrome.runtime.onConnect.addListener(client => attachClient(client, true));
}
