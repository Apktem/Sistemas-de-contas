const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const decimalMoney = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shoppingCatalog = {
  "Mercearia": { icon: "🛒", items: ["Arroz", "Feijão", "Macarrão", "Óleo", "Açúcar", "Café"] },
  "Carnes e peixes": { icon: "🥩", items: ["Carne bovina", "Frango", "Peixe", "Linguiça"] },
  "Hortifruti": { icon: "🥦", items: ["Banana", "Maçã", "Tomate", "Batata", "Cebola", "Alface"] },
  "Bebidas": { icon: "🥤", items: ["Água", "Coca-Cola", "Pepsi", "Fanta", "Suco"] },
  "Padaria": { icon: "🍞", items: ["Pão", "Bolo", "Biscoito", "Torrada"] },
  "Laticínios": { icon: "🥛", items: ["Leite", "Queijo", "Iogurte", "Manteiga"] },
  "Limpeza": { icon: "🧽", items: ["Detergente", "Sabão", "Desinfetante", "Água sanitária"] },
  "Higiene": { icon: "🧴", items: ["Sabonete", "Shampoo", "Pasta de dente", "Papel higiênico"] },
  "Outros": { icon: "📦", items: [] },
};
const defaultCategories = ["Moradia", "Servicos", "Cartao", "Impostos", "Saude", "Equipe", "Outros"];

function formatMoneyInput(value, forceDecimals = false) {
  const clean = String(value || "").replace(/[^\d,]/g, "");
  if (!clean) return "";
  const comma = clean.indexOf(",");
  const integerDigits = (comma >= 0 ? clean.slice(0, comma) : clean).replace(/\D/g, "") || "0";
  const integer = Number(integerDigits).toLocaleString("pt-BR");
  if (comma >= 0) return `${integer},${clean.slice(comma + 1).replace(/\D/g, "").slice(0, 2)}`;
  return forceDecimals ? `${integer},00` : integer;
}

function parseMoneyInput(value) {
  return Number(String(value || "0").replace(/\./g, "").replace(",", "."));
}
const state = { user: null, bills: [], cards: [], incomes: [], adminUsers: [], selectedAdminUser: null, subscription: null, notificationPreferences: null, feedbacks: [], adminFeedbacks: [], categories: [], financialEntries: [], accountants: [], accountantCompanies: [], accountantReport: null, shoppingItems: [], shoppingCategory: "Mercearia" };
let pixPollTimer = null;
let deferredInstallPrompt = null;
const installDismissedKey = "ricoxp-install-dismissed-at-v2";
const themeStorageKey = "ricoxp-theme";

function applyTheme(theme, persist = true) {
  const selected = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selected;
  if (persist) try { localStorage.setItem(themeStorageKey, selected); } catch {}
  const dark = selected === "dark";
  const button = document.querySelector("#themeToggle");
  const icon = document.querySelector("#themeToggleIcon");
  const label = document.querySelector("#themeToggleLabel");
  if (button) {
    button.setAttribute("aria-pressed", String(dark));
    button.setAttribute("aria-label", dark ? "Ativar modo claro" : "Ativar modo escuro");
    button.title = dark ? "Ativar modo claro" : "Ativar modo escuro";
  }
  if (icon) icon.textContent = dark ? "☀" : "☾";
  if (label) label.textContent = dark ? "Modo claro" : "Modo escuro";
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = dark ? "#0b1417" : "#071f3f";
}
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
    if (response.status === 402) openUpgradeDialog(body.error);
    const error = new Error(body.error || "Não foi possível concluir a operação.");
    error.status = response.status;
    throw error;
  }
  return body;
}

function setMessage(target, text = "", success = false) {
  target.textContent = text;
  target.classList.toggle("success", success);
}

function openUpgradeDialog(message) {
  $("#upgradeMessage").textContent = message || "Este recurso está disponível no Plano Pro.";
  const dialog = $("#upgradeDialog");
  if (!dialog.open) dialog.showModal();
}

function showAuth() {
  state.user = null;
  els.loginScreen.classList.remove("hidden");
  els.appScreen.classList.add("hidden");
  setTimeout(showInstallPrompt, 900);
}

async function enterApp(user) {
  state.user = user;
  $("#userBadge").textContent = `${user.name || user.identifierLabel}${user.role === "admin" ? " · Administrador" : ""}`;
  $("#userAvatar").src = user.avatarData || "/brand-icon-192";
  $("#adminNav").classList.toggle("hidden", user.role !== "admin");
  els.loginScreen.classList.add("hidden");
  els.appScreen.classList.remove("hidden");
  await Promise.all([loadData(), loadSubscription(), loadNotificationPreferences(), loadAccountantContext()]);
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
  $("#installAppButton").textContent = deferredInstallPrompt ? "Instalar aplicativo" : "Como instalar";
  $("#installAppButton").classList.remove("hidden");
  $("#installPrompt").classList.remove("hidden");
}
function hideInstallPrompt(remember = false) {
  $("#installPrompt").classList.add("hidden");
  $("#manualInstallSteps").classList.add("hidden");
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
  state.incomes = data.incomes || [];
  state.categories = data.categories || [];
  state.financialEntries = data.financialEntries || [];
  state.shoppingItems = data.shoppingItems || [];
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
  const canAccessCompany = isPro || state.accountantCompanies.length > 0;
  const labels = { authorized: "Ativa", pending: "Aguardando pagamento", paused: "Pausada", cancelled: "Cancelada", pix_pending: "Aguardando Pix", pix_authorized: "Pix confirmado", pix_rejected: "Pix não aprovado", pix_cancelled: "Pix cancelado" };
  $("#subscriptionTitle").textContent = isPro ? "Plano Pro" : "Plano Grátis";
  const dateLabel = subscription.billingType === "pix" ? "acesso liberado até" : "próxima cobrança em";
  $("#subscriptionDescription").textContent = isPro ? `Casa e Empresa com recursos ilimitados${subscription.nextPaymentDate ? ` · ${dateLabel} ${new Date(subscription.nextPaymentDate).toLocaleDateString("pt-BR")}` : ""}.` : "Área Casa com até 10 contas por mês, 1 cartão, painel, lembretes e renda mensal de até R$ 3.000.";
  $("#subscriptionBadge").textContent = subscription.status === "pix_authorized" && !isPro ? "Pix expirado" : labels[subscription.status] || (isPro ? "Ativa" : "Grátis");
  $("#subscriptionBadge").className = `badge ${isPro ? "active" : String(subscription.status || "").includes("pending") ? "pending" : "inactive"}`;
  $("#billingEmail").value = subscription.payerEmail || (state.user.identifierType === "email" ? state.user.identifierLabel : "");
  $("#subscriptionForm").classList.toggle("hidden", isPro || subscription.status === "pending");
  $("#cancelSubscription").classList.toggle("hidden", subscription.billingType !== "card" || subscription.status === "cancelled");
  $("#syncSubscription").classList.toggle("hidden", !subscription.status);
  $("#subscribeButton").disabled = !subscription.configured;
  $("#pixButton").disabled = !subscription.configured || subscription.status === "pix_pending";
  renderPixCheckout(subscription.pix);
  if (!subscription.configured && !isPro) $("#subscriptionDescription").textContent = "O checkout estará disponível assim que a integração do Mercado Pago for ativada.";
  $(".plan-option:first-child").classList.toggle("current", !isPro);
  $(".plan-option.featured").classList.toggle("current", isPro);
  $(".plan-option:first-child .plan-label").textContent = isPro ? "Plano disponível" : "Plano atual";
  $(".plan-option.featured .plan-label").textContent = isPro ? "Plano atual" : "Mais completo";
  const companyButton = $('[data-workspace="Empresa"]');
  companyButton.classList.toggle("locked", !canAccessCompany);
  if (!canAccessCompany && els.profileFilter.value === "Empresa") setWorkspace("Casa", false);
setCardDateDefaults();
  renderIncome();
  if (isPro) {
    let savedWorkspace = "Casa";
    try { savedWorkspace = localStorage.getItem("ricoxp-workspace") || "Casa"; } catch {}
    if (savedWorkspace === "Empresa" && els.profileFilter.value !== "Empresa") setWorkspace("Empresa", false);
  }
}

