const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const state = { user: null, bills: [], cards: [], adminUsers: [], subscription: null, notificationPreferences: null };
let deferredInstallPrompt = null;
const installDismissedKey = "ricoxp-install-dismissed-at-v2";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const els = {
  loginScreen: $("#loginScreen"), appScreen: $("#appScreen"), loginForm: $("#loginForm"), registerForm: $("#registerForm"),
  authMessage: $("#authMessage"), appMessage: $("#appMessage"), monthFilter: $("#monthFilter"), profileFilter: $("#profileFilter"),
  billForm: $("#billForm"), cardForm: $("#cardForm"), notificationForm: $("#notificationForm"), cancelEditButton: $("#cancelEditButton"), financeFilters: $("#financeFilters"),
};

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !url.includes("/login") && !url.includes("/register")) showAuth();
    throw new Error(body.error || "Não foi possível concluir a operação.");
  }
  return body;
}

function setMessage(target, text = "", success = false) {
  target.textContent = text;
  target.classList.toggle("success", success);
}

function showAuth() {
  state.user = null;
  els.loginScreen.classList.remove("hidden");
  els.appScreen.classList.add("hidden");
  setTimeout(showInstallPrompt, 900);
}

async function enterApp(user) {
  state.user = user;
  $("#userBadge").textContent = `${user.identifierLabel}${user.role === "admin" ? " · Administrador" : ""}`;
  $("#adminNav").classList.toggle("hidden", user.role !== "admin");
  els.loginScreen.classList.add("hidden");
  els.appScreen.classList.remove("hidden");
  await Promise.all([loadData(), loadSubscription(), loadNotificationPreferences()]);
  if (new URLSearchParams(location.search).get("assinatura") === "retorno") {
    history.replaceState({}, "", location.pathname);
    await loadSubscription(true);
    switchView("subscription", "Assinatura");
  } else if (new URLSearchParams(location.search).get("abrir") === "lembretes") {
    history.replaceState({}, "", location.pathname);
    switchView("reminders", "Lembretes");
  } else switchView("dashboard", "Painel");
  setTimeout(showInstallPrompt, 900);
}

function isStandalone() { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; }
function isIos() { return /iphone|ipad|ipod/i.test(navigator.userAgent); }
function isMobileScreen() { return window.matchMedia("(max-width: 820px)").matches; }
function installPromptRecentlyDismissed() {
  try {
    const dismissedAt = Number(localStorage.getItem(installDismissedKey) || 0);
    return dismissedAt && Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000;
  } catch { return false; }
}
function showInstallPrompt() {
  if (isStandalone() || !isMobileScreen() || installPromptRecentlyDismissed()) return;
  if (!deferredInstallPrompt && !isIos()) return;
  $("#installAppButton").textContent = isIos() ? "Como instalar" : "Instalar aplicativo";
  $("#installAppButton").classList.remove("hidden");
  $("#installPrompt").classList.remove("hidden");
}
function hideInstallPrompt(remember = false) {
  $("#installPrompt").classList.add("hidden");
  $("#iosInstallSteps").classList.add("hidden");
  if (remember) try { localStorage.setItem(installDismissedKey, String(Date.now())); } catch {}
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  showInstallPrompt();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  try { localStorage.removeItem(installDismissedKey); } catch {}
  hideInstallPrompt();
});

async function loadData() {
  const data = await api("/api/data");
  state.bills = data.bills;
  state.cards = data.cards;
  render();
}

async function loadSubscription(sync = false) {
  state.subscription = await api(sync ? "/api/subscription/sync" : "/api/subscription", sync ? { method: "POST" } : {});
  renderSubscription();
}

async function loadNotificationPreferences() {
  state.notificationPreferences = await api("/api/notifications/preferences");
  renderNotificationPreferences();
}

function renderNotificationPreferences() {
  const preferences = state.notificationPreferences;
  if (!preferences) return;
  $("#reminderDays").value = preferences.reminderDays || 2;
  const supported = pushSupported();
  const permissionDenied = supported && Notification.permission === "denied";
  $("#pushEnabled").checked = preferences.pushEnabled;
  $("#pushEnabled").disabled = !preferences.available || !preferences.configured || !supported || permissionDenied;
  $("#pushStatus").textContent = preferences.pushEnabled ? "Ativado" : "Desativado";
  $("#pushStatus").className = `badge ${preferences.pushEnabled ? "active" : "inactive"}`;
  $("#pushHelp").textContent = "No iPhone, adicione o sistema à Tela de Início antes de ativar.";
  if (!preferences.available) $("#pushStatus").textContent = "Disponível no Pro";
  else if (!preferences.configured) $("#pushStatus").textContent = "Aguardando configuração";
  else if (!supported) { $("#pushStatus").textContent = "Não compatível"; $("#pushHelp").textContent = "Este navegador não oferece notificações push."; }
  else if (permissionDenied) { $("#pushStatus").textContent = "Bloqueado"; $("#pushHelp").textContent = "Libere as notificações nas configurações do navegador ou do aparelho."; }
}

