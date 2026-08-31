"use strict";

const vscode = acquireVsCodeApi();
const $ = (selector) => document.querySelector(selector);
const state = { models: [], sessions: [], history: [], model: "", sessionID: "", mode: "build", contextKind: "none", busy: false };

function option(select, value, label, selected) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  element.selected = selected;
  select.appendChild(element);
}

function renderSelectors() {
  const session = $("#session");
  const model = $("#model");
  session.replaceChildren();
  model.replaceChildren();
  if (!state.sessions.length) option(session, "", "No sessions yet", true);
  state.sessions.forEach((item) => option(session, item.id, item.title, item.id === state.sessionID));
  if (!state.models.length) option(model, "", "No connected models", true);
  state.models.forEach((item) => option(model, item.value, `${item.label} · ${item.provider}`, item.value === state.model));
}

function renderButtons() {
  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
  document.querySelectorAll("[data-context]").forEach((button) => button.classList.toggle("active", button.dataset.context === state.contextKind));
  $("#send").hidden = state.busy;
  $("#stop").hidden = !state.busy;
  $("#prompt").disabled = state.busy;
}

function messageElement(message) {
  const article = document.createElement("article");
  article.className = `message ${message.role}`;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = message.role === "user" ? "YOU" : `SENESCHAL${message.model ? ` · ${message.model}` : ""}`;
  article.appendChild(meta);
  for (const text of message.blocks || []) {
    const block = document.createElement(text.startsWith("Tool ·") ? "code" : "p");
    block.textContent = text;
    article.appendChild(block);
  }
  return article;
}

function renderHistory() {
  const history = $("#history");
  history.replaceChildren();
  if (!state.history.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Ask Seneschal to explain, edit, test, or plan work in this project.";
    history.appendChild(empty);
    return;
  }
  state.history.forEach((message) => history.appendChild(messageElement(message)));
  history.scrollTop = history.scrollHeight;
}

function renderNotice(message, kind = "info") {
  const notice = $("#notice");
  notice.hidden = !message;
  notice.className = kind;
  notice.textContent = message || "";
}

function send() {
  const prompt = $("#prompt");
  const text = prompt.value.trim();
  if (!text || state.busy) return;
  prompt.value = "";
  vscode.postMessage({ type: "send", text });
}

window.addEventListener("message", ({ data }) => {
  if (data.type === "error") return renderNotice(data.message, "error");
  if (data.type === "optimistic") {
    state.history.push({ role: "user", blocks: [data.text] });
    state.busy = true;
    renderHistory();
    renderButtons();
    return;
  }
  if (data.type !== "state") return;
  Object.assign(state, data);
  $("#project").textContent = data.project || "Seneschal";
  renderSelectors();
  renderButtons();
  renderHistory();
  renderNotice(data.approvals ? `${data.approvals} approval request${data.approvals === 1 ? "" : "s"} waiting in Seneschal.` : "", data.approvals ? "approval" : "info");
});

$("#refresh").addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
$("#newSession").addEventListener("click", () => vscode.postMessage({ type: "newSession" }));
$("#session").addEventListener("change", (event) => vscode.postMessage({ type: "chooseSession", value: event.target.value }));
$("#model").addEventListener("change", (event) => vscode.postMessage({ type: "chooseModel", value: event.target.value }));
document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => vscode.postMessage({ type: "mode", value: button.dataset.mode })));
document.querySelectorAll("[data-context]").forEach((button) => button.addEventListener("click", () => vscode.postMessage({ type: "context", value: button.dataset.context })));
$("#open").addEventListener("click", () => vscode.postMessage({ type: "open" }));
$("#review").addEventListener("click", () => vscode.postMessage({ type: "review" }));
$("#stop").addEventListener("click", () => vscode.postMessage({ type: "stop" }));
$("#send").addEventListener("click", send);
$("#prompt").addEventListener("keydown", (event) => { if (event.ctrlKey && event.key === "Enter") { event.preventDefault(); send(); } });
vscode.postMessage({ type: "ready" });