function renderPixCheckout(pix) {
  const checkout = $("#pixCheckout");
  const hasCode = Boolean(pix?.qrCode);
  checkout.classList.toggle("hidden", !hasCode);
  if (!hasCode) return;
  $("#pixCode").value = pix.qrCode;
  $("#pixQrCode").src = pix.qrCodeBase64 ? `data:image/png;base64,${pix.qrCodeBase64}` : "";
  $("#pixQrCode").classList.toggle("hidden", !pix.qrCodeBase64);
  $("#openPixPayment").href = pix.ticketUrl || "#";
  $("#openPixPayment").classList.toggle("hidden", !pix.ticketUrl);
}

function pollPixStatus(attempt = 0) {
  clearTimeout(pixPollTimer);
  if (attempt >= 45 || state.subscription?.status !== "pix_pending") return;
  pixPollTimer = setTimeout(async () => {
    try {
      await loadSubscription(true);
      if (state.subscription?.plan === "pro") {
        await loadData();
        setMessage(els.appMessage, "Pagamento confirmado. Seu Plano Pro está ativo por 30 dias.", true);
        return;
      }
    } catch {}
    pollPixStatus(attempt + 1);
  }, 8000);
}

function getFilteredBills() {
  const month = els.monthFilter.value;
  const profile = els.profileFilter.value;
  return state.bills.filter((bill) => bill.dueDate.startsWith(month) && bill.profile === profile).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

function billSituation(bill) {
  if (bill.status === "paid") return "paid";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${bill.dueDate}T00:00:00`) < today ? "overdue" : "pending";
}

function renderDashboardNavigation() {
  const firstName = String(state.user?.name || state.user?.identifierLabel || "").trim().split(/\s+/)[0] || "cliente";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "bom dia" : hour < 18 ? "boa tarde" : "boa noite";
  $("#dashboardGreeting").textContent = `Olá, ${greeting}, ${firstName}!`;
  const [year, selectedMonth] = (els.monthFilter.value || new Date().toISOString().slice(0, 7)).split("-");
  const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  $("#monthTabsYear").textContent = year;
  $("#monthTabs").innerHTML = monthNames.map((name, index) => {
    const value = `${year}-${String(index + 1).padStart(2, "0")}`;
    const active = String(index + 1).padStart(2, "0") === selectedMonth;
    return `<button class="month-tab ${active ? "active" : ""}" type="button" role="tab" aria-selected="${active}" data-month-value="${value}">${name}</button>`;
  }).join("");
}

function render() {
  renderDashboardNavigation();
  renderMetrics();
  renderChart();
  renderIncome();
  renderCategoryChart();
  renderChartsView();
  renderLists();
  renderTable();
  renderFinancialEntries();
  renderDre();
  renderShopping();
  renderCategoryOptions();
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
  const bills = getFilteredBills();
  const values = [
    { value: sumByStatus(bills, "paid"), color: "#209869" },
    { value: sumByStatus(bills, "pending"), color: "#d8911c" },
    { value: sumByStatus(bills, "overdue"), color: "#cf3f3f" },
  ];
  const total = values.reduce((sum, entry) => sum + entry.value, 0);
  const paidPercent = total ? Math.round((values[0].value / total) * 100) : 0;
  const paidEnd = total ? (values[0].value / total) * 360 : 0;
  const pendingEnd = total ? paidEnd + (values[1].value / total) * 360 : 0;
  const donut = $("#statusDonut");
  donut.style.background = total ? `conic-gradient(var(--paid) 0deg ${paidEnd}deg, var(--due) ${paidEnd}deg ${pendingEnd}deg, var(--late) ${pendingEnd}deg 360deg)` : "var(--line)";
  donut.setAttribute("aria-label", `${money.format(values[0].value)} pago, ${money.format(values[1].value)} a vencer e ${money.format(values[2].value)} vencido`);
  $("#statusDonutPercent").textContent = `${paidPercent}%`;
  $("#paidPercent").textContent = `${paidPercent}% pago`;
  $("#statusLegend").innerHTML = [
    `<span><i style="background:#115e59"></i>Total ${money.format(total)}</span>`,
    `<span><i style="background:#209869"></i>Pago ${money.format(values[0].value)}</span>`,
    `<span><i style="background:#d8911c"></i>A vencer ${money.format(values[1].value)}</span>`,
    `<span><i style="background:#cf3f3f"></i>Vencido ${money.format(values[2].value)}</span>`,
  ].join("");
}

function renderChartsView() {
  const bills = getFilteredBills();
  const groups = [
    { key: "Total", items: bills, color: "#115e59" },
    { key: "Paid", items: bills.filter((bill) => billSituation(bill) === "paid"), color: "#209869" },
    { key: "Pending", items: bills.filter((bill) => billSituation(bill) === "pending"), color: "#d8911c" },
    { key: "Overdue", items: bills.filter((bill) => billSituation(bill) === "overdue"), color: "#cf3f3f" },
  ];
  const total = groups[0].items.reduce((sum, bill) => sum + Number(bill.amount), 0);
  groups.forEach((group, index) => {
    const value = group.items.reduce((sum, bill) => sum + Number(bill.amount), 0);
    const percent = total ? Math.round((value / total) * 100) : 0;
    const displayPercent = index === 0 && total ? 100 : percent;
    $("#chart" + group.key + "Ring").style.setProperty("--ring-value", displayPercent);
    $("#chart" + group.key + "Percent").textContent = `${displayPercent}%`;
    $("#chart" + group.key + "Value").textContent = money.format(value);
    $("#chart" + group.key + "Count").textContent = `${group.items.length} ${group.items.length === 1 ? "conta" : "contas"}`;
  });
  $("#chartsStatusBars").innerHTML = groups.slice(1).map((group) => {
    const value = group.items.reduce((sum, bill) => sum + Number(bill.amount), 0);
    const percent = total ? Math.round((value / total) * 100) : 0;
    const label = { Paid: "Pago", Pending: "A vencer", Overdue: "Vencido" }[group.key];
    return `<div class="status-bar-row"><span>${label}</span><div><i style="width:${percent}%;background:${group.color}"></i></div><strong>${money.format(value)}</strong></div>`;
  }).join("");
}

function sumByStatus(bills, status) {
  return bills.filter((bill) => billSituation(bill) === status).reduce((sum, bill) => sum + Number(bill.amount), 0);
}

function renderIncome() {
  const isCompany = els.profileFilter.value === "Empresa";
  $("#incomePanelTitle").textContent = isCompany ? "Receita mensal da Empresa" : "Renda mensal da Casa";
  const isPro = state.subscription?.plan === "pro";
  $("#incomePanelHelp").textContent = isCompany ? "Informe a receita destinada às contas da Empresa." : isPro ? "Informe a renda destinada às contas da Casa." : "Plano Grátis: renda mensal de até R$ 3.000. Acima disso, assine o Pro.";
  $("#incomeFieldLabel").textContent = isCompany ? "Receita da Empresa" : "Renda da Casa";
  $("#incomeAmountLabel").textContent = isCompany ? "Receita da Empresa" : "Renda da Casa";
  const income = state.incomes.find((item) => item.month === els.monthFilter.value && item.profile === els.profileFilter.value);
  const amount = Number(income?.amount || 0);
  const expenses = getFilteredBills().reduce((sum, bill) => sum + Number(bill.amount), 0);
  const remaining = amount - expenses;
  const percent = amount > 0 ? Math.round((expenses / amount) * 100) : 0;
  $("#monthlyIncome").value = amount ? decimalMoney.format(amount) : "";
  $("#incomeAmount").textContent = money.format(amount);
  $("#incomeExpenses").textContent = money.format(expenses);
  $("#incomeRemaining").textContent = money.format(remaining);
  $("#incomeRemaining").classList.toggle("negative", remaining < 0);
  $("#incomePercent").textContent = amount > 0 ? `${percent}% comprometido` : "Renda não informada";
  $("#incomeProgress").style.setProperty("--progress", Math.min(percent, 100));
  $("#incomeProgress").classList.toggle("warning", percent >= 80 && percent <= 100);
  $("#incomeProgress").classList.toggle("danger", percent > 100);
}

function renderCategoryChart() {
  renderCategoryInto("#categoryChart", "#categoryTotal");
  renderCategoryInto("#chartsCategoryChart", "#chartsCategoryTotal");
}

function renderCategoryInto(chartSelector, totalSelector) {
  const colors = { Moradia: "#115e59", Servicos: "#18aee8", Cartao: "#7968c8", Impostos: "#cf3f3f", Saude: "#209869", Equipe: "#d8911c", Outros: "#64716e" };
  const totals = getFilteredBills().reduce((groups, bill) => ({ ...groups, [bill.category]: (groups[bill.category] || 0) + Number(bill.amount) }), {});
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  const max = Math.max(...entries.map((entry) => entry[1]), 1);
  $(totalSelector).textContent = money.format(total);
  $(chartSelector).innerHTML = entries.length ? entries.map(([category, value]) => `<div class="category-row"><span>${escapeHtml(category)}</span><div><i style="width:${Math.round((value / max) * 100)}%;background:${colors[category] || colors.Outros}"></i></div><strong>${money.format(value)}</strong></div>`).join("") : '<p class="muted">Cadastre contas para visualizar as categorias.</p>';
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
    return `<button class="list-row list-row-link" data-bill-link="${bill.id}" type="button"><span><strong>${escapeHtml(bill.name)}</strong><small>${formatDate(bill.dueDate)} · ${money.format(Number(bill.amount))}</small></span><span class="badge ${situation}">${text}</span></button>`;
  }).join("");
}

function openBillFromDashboard(id) {
  const bill = state.bills.find((item) => item.id === id);
  if (!bill) return;
  els.monthFilter.value = bill.dueDate.slice(0, 7);
  setWorkspace(bill.profile);
  switchView("bills", "Contas");
  render();
  requestAnimationFrame(() => {
    const row = document.querySelector(`[data-bill-row="${id}"]`);
    if (!row) return;
    row.classList.add("highlight-row");
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => row.classList.remove("highlight-row"), 2600);
  });
}
function renderForecast() {
  const profile = els.profileFilter.value;
  const months = Array.from({ length: 6 }, (_, index) => {
    const key = monthKeyFromOffset(els.monthFilter.value, index + 1);
    const bills = state.bills.filter((bill) => bill.dueDate.startsWith(key) && bill.profile === profile);
    return { key, count: bills.length, total: bills.reduce((sum, bill) => sum + Number(bill.amount), 0) };
  });
  const max = Math.max(...months.map((item) => item.total), 1);
  const chartLeft = 46, chartRight = 694, chartTop = 22, chartBottom = 178;
  const points = months.map((item, index) => ({
    ...item,
    label: new Date(`${item.key}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(" de ", "/"),
    x: chartLeft + (index * (chartRight - chartLeft) / (months.length - 1)),
    y: chartBottom - ((item.total / max) * (chartBottom - chartTop)),
  }));
  const grid = [0, .33, .66, 1].map((ratio) => {
    const y = chartBottom - (ratio * (chartBottom - chartTop));
    return `<line x1="${chartLeft}" y1="${y}" x2="${chartRight}" y2="${y}" />`;
  }).join("");
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${chartLeft},${chartBottom} ${line} ${chartRight},${chartBottom}`;
  const markers = points.map((point) => `<g><circle cx="${point.x}" cy="${point.y}" r="5"><title>${point.label}: ${money.format(point.total)} · ${point.count} ${point.count === 1 ? "conta" : "contas"}</title></circle><text x="${point.x}" y="207" text-anchor="middle">${escapeHtml(point.label)}</text></g>`).join("");
  const details = points.map((point) => `<div><span>${escapeHtml(point.label)}</span><strong>${money.format(point.total)}</strong><small>${point.count} ${point.count === 1 ? "conta" : "contas"}</small></div>`).join("");
  const html = `<div class="forecast-line-chart" role="img" aria-label="Previsão mensal de despesas para os próximos seis meses"><svg viewBox="0 0 740 220" preserveAspectRatio="none" aria-hidden="true"><g class="forecast-grid">${grid}</g><polygon points="${area}" /><polyline points="${line}" />${markers}</svg><div class="forecast-legend"><i></i><span>Total previsto por mês</span></div><div class="forecast-details">${details}</div></div>`;
  $("#forecastList").innerHTML = html;
  $("#chartsForecastList").innerHTML = html;
}

function renderTable() {
  const bills = getFilteredBills();
  $("#billTable").innerHTML = bills.length ? bills.map((bill) => {
    const situation = billSituation(bill);
    const fixedTag = bill.seriesType === "recurring" ? '<span class="tag">Fixa mensal</span>' : "";
    const tags = `${fixedTag}${bill.tags?.length ? bill.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("") : fixedTag ? "" : '<span class="muted">-</span>'}`;
    const cloneButton = bill.seriesType === "single" ? `<button class="small-button" data-action="clone" data-id="${bill.id}" type="button">Clonar mês</button>` : "";
    const payClass = bill.status === "paid" ? "" : " action-pay";
    return `<tr data-bill-row="${bill.id}"><td>${escapeHtml(bill.name)}</td><td><div class="tag-list">${tags}</div></td><td>${money.format(Number(bill.amount))}</td><td>${formatDate(bill.dueDate)}</td><td><span class="badge ${situation}">${statusLabel(situation)}</span></td><td><div class="row-actions"><button class="small-button${payClass}" data-action="toggle" data-id="${bill.id}" type="button">${bill.status === "paid" ? "Reabrir" : "Pagar"}</button>${cloneButton}<button class="small-button action-edit" data-action="edit" data-id="${bill.id}" type="button">Editar</button><button class="small-button action-delete" data-action="delete" data-id="${bill.id}" type="button">Excluir</button></div></td></tr>`;
  }).join("") : '<tr><td colspan="6">Nenhuma conta cadastrada para este período.</td></tr>';
}

function selectShoppingCategory(category) {
  state.shoppingCategory = category; $("#shoppingCategory").value = category; $("#shoppingSelectedCategory").textContent = category;
  $$("[data-shopping-category]").forEach((button) => button.classList.toggle("active", button.dataset.shoppingCategory === category));
  $("#shoppingSuggestions").innerHTML = shoppingCatalog[category].items.map((item) => `<button type="button" data-shopping-suggestion="${escapeHtml(item)}">+ ${escapeHtml(item)}</button>`).join("");
}

function renderShopping() {
  $("#shoppingCategories").innerHTML = Object.entries(shoppingCatalog).map(([name, data]) => `<button class="shopping-category ${name === state.shoppingCategory ? "active" : ""}" data-shopping-category="${escapeHtml(name)}" type="button"><span aria-hidden="true">${data.icon}</span><strong>${escapeHtml(name)}</strong></button>`).join("");
  selectShoppingCategory(state.shoppingCategory);
  const checked = state.shoppingItems.filter((item) => item.checked).length, total = state.shoppingItems.length, percent = total ? Math.round((checked / total) * 100) : 0;
  $("#shoppingProgressText").textContent = `${checked} de ${total} itens no carrinho`; $("#shoppingProgressPercent").textContent = `${percent}%`; $("#shoppingProgressBar").style.width = `${percent}%`; $("#shoppingItemCount").textContent = `${total} ${total === 1 ? "item" : "itens"}`;
  const groups = Object.keys(shoppingCatalog).map((category) => [category, state.shoppingItems.filter((item) => item.category === category)]).filter(([, items]) => items.length);
  $("#shoppingList").innerHTML = groups.length ? groups.map(([category, items]) => `<section class="shopping-group"><h3><span aria-hidden="true">${shoppingCatalog[category]?.icon || "📦"}</span>${escapeHtml(category)}</h3>${items.map((item) => `<div class="shopping-item ${item.checked ? "checked" : ""}"><button class="shopping-check" data-shopping-toggle="${item.id}" type="button" aria-label="${item.checked ? "Desmarcar" : "Marcar"} ${escapeHtml(item.name)}"><span>${item.checked ? "✓" : ""}</span><div><strong>${escapeHtml(item.name)}</strong><small>${item.quantity} ${escapeHtml(item.unit)}</small></div></button><button class="icon-button shopping-delete" data-shopping-delete="${item.id}" type="button" aria-label="Excluir ${escapeHtml(item.name)}">×</button></div>`).join("")}</section>`).join("") : '<p class="muted empty-state">Sua lista está vazia. Escolha uma seção e adicione o primeiro produto.</p>';
}
function dreData(bills = state.bills, entries = state.financialEntries, profile = "Empresa") {
  const month = els.monthFilter.value;
  const scopedEntries = entries.filter((entry) => entry.profile === profile && entry.date.startsWith(month));
  const revenueEntries = scopedEntries.filter((entry) => (entry.type === "income" || entry.type === "receivable") && entry.status === "settled");
  const variableEntries = scopedEntries.filter((entry) => entry.type === "variable_expense");
  const fixedBills = bills.filter((bill) => bill.profile === profile && bill.dueDate.startsWith(month));
  const revenue = revenueEntries.reduce((sum, item) => sum + Number(item.amount), 0);
  const variable = variableEntries.reduce((sum, item) => sum + Number(item.amount), 0);
  const fixed = fixedBills.reduce((sum, item) => sum + Number(item.amount), 0);
  const groups = new Map();
  [...variableEntries.map((item) => ({ category: item.category, amount: -Number(item.amount) })), ...fixedBills.map((item) => ({ category: item.category, amount: -Number(item.amount) })), ...revenueEntries.map((item) => ({ category: item.category, amount: Number(item.amount) }))].forEach((item) => groups.set(item.category, (groups.get(item.category) || 0) + item.amount));
  return { revenue, variable, fixed, result: revenue - variable - fixed, groups: [...groups.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])) };
}

function dreLinesHtml(data) {
  const lines = [["(+) Receita reconhecida", data.revenue, "positive"], ["(-) Gastos variáveis", -data.variable, "negative"], ["(-) Custos e contas", -data.fixed, "negative"], ["(=) Resultado líquido", data.result, data.result >= 0 ? "positive" : "negative"]];
  return `<div class="dre-main-lines">${lines.map(([label, value, className]) => `<div class="dre-line ${className}"><span>${label}</span><strong>${money.format(value)}</strong></div>`).join("")}</div><h3>Composição por categoria</h3>${data.groups.length ? data.groups.map(([category, value]) => `<div class="dre-line"><span>${escapeHtml(category)}</span><strong class="${value >= 0 ? "positive" : "negative"}">${money.format(value)}</strong></div>`).join("") : '<p class="muted empty-state">Sem movimentações neste período.</p>'}`;
}

function renderDre() {
  const data = dreData();
  $("#dreRevenue").textContent = money.format(data.revenue); $("#dreVariable").textContent = money.format(data.variable); $("#dreFixed").textContent = money.format(data.fixed); $("#dreResult").textContent = money.format(data.result);
  $("#dreMargin").textContent = `Margem de ${data.revenue ? Math.round((data.result / data.revenue) * 100) : 0}%`;
  $("#dreResultMetric").classList.toggle("paid", data.result >= 0); $("#dreResultMetric").classList.toggle("late", data.result < 0);
  $("#drePeriod").textContent = new Date(`${els.monthFilter.value}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  $("#dreLines").innerHTML = dreLinesHtml(data);
}