function renderSubscription() {
  const subscription = state.subscription;
  if (!subscription) return;
  const isPro = subscription.plan === "pro";
  const labels = { authorized: "Ativa", pending: "Aguardando pagamento", paused: "Pausada", cancelled: "Cancelada" };
  $("#subscriptionTitle").textContent = isPro ? "Plano Pro" : "Plano Grátis";
  $("#subscriptionDescription").textContent = isPro ? `Recursos ilimitados${subscription.nextPaymentDate ? ` · próxima cobrança em ${new Date(subscription.nextPaymentDate).toLocaleDateString("pt-BR")}` : ""}.` : "Faça o upgrade para cadastrar contas e cartões sem limites.";
  $("#subscriptionBadge").textContent = labels[subscription.status] || (isPro ? "Ativa" : "Grátis");
  $("#subscriptionBadge").className = `badge ${isPro ? "active" : subscription.status === "pending" ? "pending" : "inactive"}`;
  $("#billingEmail").value = subscription.payerEmail || (state.user.identifierType === "email" ? state.user.identifierLabel : "");
  $("#subscriptionForm").classList.toggle("hidden", isPro || subscription.status === "pending");
  $("#cancelSubscription").classList.toggle("hidden", !subscription.status || subscription.status === "cancelled" || state.user.role === "admin");
  $("#syncSubscription").classList.toggle("hidden", !subscription.status);
  $("#subscribeButton").disabled = !subscription.configured;
  if (!subscription.configured && !isPro) $("#subscriptionDescription").textContent = "O checkout estará disponível assim que a integração do Mercado Pago for ativada.";
  $(".plan-option:first-child").classList.toggle("current", !isPro);
  $(".plan-option.featured").classList.toggle("current", isPro);
  $(".plan-option:first-child .plan-label").textContent = isPro ? "Plano disponível" : "Plano atual";
  $(".plan-option.featured .plan-label").textContent = isPro ? "Plano atual" : "Mais completo";
}