async function loadAccountantContext() {
  try {
    const [own, shared] = await Promise.all([api("/api/accountants"), api("/api/accountant/companies")]);
    state.accountants = own.accountants; state.accountantCompanies = shared.companies;
    renderAccountantAccess();
    if (state.subscription) renderSubscription();
  } catch (error) { setMessage($("#accountantMessage"), error.message); }
}

function renderAccountantAccess() {
  $("#accountantList").innerHTML = state.accountants.length ? state.accountants.map((access) => `<div class="access-row"><div><strong>${escapeHtml(access.accountantEmail)}</strong><small>Somente leitura</small></div><button class="small-button action-delete" data-accountant-delete="${access.id}" type="button">Remover</button></div>`).join("") : '<p class="muted empty-state">Nenhum contador cadastrado.</p>';
  $("#accountantCompanies").innerHTML = state.accountantCompanies.length ? state.accountantCompanies.map((access) => `<button class="access-row access-company" data-accountant-company="${access.ownerUserId}" type="button"><div><strong>${escapeHtml(access.owner?.name || "Empresa")}</strong><small>${escapeHtml(access.owner?.email || access.owner?.identifierLabel || "")}</small></div><span>Ver DRE</span></button>`).join("") : '<p class="muted empty-state">Nenhuma empresa compartilhou acesso com esta conta.</p>';
}
const entryViewConfig = {
  income: { list: "#incomeEntriesList", total: "#incomeEntriesTotal", count: "#incomeEntriesCount", settled: "Recebido", pending: "A receber" },
  variable_expense: { list: "#variableExpensesList", total: "#variableExpensesTotal", count: "#variableExpensesCount", settled: "Pago", pending: "Pendente" },
  receivable: { list: "#receivablesList", total: "#receivablesTotal", count: "#receivablesCount", settled: "Recebido", pending: "A receber" },
};

function filteredFinancialEntries(type) {
  return state.financialEntries.filter((entry) => entry.type === type && entry.profile === els.profileFilter.value && entry.date.startsWith(els.monthFilter.value)).sort((a, b) => b.date.localeCompare(a.date));
}

function renderFinancialEntries() {
  Object.entries(entryViewConfig).forEach(([type, config]) => {
    const entries = filteredFinancialEntries(type);
    $(config.total).textContent = money.format(entries.reduce((sum, entry) => sum + Number(entry.amount), 0));
    $(config.count).textContent = `${entries.length} ${entries.length === 1 ? "lançamento" : "lançamentos"}`;
    $(config.list).innerHTML = entries.length ? entries.map((entry) => `<article class="entry-row"><div><strong>${escapeHtml(entry.description)}</strong><span>${escapeHtml(entry.category)} · ${formatDate(entry.date)}</span>${entry.notes ? `<small>${escapeHtml(entry.notes)}</small>` : ""}</div><strong>${money.format(entry.amount)}</strong><span class="badge ${entry.status === "settled" ? "active" : "pending"}">${entry.status === "settled" ? config.settled : config.pending}</span><div class="row-actions"><button class="small-button action-pay" data-entry-action="toggle" data-entry-id="${entry.id}" type="button">${entry.status === "settled" ? "Reabrir" : type === "variable_expense" ? "Pagar" : "Receber"}</button><button class="small-button action-edit" data-entry-action="edit" data-entry-id="${entry.id}" type="button">Editar</button><button class="small-button action-delete" data-entry-action="delete" data-entry-id="${entry.id}" type="button">Excluir</button></div></article>`).join("") : '<p class="muted empty-state">Nenhum lançamento neste mês.</p>';
  });
}

function resetEntryForm(form) {
  form.reset();
  form.elements.id.value = "";
  form.elements.date.value = `${els.monthFilter.value}-01`;
  form.querySelector(".cancel-entry").classList.add("hidden");
}
function renderCategoryOptions(selected = $("#billCategory").value) {
  const names = [...defaultCategories, ...state.categories.map((category) => category.name)];
  $("#billCategory").innerHTML = names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
  if (names.includes(selected)) $("#billCategory").value = selected;
}

function setCardDateDefaults() {
  const month = els.monthFilter.value || new Date().toISOString().slice(0, 7);
  if (!$("#cardCloseDay").value) $("#cardCloseDay").value = `${month}-20`;
  if (!$("#cardDueDay").value) $("#cardDueDay").value = `${month}-25`;
}
function renderCards() {
  const profile = els.profileFilter.value;
  const cards = state.cards.filter((card) => card.profile === profile);
  $("#cardList").innerHTML = cards.length ? cards.map((card) => {
    const used = getFilteredBills().filter((bill) => bill.category === "Cartao" && bill.name.toLowerCase().includes(card.name.split(" ")[0].toLowerCase())).reduce((sum, bill) => sum + Number(bill.amount), 0);
    const percent = Math.min(100, Math.round((used / Number(card.limit || 1)) * 100));
    return `<article class="card-item"><div><strong>${escapeHtml(card.name)}</strong><p class="muted">Vence dia ${card.dueDay} · fecha dia ${card.closeDay}</p></div><div class="progress"><span style="width:${percent}%"></span></div><small>${money.format(used)} usado de ${money.format(Number(card.limit))}</small><button class="small-button" data-card-delete="${card.id}" type="button">Excluir cartão</button></article>`;
  }).join("") : '<section class="panel"><p class="muted">Nenhum cartão cadastrado.</p></section>';
}