function getFilteredBills() {
  const month = els.monthFilter.value;
  const profile = els.profileFilter.value;
  return state.bills.filter((bill) => bill.dueDate.startsWith(month)).filter((bill) => profile === "all" || bill.profile === profile).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function billSituation(bill) {
  if (bill.status === "paid") return "paid";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${bill.dueDate}T00:00:00`) < today ? "overdue" : "pending";
}

function render() {
  renderMetrics();
  renderChart();
  renderLists();
  renderTable();
  renderCards();
  renderForecast();
}

function renderMetrics() {
  const bills = getFilteredBills();
  const groups = {
    total: bills,
    paid: bills.filter((bill) => billSituation(bill) === "paid"),
    pending: bills.filter((bill) => billSituation(bill) === "pending"),
    overdue: bills.filter((bill) => billSituation(bill) === "overdue"),
  };
  setMetric(groups.total, "#metricTotal", "#metricTotalCount");
  setMetric(groups.paid, "#metricPaid", "#metricPaidCount");
  setMetric(groups.pending, "#metricPending", "#metricPendingCount");
  setMetric(groups.overdue, "#metricOverdue", "#metricOverdueCount");
}

function setMetric(items, valueSelector, countSelector) {
  $(valueSelector).textContent = money.format(items.reduce((sum, bill) => sum + Number(bill.amount), 0));
  $(countSelector).textContent = `${items.length} ${items.length === 1 ? "conta" : "contas"}`;
}

function renderChart() {
  const canvas = $("#statusChart");
  const ctx = canvas.getContext("2d");
  const bills = getFilteredBills();
  const values = [
    { value: sumByStatus(bills, "paid"), color: "#209869" },
    { value: sumByStatus(bills, "pending"), color: "#d8911c" },
    { value: sumByStatus(bills, "overdue"), color: "#cf3f3f" },
  ];
  const total = values.reduce((sum, entry) => sum + entry.value, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#eef3f2";
  ctx.beginPath(); ctx.arc(140, 140, 105, 0, Math.PI * 2); ctx.fill();
  let start = -Math.PI / 2;
  values.filter((entry) => entry.value > 0).forEach((entry) => {
    const angle = total ? (entry.value / total) * Math.PI * 2 : 0;
    ctx.beginPath(); ctx.moveTo(140, 140); ctx.arc(140, 140, 105, start, start + angle); ctx.closePath(); ctx.fillStyle = entry.color; ctx.fill(); start += angle;
  });
  ctx.beginPath(); ctx.arc(140, 140, 62, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
  const paidValue = values[0].value;
  const percent = total ? Math.round((paidValue / total) * 100) : 0;
  ctx.fillStyle = "#17211f"; ctx.font = "700 22px Arial"; ctx.textAlign = "center"; ctx.fillText(`${percent}%`, 140, 135);
  ctx.font = "12px Arial"; ctx.fillStyle = "#64716e"; ctx.fillText("pago", 140, 154);
  $("#paidPercent").textContent = `${percent}% pago`;
}

function sumByStatus(bills, status) {
  return bills.filter((bill) => billSituation(bill) === status).reduce((sum, bill) => sum + Number(bill.amount), 0);
}

function renderLists() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = getFilteredBills().filter((bill) => billSituation(bill) !== "paid").map((bill) => ({ ...bill, days: Math.ceil((new Date(`${bill.dueDate}T00:00:00`) - today) / 86400000) })).sort((a, b) => a.days - b.days);
  drawRows("#upcomingList", upcoming.filter((bill) => bill.days <= 7).slice(0, 6), "Nenhuma conta vencendo nos próximos 7 dias.");
  drawRows("#reminderList", upcoming, "Nenhum lembrete pendente para este filtro.");
}

function drawRows(selector, bills, emptyText) {
  const container = $(selector);
  if (!bills.length) { container.innerHTML = `<p class="muted">${emptyText}</p>`; return; }
  container.innerHTML = bills.map((bill) => {
    const situation = billSituation(bill);
    const text = situation === "overdue" ? `Venceu há ${Math.abs(bill.days)} dia(s)` : `Vence em ${bill.days} dia(s)`;
    return `<div class="list-row"><div><strong>${escapeHtml(bill.name)}</strong><small>${bill.profile} · ${formatDate(bill.dueDate)} · ${money.format(Number(bill.amount))}</small></div><span class="badge ${situation}">${text}</span></div>`;
  }).join("");
}

function renderForecast() {
  const profile = els.profileFilter.value;
  const months = Array.from({ length: 6 }, (_, index) => {
    const key = monthKeyFromOffset(els.monthFilter.value, index + 1);
    const bills = state.bills.filter((bill) => bill.dueDate.startsWith(key) && (profile === "all" || bill.profile === profile));
    return { key, count: bills.length, total: bills.reduce((sum, bill) => sum + Number(bill.amount), 0) };
  });
  const max = Math.max(...months.map((item) => item.total), 1);
  $("#forecastList").innerHTML = months.map((item) => `<div class="forecast-row"><span>${new Date(`${item.key}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}</span><div class="forecast-track"><i style="width:${Math.round((item.total / max) * 100)}%"></i></div><strong>${money.format(item.total)}</strong><small>${item.count} ${item.count === 1 ? "conta" : "contas"}</small></div>`).join("");
}

function renderTable() {
  const bills = getFilteredBills();
  $("#billTable").innerHTML = bills.length ? bills.map((bill) => {
    const situation = billSituation(bill);
    const tags = bill.tags?.length ? bill.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("") : '<span class="muted">-</span>';
    const cloneButton = bill.seriesType === "installment" ? "" : `<button class="small-button" data-action="clone" data-id="${bill.id}" type="button">Clonar mês</button>`;
    return `<tr><td>${escapeHtml(bill.name)}</td><td><div class="tag-list">${tags}</div></td><td>${bill.profile}</td><td>${money.format(Number(bill.amount))}</td><td>${formatDate(bill.dueDate)}</td><td><span class="badge ${situation}">${statusLabel(situation)}</span></td><td><div class="row-actions"><button class="small-button" data-action="toggle" data-id="${bill.id}" type="button">${bill.status === "paid" ? "Reabrir" : "Pagar"}</button>${cloneButton}<button class="small-button" data-action="edit" data-id="${bill.id}" type="button">Editar</button><button class="small-button" data-action="delete" data-id="${bill.id}" type="button">Excluir</button></div></td></tr>`;
  }).join("") : '<tr><td colspan="7">Nenhuma conta cadastrada para este período.</td></tr>';
}

function renderCards() {
  const profile = els.profileFilter.value;
  const cards = state.cards.filter((card) => profile === "all" || card.profile === profile);
  $("#cardList").innerHTML = cards.length ? cards.map((card) => {
    const used = getFilteredBills().filter((bill) => bill.category === "Cartao" && bill.name.toLowerCase().includes(card.name.split(" ")[0].toLowerCase())).reduce((sum, bill) => sum + Number(bill.amount), 0);
    const percent = Math.min(100, Math.round((used / Number(card.limit || 1)) * 100));
    return `<article class="card-item"><div><strong>${escapeHtml(card.name)}</strong><p class="muted">${card.profile} · vence dia ${card.dueDay} · fecha dia ${card.closeDay}</p></div><div class="progress"><span style="width:${percent}%"></span></div><small>${money.format(used)} usado de ${money.format(Number(card.limit))}</small><button class="small-button" data-card-delete="${card.id}" type="button">Excluir cartão</button></article>`;
  }).join("") : '<section class="panel"><p class="muted">Nenhum cartão cadastrado.</p></section>';
}

function resetBillForm() {
  els.billForm.reset();
  $("#billId").value = "";
  $("#billDueDate").value = `${els.monthFilter.value}-10`;
  $("#billInstallments").value = "1";
  $("#billInstallments").disabled = false;
  els.cancelEditButton.classList.add("hidden");
}

function switchView(view, title) {
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((item) => item.classList.remove("active-view"));
  $(`#${view}View`).classList.add("active-view");
  $("#pageTitle").textContent = title;
  els.financeFilters.classList.toggle("hidden", view === "admin" || view === "subscription");
  if (view === "admin") loadAdmin();
  if (view === "subscription") loadSubscription();
  if (view === "reminders") loadNotificationPreferences();
}

async function loadAdmin() {
  if (state.user?.role !== "admin") return;
  try {
    const [overview, usersData] = await Promise.all([api("/api/admin/overview"), api("/api/admin/users")]);
    state.adminUsers = usersData.users;
    $("#adminUsers").textContent = overview.users;
    $("#adminActiveText").textContent = `${overview.activeUsers} ativos`;
    $("#adminProUsers").textContent = overview.proUsers;
    $("#adminBills").textContent = overview.bills;
    $("#adminTotal").textContent = money.format(Number(overview.totalAmount));
    renderAdminUsers();
  } catch (error) { setMessage(els.appMessage, error.message); }
}

function renderAdminUsers() {
  $("#adminUserTable").innerHTML = state.adminUsers.map((user) => `<tr><td>${escapeHtml(user.identifierLabel)}</td><td>${user.role === "admin" ? "Administrador" : "Usuário"}</td><td><span class="badge ${user.plan === "pro" ? "active" : "inactive"}">${user.plan === "pro" ? "Pro" : "Grátis"}</span></td><td>${new Date(user.createdAt).toLocaleDateString("pt-BR")}</td><td>${user.billCount}</td><td>${money.format(Number(user.totalAmount))}</td><td><span class="badge ${user.active ? "active" : "inactive"}">${user.active ? "Ativo" : "Inativo"}</span></td><td><div class="row-actions"><button class="small-button" data-admin-view="${user.id}" type="button">Ver financeiro</button>${user.id === state.user.id ? "" : `<button class="small-button" data-admin-status="${user.id}" data-active="${!user.active}" type="button">${user.active ? "Desativar" : "Ativar"}</button>`}</div></td></tr>`).join("");
}

async function showAdminUser(id) {
  const data = await api(`/api/admin/users/${id}/data`);
  $("#adminDetailTitle").textContent = `Financeiro de ${data.user.identifierLabel}`;
  const billRows = data.bills.length ? data.bills.map((bill) => `<tr><td>${escapeHtml(bill.name)}</td><td>${bill.profile}</td><td>${money.format(Number(bill.amount))}</td><td>${formatDate(bill.dueDate)}</td><td>${statusLabel(billSituation(bill))}</td></tr>`).join("") : '<tr><td colspan="5">Nenhum lançamento.</td></tr>';
  $("#adminDetailContent").innerHTML = `<div class="admin-detail-grid"><div><h3>Contas</h3><div class="table-wrap"><table><thead><tr><th>Nome</th><th>Perfil</th><th>Valor</th><th>Vencimento</th><th>Status</th></tr></thead><tbody>${billRows}</tbody></table></div></div><div><h3>Cartões</h3><p>${data.cards.length} cartão(ões) cadastrado(s).</p></div></div>`;
  $("#adminUserDetail").classList.remove("hidden");
}

function exportCsv() {
  const rows = [["Nome", "Perfil", "Categoria", "Valor", "Vencimento", "Status"]];
  getFilteredBills().forEach((bill) => rows.push([bill.name, bill.profile, bill.category, bill.amount, bill.dueDate, statusLabel(billSituation(bill))]));
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `contas-${els.monthFilter.value}.csv`; link.click(); URL.revokeObjectURL(url);
}

function monthKeyFromOffset(value, offset) { const [year, month] = value.split("-").map(Number); const date = new Date(year, month - 1 + offset, 1, 12); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function formatDate(value) { return new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR"); }
function statusLabel(status) { return { paid: "Pago", pending: "A vencer", overdue: "Vencida" }[status]; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }

$$('[data-auth-view]').forEach((button) => button.addEventListener("click", () => {
  $$('[data-auth-view]').forEach((item) => item.classList.toggle("active", item === button));
  els.loginForm.classList.toggle("hidden", button.dataset.authView !== "login");
  els.registerForm.classList.toggle("hidden", button.dataset.authView !== "register");
  setMessage(els.authMessage);
}));

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault(); setMessage(els.authMessage);
  try {
    const result = await api("/api/login", { method: "POST", body: JSON.stringify({ identifier: $("#loginIdentifier").value, password: $("#loginPassword").value }) });
    await enterApp(result.user);
  } catch (error) { setMessage(els.authMessage, error.message); }
});

els.registerForm.addEventListener("submit", async (event) => {
  event.preventDefault(); setMessage(els.authMessage);
  if ($("#registerPassword").value !== $("#registerPasswordConfirm").value) { setMessage(els.authMessage, "As senhas não coincidem."); return; }
  try {
    const result = await api("/api/register", { method: "POST", body: JSON.stringify({ identifier: $("#registerIdentifier").value, password: $("#registerPassword").value }) });
    await enterApp(result.user);
  } catch (error) { setMessage(els.authMessage, error.message); }
});

$("#logoutButton").addEventListener("click", async () => { await api("/api/logout", { method: "POST" }).catch(() => {}); showAuth(); });
$("#dismissInstallButton").addEventListener("click", () => hideInstallPrompt(true));
$("#installAppButton").addEventListener("click", async () => {
  if (isIos()) {
    $("#iosInstallSteps").classList.remove("hidden");
    $("#installAppButton").classList.add("hidden");
    return;
  }
  if (!deferredInstallPrompt) return;
  await deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  hideInstallPrompt(choice.outcome !== "accepted");
});
$$('[data-view]').forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view, button.textContent.trim())));
els.monthFilter.addEventListener("change", () => { resetBillForm(); render(); });
els.profileFilter.addEventListener("change", render);
$("#exportButton").addEventListener("click", exportCsv);
els.cancelEditButton.addEventListener("click", resetBillForm);