function resetBillForm() {
  els.billForm.reset();
  $("#billId").value = "";
  $("#billDueDate").value = `${els.monthFilter.value}-10`;
  $("#billInstallments").value = "1";
  $("#billInstallments").disabled = false;
  $("#billRecurring").checked = false;
  $("#billRecurring").disabled = false;
  $("#billProfile").value = els.profileFilter.value;
  els.cancelEditButton.classList.add("hidden");
}

function setWorkspace(profile, remember = true) {
  const selected = profile === "Empresa" ? "Empresa" : "Casa";
  els.profileFilter.value = selected;
  $("#billProfile").value = selected;
  $("#cardProfile").value = selected;
  $("#workspaceContext").textContent = selected;
  $$('[data-workspace]').forEach((button) => button.classList.toggle("active", button.dataset.workspace === selected));
  $$('[data-area-only]').forEach((item) => item.classList.toggle("hidden", item.dataset.areaOnly !== selected));
  const activeView = $(".view.active-view")?.id.replace(/View$/, "");
  const activeNav = activeView ? $(`[data-view="${activeView}"]`) : null;
  if (activeNav?.classList.contains("hidden")) switchView("dashboard", "Dashboard");
  resetBillForm();
  els.cardForm.reset();
  $("#cardProfile").value = selected;
  if (remember) try { localStorage.setItem("ricoxp-workspace", selected); } catch {}
  render();
}

function selectWorkspace(profile) {
  if (profile === "Empresa" && state.subscription?.plan !== "pro" && !state.accountantCompanies.length) {
    switchView("subscription", "Assinatura");
    setMessage(els.appMessage, "A área Empresa está disponível no plano Pro.");
    return;
  }
  setMessage(els.appMessage);
  setWorkspace(profile);
}

function switchView(view, title) {
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((item) => item.classList.remove("active-view"));
  $(`#${view}View`).classList.add("active-view");
  $("#pageTitle").textContent = title;
  els.financeFilters.classList.toggle("hidden", view === "admin" || view === "subscription" || view === "feedback");
  if (view === "admin") loadAdmin();
  if (view === "feedback") loadFeedback();
  if (view === "subscription") loadSubscription();
  if (view === "reminders") loadNotificationPreferences();
}

async function loadAdmin() {
  if (state.user?.role !== "admin") return;
  try {
    const usersData = await api("/api/admin/users");
    state.adminUsers = usersData.users;
    const activeUsers = state.adminUsers.filter((user) => user.active).length;
    const proUsers = state.adminUsers.filter((user) => user.plan === "pro").length;
    $("#adminUsers").textContent = state.adminUsers.length;
    $("#adminActiveText").textContent = `${activeUsers} ativos`;
    $("#adminProUsers").textContent = proUsers;
    $("#adminFreeUsers").textContent = state.adminUsers.length - proUsers;
    $("#adminInactiveUsers").textContent = state.adminUsers.length - activeUsers;
    renderAdminUsers();
    await loadAdminFeedback();
  } catch (error) { setMessage(els.appMessage, error.message); }
}

function renderAdminUsers() {
  $("#adminUserTable").innerHTML = state.adminUsers.map((user) => `<tr><td><div class="admin-client-cell"><img src="${user.avatarData || "/brand-icon-192"}" alt="" /><strong>${escapeHtml(user.name || user.identifierLabel)}</strong></div></td><td>${escapeHtml(user.identifierLabel)}</td><td>${user.role === "admin" ? "Administrador" : "Usuário"}</td><td><span class="badge ${user.plan === "pro" ? "active" : "inactive"}">${user.plan === "pro" ? "Pro" : "Grátis"}</span></td><td>${new Date(user.createdAt).toLocaleDateString("pt-BR")}</td><td><span class="badge ${user.active ? "active" : "inactive"}">${user.active ? "Ativo" : "Inativo"}</span></td><td><div class="row-actions"><button class="small-button action-edit" data-admin-manage="${user.id}" type="button">Gerenciar cliente</button>${user.id === state.user.id ? "" : `<button class="small-button" data-admin-status="${user.id}" data-active="${!user.active}" type="button">${user.active ? "Desativar" : "Ativar"}</button>`}</div></td></tr>`).join("");
}

async function showAdminUser(id) {
  const { user } = await api(`/api/admin/users/${id}`);
  state.selectedAdminUser = user;
  $("#adminDetailTitle").textContent = `Gerenciar ${user.name || user.identifierLabel}`;
  $("#adminAvatarPreview").src = user.avatarData || "/brand-icon-192";
  $("#adminAvatar").value = "";
  $("#adminClientName").value = user.name || user.identifierLabel;
  $("#adminClientEmail").value = user.email || "";
  $("#adminClientEmail").disabled = user.identifierType !== "email";
  $("#adminClientIdentifier").value = user.identifierType === "email" ? "E-mail" : `CPF: ${user.identifierLabel}`;
  $("#adminClientPlan").value = user.plan === "pro" ? "Plano Pro" : "Plano Grátis";
  $("#adminClientStatus").value = user.active ? "Ativo" : "Inativo";
  $("#adminSetPro").disabled = user.plan === "pro";
  $("#adminSetFree").disabled = user.plan !== "pro";
  $("#adminClientPassword").value = "";
  $("#adminClientPasswordConfirm").value = "";
  setMessage($("#adminClientMessage"));
  $("#adminUserDetail").classList.remove("hidden");
}

function ratingFace(rating) {
  if (rating <= 2) return "😞";
  if (rating <= 4) return "🙁";
  if (rating <= 6) return "😐";
  if (rating <= 8) return "🙂";
  return "😄";
}

function updateFeedbackRating() {
  const rating = Number($("#feedbackRating").value);
  $("#feedbackFace").textContent = ratingFace(rating);
  $("#feedbackRatingValue").textContent = `${rating} de 10`;
}

async function loadFeedback() {
  try {
    state.feedbacks = (await api("/api/feedback")).feedbacks;
    renderFeedbackHistory();
  } catch (error) { setMessage($("#feedbackFormMessage"), error.message); }
}

function renderFeedbackHistory() {
  $("#feedbackHistory").innerHTML = state.feedbacks.length ? state.feedbacks.map((feedback) => `<article class="feedback-item"><div class="feedback-meta"><span class="rating-face" aria-hidden="true">${ratingFace(feedback.rating)}</span><strong>${feedback.rating}/10</strong><time>${new Date(feedback.createdAt).toLocaleDateString("pt-BR")}</time><span class="badge ${feedback.response ? "active" : "pending"}">${feedback.response ? "Respondido" : "Recebido"}</span></div><p>${escapeHtml(feedback.message)}</p>${feedback.response ? `<div class="feedback-response"><strong>Resposta da equipe RicoXP</strong><p>${escapeHtml(feedback.response)}</p></div>` : ""}</article>`).join("") : '<p class="muted empty-state">Você ainda não enviou nenhum feedback.</p>';
}

async function loadAdminFeedback() {
  if (state.user?.role !== "admin") return;
  try {
    state.adminFeedbacks = (await api("/api/admin/feedback")).feedbacks;
    renderAdminFeedback();
  } catch (error) { $("#adminFeedbackList").innerHTML = `<p class="form-message">${escapeHtml(error.message)}</p>`; }
}

function renderAdminFeedback() {
  $("#adminFeedbackList").innerHTML = state.adminFeedbacks.length ? state.adminFeedbacks.map((feedback) => `<article class="feedback-item admin-feedback-item"><div class="feedback-meta"><span class="rating-face" aria-hidden="true">${ratingFace(feedback.rating)}</span><strong>${feedback.rating}/10</strong><span>${escapeHtml(feedback.user?.name || feedback.user?.identifierLabel || "Cliente")}</span><small>${escapeHtml(feedback.user?.email || feedback.user?.identifierLabel || "")}</small><time>${new Date(feedback.createdAt).toLocaleString("pt-BR")}</time></div><p>${escapeHtml(feedback.message)}</p><form class="feedback-reply-form" data-feedback-reply="${feedback.id}"><label>Resposta<textarea rows="3" minlength="2" maxlength="2000" required>${escapeHtml(feedback.response || "")}</textarea></label><button class="${feedback.response ? "ghost-button" : "primary-button"}" type="submit">${feedback.response ? "Atualizar resposta" : "Responder cliente"}</button></form></article>`).join("") : '<p class="muted empty-state">Nenhum feedback recebido.</p>';
}
async function updateAdminUserPlan(plan) {
  if (!state.selectedAdminUser) return;
  const action = plan === "pro" ? "liberar o Plano Pro de teste" : "voltar para o Plano Gratis";
  if (!confirm(`Deseja ${action} para este cliente?`)) return;
  setMessage($("#adminClientMessage"));
  try {
    const result = await api(`/api/admin/users/${state.selectedAdminUser.id}/plan`, { method: "PATCH", body: JSON.stringify({ plan }) });
    await loadAdmin();
    await showAdminUser(state.selectedAdminUser.id);
    setMessage($("#adminClientMessage"), result.message || "Plano atualizado.", true);
  } catch (error) {
    setMessage($("#adminClientMessage"), error.message);
  }
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
    const avatarData = await resizeProfileImage($("#registerAvatar").files[0]);
    const result = await api("/api/register", { method: "POST", body: JSON.stringify({ name: $("#registerName").value, identifier: $("#registerIdentifier").value, avatarData, password: $("#registerPassword").value }) });
    await enterApp(result.user);
  } catch (error) { setMessage(els.authMessage, error.message); }
});

$("#logoutButton").addEventListener("click", async () => { await api("/api/logout", { method: "POST" }).catch(() => {}); showAuth(); });
$("#forgotPasswordButton").addEventListener("click", () => {
  $("#forgotPasswordEmail").value = $("#loginIdentifier").value.includes("@") ? $("#loginIdentifier").value : "";
  setMessage($("#forgotPasswordMessage"));
  $("#forgotPasswordDialog").showModal();
});
$$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.closeDialog}`).close()));
$("#forgotPasswordForm").addEventListener("submit", async (event) => {
  event.preventDefault(); setMessage($("#forgotPasswordMessage"));
  try {
    const result = await api("/api/password/forgot", { method: "POST", body: JSON.stringify({ email: $("#forgotPasswordEmail").value }) });
    setMessage($("#forgotPasswordMessage"), result.message, true);
  } catch (error) { setMessage($("#forgotPasswordMessage"), error.message); }
});
$("#resetPasswordForm").addEventListener("submit", async (event) => {
  event.preventDefault(); setMessage($("#resetPasswordMessage"));
  if ($("#resetPassword").value !== $("#resetPasswordConfirm").value) return setMessage($("#resetPasswordMessage"), "As senhas não coincidem.");
  const token = new URLSearchParams(location.search).get("reset_token");
  try {
    const result = await api("/api/password/reset", { method: "POST", body: JSON.stringify({ token, password: $("#resetPassword").value }) });
    history.replaceState({}, "", location.pathname);
    setMessage($("#resetPasswordMessage"), result.message, true);
    setTimeout(() => $("#resetPasswordDialog").close(), 1200);
  } catch (error) { setMessage($("#resetPasswordMessage"), error.message); }
});
$("#dismissInstallButton").addEventListener("click", () => hideInstallPrompt(true));
$("#installAppButton").addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    $("#manualInstallSteps").innerHTML = isIos()
      ? "<li>Toque em <strong>Compartilhar</strong> no Safari.</li><li>Escolha <strong>Adicionar à Tela de Início</strong>.</li><li>Confirme em <strong>Adicionar</strong>.</li>"
      : "<li>Abra o menu <strong>⋮</strong> do navegador.</li><li>Escolha <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>.</li><li>Confirme em <strong>Instalar</strong>.</li>";
    $("#manualInstallSteps").classList.remove("hidden");
    $("#installAppButton").classList.add("hidden");
    return;
  }
  await deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  hideInstallPrompt(choice.outcome !== "accepted");
});
$("#feedbackRating").addEventListener("input", updateFeedbackRating);
$("#feedbackForm").addEventListener("submit", async (event) => {
  event.preventDefault(); setMessage($("#feedbackFormMessage"));
  try {
    const feedback = await api("/api/feedback", { method: "POST", body: JSON.stringify({ rating: Number($("#feedbackRating").value), message: $("#feedbackMessage").value }) });
    state.feedbacks.unshift(feedback);
    $("#feedbackMessage").value = "";
    renderFeedbackHistory();
    setMessage($("#feedbackFormMessage"), "Feedback enviado. Obrigado por ajudar a melhorar o RicoXP.", true);
  } catch (error) { setMessage($("#feedbackFormMessage"), error.message); }
});
$("#refreshFeedback").addEventListener("click", loadAdminFeedback);
$("#adminFeedbackList").addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-feedback-reply]");
  if (!form) return;
  event.preventDefault();
  try {
    await api(`/api/admin/feedback/${form.dataset.feedbackReply}`, { method: "PATCH", body: JSON.stringify({ response: form.querySelector("textarea").value }) });
    await loadAdminFeedback();
    setMessage(els.appMessage, "Resposta enviada ao cliente.", true);
  } catch (error) { setMessage(els.appMessage, error.message); }
});
function openMobileMenu() { document.body.classList.add("menu-open"); $("#openMobileMenu").setAttribute("aria-expanded", "true"); }
function closeMobileMenu() { document.body.classList.remove("menu-open"); $("#openMobileMenu").setAttribute("aria-expanded", "false"); }
$("#openMobileMenu").addEventListener("click", openMobileMenu);
$("#closeMobileMenu").addEventListener("click", closeMobileMenu);
$("#menuBackdrop").addEventListener("click", closeMobileMenu);
$("#closeUpgradeDialog").addEventListener("click", () => $("#upgradeDialog").close());
$("#upgradeLater").addEventListener("click", () => $("#upgradeDialog").close());
$("#upgradeToPro").addEventListener("click", () => { $("#upgradeDialog").close(); switchView("subscription", "Assinatura"); closeMobileMenu(); });
window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMobileMenu(); });
$$('[data-view]').forEach((button) => button.addEventListener("click", () => { switchView(button.dataset.view, button.textContent.trim()); closeMobileMenu(); }));
els.monthFilter.addEventListener("change", () => { resetBillForm(); els.cardForm.reset(); setCardDateDefaults(); render(); });
$("#monthTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-month-value]");
  if (!button) return;
  els.monthFilter.value = button.dataset.monthValue;
  resetBillForm();
  els.cardForm.reset();
  setCardDateDefaults();
  render();
});
["#upcomingList", "#reminderList"].forEach((selector) => $(selector).addEventListener("click", (event) => {
  const target = event.target.closest("[data-bill-link]");
  if (target) openBillFromDashboard(target.dataset.billLink);
}));
$("#shoppingCategories").addEventListener("click", (event) => { const button = event.target.closest("[data-shopping-category]"); if (!button) return; document.activeElement?.blur(); selectShoppingCategory(button.dataset.shoppingCategory); });
$("#shoppingSuggestions").addEventListener("click", (event) => { const button = event.target.closest("[data-shopping-suggestion]"); if (!button) return; document.activeElement?.blur(); $("#shoppingName").value = button.dataset.shoppingSuggestion; });
$("#shoppingForm").addEventListener("submit", async (event) => { event.preventDefault(); try { const item = await api("/api/shopping-items", { method: "POST", body: JSON.stringify({ name: $("#shoppingName").value, category: $("#shoppingCategory").value, quantity: Number($("#shoppingQuantity").value), unit: $("#shoppingUnit").value }) }); state.shoppingItems.push(item); $("#shoppingName").value = ""; $("#shoppingQuantity").value = "1"; renderShopping(); } catch (error) { setMessage(els.appMessage, error.message); } });
$("#shoppingList").addEventListener("click", async (event) => { const toggle = event.target.closest("[data-shopping-toggle]"), remove = event.target.closest("[data-shopping-delete]"); const id = toggle?.dataset.shoppingToggle || remove?.dataset.shoppingDelete; if (!id) return; const item = state.shoppingItems.find((entry) => entry.id === id); try { if (toggle) { const updated = await api(`/api/shopping-items/${id}`, { method: "PATCH", body: JSON.stringify({ checked: !item.checked }) }); state.shoppingItems[state.shoppingItems.findIndex((entry) => entry.id === id)] = updated; } else { await api(`/api/shopping-items/${id}`, { method: "DELETE" }); state.shoppingItems = state.shoppingItems.filter((entry) => entry.id !== id); } renderShopping(); } catch (error) { setMessage(els.appMessage, error.message); } });
$("#clearCheckedShopping").addEventListener("click", async () => { if (!state.shoppingItems.some((item) => item.checked)) return; try { await api("/api/shopping-items/checked", { method: "DELETE" }); state.shoppingItems = state.shoppingItems.filter((item) => !item.checked); renderShopping(); } catch (error) { setMessage(els.appMessage, error.message); } });
$("#shoppingPurchaseDate").value = new Date().toLocaleDateString("en-CA");
$("#shoppingCheckoutForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage($("#shoppingCheckoutMessage"));
  const amount = parseMoneyInput($("#shoppingTotal").value);
  if (!amount) return setMessage($("#shoppingCheckoutMessage"), "Informe o valor total da compra.");
  try {
    const result = await api("/api/shopping-items/checkout", { method: "POST", body: JSON.stringify({ amount, date: $("#shoppingPurchaseDate").value }) });
    state.financialEntries.push(result.entry);
    if (result.removed) state.shoppingItems = state.shoppingItems.filter((item) => !item.checked);
    $("#shoppingCheckoutForm").reset();
    $("#shoppingPurchaseDate").value = new Date().toLocaleDateString("en-CA");
    renderShopping(); renderFinancialEntries(); renderDre();
    setMessage($("#shoppingCheckoutMessage"), "Compra lançada no financeiro com sucesso.", true);
  } catch (error) { setMessage($("#shoppingCheckoutMessage"), error.message); }
});
$("#accountantForm").addEventListener("submit", async (event) => { event.preventDefault(); setMessage($("#accountantMessage")); try { state.accountants.unshift(await api("/api/accountants", { method: "POST", body: JSON.stringify({ email: $("#accountantEmail").value }) })); $("#accountantForm").reset(); renderAccountantAccess(); setMessage($("#accountantMessage"), "Acesso do contador liberado.", true); } catch (error) { setMessage($("#accountantMessage"), error.message); } });
$("#accountantList").addEventListener("click", async (event) => { const button = event.target.closest("[data-accountant-delete]"); if (!button) return; try { await api(`/api/accountants/${button.dataset.accountantDelete}`, { method: "DELETE" }); state.accountants = state.accountants.filter((item) => item.id !== button.dataset.accountantDelete); renderAccountantAccess(); } catch (error) { setMessage($("#accountantMessage"), error.message); } });
$("#accountantCompanies").addEventListener("click", async (event) => { const button = event.target.closest("[data-accountant-company]"); if (!button) return; try { const report = await api(`/api/accountant/companies/${button.dataset.accountantCompany}`); state.accountantReport = report; const data = dreData(report.bills, report.financialEntries, "Empresa"); $("#accountantReportTitle").textContent = `DRE · ${report.company.owner?.name || "Empresa"}`; $("#accountantReportPeriod").textContent = new Date(`${els.monthFilter.value}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); $("#accountantReportLines").innerHTML = dreLinesHtml(data); $("#accountantReport").classList.remove("hidden"); } catch (error) { setMessage($("#accountantMessage"), error.message); } });
$$('.financial-entry-form').forEach((form) => {
  resetEntryForm(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = form.elements.id.value;
    const entry = { type: form.dataset.type, profile: els.profileFilter.value, description: form.elements.description.value.trim(), amount: parseMoneyInput(form.elements.amount.value), date: form.elements.date.value, category: form.elements.category.value.trim(), status: form.elements.status.value, notes: form.elements.notes.value.trim() };
    try {
      const saved = await api(id ? `/api/financial-entries/${id}` : "/api/financial-entries", { method: id ? "PUT" : "POST", body: JSON.stringify(entry) });
      if (id) state.financialEntries[state.financialEntries.findIndex((item) => item.id === id)] = saved; else state.financialEntries.push(saved);
      resetEntryForm(form); renderFinancialEntries(); setMessage(els.appMessage, "Lançamento salvo.", true);
    } catch (error) { setMessage(els.appMessage, error.message); }
  });
  form.querySelector(".cancel-entry").addEventListener("click", () => resetEntryForm(form));
});
$$('.entry-list').forEach((list) => list.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-entry-action]"); if (!button) return;
  const entry = state.financialEntries.find((item) => item.id === button.dataset.entryId); if (!entry) return;
  try {
    if (button.dataset.entryAction === "delete") { await api(`/api/financial-entries/${entry.id}`, { method: "DELETE" }); state.financialEntries = state.financialEntries.filter((item) => item.id !== entry.id); }
    if (button.dataset.entryAction === "toggle") { const updated = await api(`/api/financial-entries/${entry.id}`, { method: "PUT", body: JSON.stringify({ ...entry, status: entry.status === "settled" ? "pending" : "settled" }) }); state.financialEntries[state.financialEntries.findIndex((item) => item.id === entry.id)] = updated; }
    if (button.dataset.entryAction === "edit") { const form = $(`.financial-entry-form[data-type="${entry.type}"]`); form.elements.id.value = entry.id; form.elements.description.value = entry.description; form.elements.amount.value = decimalMoney.format(entry.amount); form.elements.date.value = entry.date; form.elements.category.value = entry.category; form.elements.status.value = entry.status; form.elements.notes.value = entry.notes || ""; form.querySelector(".cancel-entry").classList.remove("hidden"); form.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    renderFinancialEntries();
  renderDre();
  renderShopping();
  } catch (error) { setMessage(els.appMessage, error.message); }
}));
$$('.money-input').forEach((input) => { input.addEventListener("input", (event) => { event.target.value = formatMoneyInput(event.target.value); }); input.addEventListener("blur", (event) => { event.target.value = formatMoneyInput(event.target.value, true); }); });
["#billAmount", "#cardLimit"].forEach((selector) => {
  $(selector).addEventListener("input", (event) => { event.target.value = formatMoneyInput(event.target.value); });
  $(selector).addEventListener("blur", (event) => { event.target.value = formatMoneyInput(event.target.value, true); });
});
$("#openCategoryDialog").addEventListener("click", () => { setMessage($("#categoryMessage")); $("#categoryDialog").showModal(); $("#categoryName").focus(); });
$("#categoryForm").addEventListener("submit", async (event) => {
  event.preventDefault(); setMessage($("#categoryMessage"));
  try {
    const category = await api("/api/categories", { method: "POST", body: JSON.stringify({ name: $("#categoryName").value }) });
    state.categories.push(category);
    renderCategoryOptions(category.name);
    $("#categoryForm").reset();
    setMessage($("#categoryMessage"), "Categoria criada para a sua conta.", true);
    setTimeout(() => $("#categoryDialog").close(), 700);
  } catch (error) { setMessage($("#categoryMessage"), error.message); }
});$("#monthlyIncome").addEventListener("input", (event) => { event.target.value = formatMoneyInput(event.target.value); });
$("#monthlyIncome").addEventListener("blur", (event) => { event.target.value = formatMoneyInput(event.target.value, true); });$("#incomeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const income = await api("/api/income", { method: "PUT", body: JSON.stringify({ month: els.monthFilter.value, profile: els.profileFilter.value, amount: parseMoneyInput($("#monthlyIncome").value) }) });
    const index = state.incomes.findIndex((item) => item.month === income.month && item.profile === income.profile);
    if (index >= 0) state.incomes[index] = income; else state.incomes.push(income);
    renderIncome();
    setMessage(els.appMessage, "Renda mensal salva.", true);
  } catch (error) { setMessage(els.appMessage, error.message); }
});
$$('[data-workspace]').forEach((button) => button.addEventListener("click", () => selectWorkspace(button.dataset.workspace)));
$("#exportButton").addEventListener("click", exportCsv);
els.cancelEditButton.addEventListener("click", resetBillForm);
$("#billRecurring").addEventListener("change", () => {
  if ($("#billRecurring").checked) $("#billInstallments").value = "1";
  $("#billInstallments").disabled = $("#billRecurring").checked;
});