els.billForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#billId").value;
  const bill = { name: $("#billName").value.trim(), amount: Number($("#billAmount").value), dueDate: $("#billDueDate").value, profile: $("#billProfile").value, category: $("#billCategory").value, status: $("#billStatus").value, tags: $("#billTags").value.split(",").map((tag) => tag.trim()).filter(Boolean), installments: Number($("#billInstallments").value) };
  try {
    await api(id ? `/api/bills/${id}` : "/api/bills", { method: id ? "PUT" : "POST", body: JSON.stringify(bill) });
    await loadData(); resetBillForm(); setMessage(els.appMessage, "Conta salva.", true);
  } catch (error) { setMessage(els.appMessage, error.message); }
});

$("#billTable").addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const bill = state.bills.find((item) => item.id === button.dataset.id);
  if (!bill) return;
  if (button.dataset.action === "edit") {
    $("#billId").value = bill.id; $("#billName").value = bill.name; $("#billAmount").value = bill.amount; $("#billDueDate").value = bill.dueDate; $("#billProfile").value = bill.profile; $("#billCategory").value = bill.category; $("#billStatus").value = bill.status; $("#billTags").value = (bill.tags || []).join(", "); $("#billInstallments").value = "1"; $("#billInstallments").disabled = true; els.cancelEditButton.classList.remove("hidden"); return;
  }
  try {
    if (button.dataset.action === "delete") await api(`/api/bills/${bill.id}`, { method: "DELETE" });
    if (button.dataset.action === "toggle") await api(`/api/bills/${bill.id}`, { method: "PUT", body: JSON.stringify({ ...bill, status: bill.status === "paid" ? "pending" : "paid" }) });
    if (button.dataset.action === "clone") { const cloned = await api(`/api/bills/${bill.id}/clone`, { method: "POST" }); setMessage(els.appMessage, `Conta clonada para ${formatDate(cloned.dueDate)}.`, true); }
    await loadData();
  } catch (error) { setMessage(els.appMessage, error.message); }
});