els.billForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (els.billForm.dataset.submitting === "true") return;
  const id = $("#billId").value;
  const bill = { name: $("#billName").value.trim(), amount: parseMoneyInput($("#billAmount").value), dueDate: $("#billDueDate").value, profile: $("#billProfile").value, category: $("#billCategory").value, status: $("#billStatus").value, tags: $("#billTags").value.split(",").map((tag) => tag.trim()).filter(Boolean), installments: Number($("#billInstallments").value), recurring: $("#billRecurring").checked };
  const submitButton = els.billForm.querySelector('button[type="submit"]');
  const originalLabel = submitButton.textContent;
  els.billForm.dataset.submitting = "true";
  submitButton.disabled = true;
  submitButton.textContent = "Salvando...";
  try {
    const result = await api(id ? `/api/bills/${id}` : "/api/bills", { method: id ? "PUT" : "POST", body: JSON.stringify(bill) });
    const created = result?.bills?.length || 1;
    const message = id ? "Conta atualizada." : bill.recurring ? "Conta fixa salva e próximos 12 meses criados." : created > 1 ? `${created} parcelas criadas. Troque o Mês exibido para consultar as próximas.` : "Conta salva.";
    await loadData(); resetBillForm(); setMessage(els.appMessage, message, true);
  } catch (error) {
    setMessage(els.appMessage, error.message);
  } finally {
    els.billForm.dataset.submitting = "false";
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
});

$("#billTable").addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const bill = state.bills.find((item) => item.id === button.dataset.id);
  if (!bill) return;
  if (button.dataset.action === "edit") {
    $("#billId").value = bill.id; $("#billName").value = bill.name; $("#billAmount").value = decimalMoney.format(bill.amount); $("#billDueDate").value = bill.dueDate; $("#billProfile").value = bill.profile; $("#billCategory").value = bill.category; $("#billStatus").value = bill.status; $("#billTags").value = (bill.tags || []).join(", "); $("#billInstallments").value = "1"; $("#billInstallments").disabled = true; $("#billRecurring").checked = bill.seriesType === "recurring"; $("#billRecurring").disabled = true; els.cancelEditButton.classList.remove("hidden"); return;
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
  const card = { name: $("#cardName").value.trim(), limit: parseMoneyInput($("#cardLimit").value), closeDay: Number($("#cardCloseDay").value.slice(-2)), dueDay: Number($("#cardDueDay").value.slice(-2)), profile: els.profileFilter.value };
  try { await api("/api/cards", { method: "POST", body: JSON.stringify(card) }); await loadData(); els.cardForm.reset(); setCardDateDefaults(); setMessage(els.appMessage, "Cartão salvo.", true); } catch (error) { setMessage(els.appMessage, error.message); }
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
$("#pixButton").addEventListener("click", async () => {
  setMessage(els.appMessage);
  const payerEmail = $("#billingEmail").value;
  if (!payerEmail || !$("#billingEmail").reportValidity()) return;
  try {
    const result = await api("/api/subscription/pix", { method: "POST", body: JSON.stringify({ payerEmail }) });
    state.subscription = result.subscription;
    renderSubscription();
    pollPixStatus();
    setMessage(els.appMessage, "Pix gerado. O Pro será liberado após a confirmação do pagamento.", true);
  } catch (error) { setMessage(els.appMessage, error.message); }
});
$("#copyPixCode").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("#pixCode").value); setMessage(els.appMessage, "Código Pix copiado.", true); }
  catch { $("#pixCode").select(); document.execCommand("copy"); setMessage(els.appMessage, "Código Pix copiado.", true); }
});

function resizeProfileImage(file) {
  if (!file) return Promise.resolve(null);
  if (!file.type.match(/^image\/(jpeg|png|webp)$/) || file.size > 5 * 1024 * 1024) return Promise.reject(new Error("Escolha uma imagem JPG, PNG ou WebP de até 5 MB."));
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, size, size);
      const scale = Math.max(size / image.width, size / image.height);
      const width = image.width * scale; const height = image.height * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      resolve(canvas.toDataURL("image/jpeg", .82));
      URL.revokeObjectURL(image.src);
    };
    image.onerror = () => reject(new Error("Não foi possível ler a foto escolhida."));
    image.src = URL.createObjectURL(file);
  });
}
document.querySelectorAll("[data-support-open]").forEach((button) => button.addEventListener("click", () => {
  $("#supportFeedback").textContent = "";
  $("#supportDialog").showModal();
}));
$("#closeSupportDialog").addEventListener("click", () => $("#supportDialog").close());
$("#supportDialog").addEventListener("click", (event) => {
  if (event.target === $("#supportDialog")) $("#supportDialog").close();
});
$("#copySupportEmail").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText("contato@ricoxp.com");
    setMessage($("#supportFeedback"), "Endereço copiado.", true);
  } catch { setMessage($("#supportFeedback"), "E-mail: contato@ricoxp.com", true); }
});
$("#syncSubscription").addEventListener("click", async () => {
  try { await loadSubscription(true); await loadData(); setMessage(els.appMessage, "Situação da assinatura atualizada.", true); } catch (error) { setMessage(els.appMessage, error.message); }
});
$("#cancelSubscription").addEventListener("click", async () => {
  if (!confirm("Cancelar a renovação do plano Pro?")) return;
  try { state.subscription = await api("/api/subscription/cancel", { method: "POST" }); renderSubscription(); setMessage(els.appMessage, "Assinatura cancelada.", true); } catch (error) { setMessage(els.appMessage, error.message); }
});

$("#refreshAdmin").addEventListener("click", loadAdmin);
$("#closeAdminDetail").addEventListener("click", () => $("#adminUserDetail").classList.add("hidden"));
$("#adminSetPro").addEventListener("click", () => updateAdminUserPlan("pro"));
$("#adminSetFree").addEventListener("click", () => updateAdminUserPlan("free"));
$("#adminUserTable").addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-admin-manage]");
  const statusButton = event.target.closest("[data-admin-status]");
  try {
    if (viewButton) await showAdminUser(viewButton.dataset.adminManage);
    if (statusButton) { await api(`/api/admin/users/${statusButton.dataset.adminStatus}/status`, { method: "PATCH", body: JSON.stringify({ active: statusButton.dataset.active === "true" }) }); await loadAdmin(); }
  } catch (error) { setMessage(els.appMessage, error.message); }
});
$("#adminAvatar").addEventListener("change", async () => {
  try { $("#adminAvatarPreview").src = await resizeProfileImage($("#adminAvatar").files[0]) || state.selectedAdminUser?.avatarData || "/brand-icon-192"; }
  catch (error) { setMessage($("#adminClientMessage"), error.message); }
});
$("#adminProfileForm").addEventListener("submit", async (event) => {
  event.preventDefault(); setMessage($("#adminClientMessage"));
  if (!state.selectedAdminUser) return;
  try {
    const avatarData = $("#adminAvatar").files[0] ? await resizeProfileImage($("#adminAvatar").files[0]) : state.selectedAdminUser.avatarData;
    const body = { name: $("#adminClientName").value, avatarData };
    if (state.selectedAdminUser.identifierType === "email") body.email = $("#adminClientEmail").value;
    await api(`/api/admin/users/${state.selectedAdminUser.id}`, { method: "PATCH", body: JSON.stringify(body) });
    await loadAdmin(); await showAdminUser(state.selectedAdminUser.id);
    setMessage($("#adminClientMessage"), "Dados do cliente atualizados.", true);
  } catch (error) { setMessage($("#adminClientMessage"), error.message); }
});
$("#adminPasswordForm").addEventListener("submit", async (event) => {
  event.preventDefault(); setMessage($("#adminClientMessage"));
  if (!state.selectedAdminUser) return;
  if ($("#adminClientPassword").value !== $("#adminClientPasswordConfirm").value) return setMessage($("#adminClientMessage"), "As senhas não coincidem.");
  try {
    const result = await api(`/api/admin/users/${state.selectedAdminUser.id}/password`, { method: "PATCH", body: JSON.stringify({ password: $("#adminClientPassword").value }) });
    $("#adminClientPassword").value = ""; $("#adminClientPasswordConfirm").value = "";
    setMessage($("#adminClientMessage"), result.message, true);
  } catch (error) { setMessage($("#adminClientMessage"), error.message); }
});


$("#themeToggle").addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});
applyTheme(document.documentElement.dataset.theme, false);

els.monthFilter.value = new Date().toISOString().slice(0, 7);
$("#todayLabel").textContent = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
setWorkspace("Casa", false);
setCardDateDefaults();
if (new URLSearchParams(location.search).get("cadastro") === "1") setAuthView("register");
if (new URLSearchParams(location.search).get("reset_token")) $("#resetPasswordDialog").showModal();
api("/api/session").then((result) => enterApp(result.user)).catch(showAuth);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(() => {});