els.cardForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const card = { name: $("#cardName").value.trim(), limit: Number($("#cardLimit").value), closeDay: Number($("#cardCloseDay").value), dueDay: Number($("#cardDueDay").value), profile: $("#cardProfile").value };
  try { await api("/api/cards", { method: "POST", body: JSON.stringify(card) }); await loadData(); els.cardForm.reset(); setMessage(els.appMessage, "Cartão salvo.", true); } catch (error) { setMessage(els.appMessage, error.message); }
});

$("#cardList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-card-delete]");
  if (!button) return;
  try { await api(`/api/cards/${button.dataset.cardDelete}`, { method: "DELETE" }); await loadData(); } catch (error) { setMessage(els.appMessage, error.message); }
});

els.notificationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const pushEnabled = $("#pushEnabled").checked;
    if (pushEnabled) await subscribeToPush(state.notificationPreferences.publicKey);
    else await unsubscribeFromPush();
    state.notificationPreferences = await api("/api/notifications/preferences", { method: "PUT", body: JSON.stringify({ pushEnabled, reminderDays: Number($("#reminderDays").value) }) });
    renderNotificationPreferences();
    setMessage(els.appMessage, "Preferências de alerta salvas.", true);
  } catch (error) { setMessage(els.appMessage, error.message); }
});

function pushSupported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }

async function subscribeToPush(publicKey) {
  if (!pushSupported()) throw new Error("Este navegador não oferece notificações push.");
  if (!publicKey) throw new Error("Notificações push ainda não configuradas.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permita as notificações para receber os lembretes.");
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  await api("/api/notifications/subscriptions", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
}

async function unsubscribeFromPush() {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await api("/api/notifications/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {});
  await subscription.unsubscribe();
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

$("#subscriptionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage(els.appMessage);
  try {
    const result = await api("/api/subscription/checkout", { method: "POST", body: JSON.stringify({ payerEmail: $("#billingEmail").value }) });
    location.href = result.checkoutUrl;
  } catch (error) { setMessage(els.appMessage, error.message); }
});
$("#syncSubscription").addEventListener("click", async () => {
  try { await loadSubscription(true); setMessage(els.appMessage, "Situação da assinatura atualizada.", true); } catch (error) { setMessage(els.appMessage, error.message); }
});
$("#cancelSubscription").addEventListener("click", async () => {
  if (!confirm("Cancelar a renovação do plano Pro?")) return;
  try { state.subscription = await api("/api/subscription/cancel", { method: "POST" }); renderSubscription(); setMessage(els.appMessage, "Assinatura cancelada.", true); } catch (error) { setMessage(els.appMessage, error.message); }
});

$("#refreshAdmin").addEventListener("click", loadAdmin);
$("#closeAdminDetail").addEventListener("click", () => $("#adminUserDetail").classList.add("hidden"));
$("#adminUserTable").addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-admin-view]");
  const statusButton = event.target.closest("[data-admin-status]");
  try {
    if (viewButton) await showAdminUser(viewButton.dataset.adminView);
    if (statusButton) { await api(`/api/admin/users/${statusButton.dataset.adminStatus}/status`, { method: "PATCH", body: JSON.stringify({ active: statusButton.dataset.active === "true" }) }); await loadAdmin(); }
  } catch (error) { setMessage(els.appMessage, error.message); }
});

els.monthFilter.value = new Date().toISOString().slice(0, 7);
$("#todayLabel").textContent = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
resetBillForm();
api("/api/session").then((result) => enterApp(result.user)).catch(showAuth);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(() => {});
