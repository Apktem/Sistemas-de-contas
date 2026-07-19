import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { isValidCpf } from "../auth.js";
import { createApp } from "../backend.js";
import { normalizePixPayment, subscriptionPlan } from "../payments.js";
import { MemoryStorage } from "../storage.js";
import { runPushDispatch } from "../push.js";

test("valida CPF", () => {
  assert.equal(isValidCpf("529.982.247-25"), true);
  assert.equal(isValidCpf("111.111.111-11"), false);
});

test("isola dados e restringe administração", async (context) => {
  const storage = new MemoryStorage();
  const app = await createApp({
    storage,
    sessionSecret: "test-session-secret-with-more-than-32-characters",
    cpfPepper: "test-cpf-pepper-with-more-than-32-characters",
    env: { ADMIN_EMAIL: "admin@example.com" },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const admin = await post(base, "/api/register", { identifier: "admin@example.com", password: "SenhaForte123" });
  assert.equal(admin.body.user.role, "admin");
  const adminCookie = admin.cookie;
  const createdBill = await post(base, "/api/bills", { name: "Aluguel", amount: 900, dueDate: "2026-07-10", profile: "Casa", category: "Moradia", status: "pending" }, adminCookie);
  assert.equal(createdBill.status, 201);

  const common = await post(base, "/api/register", { identifier: "529.982.247-25", password: "OutraSenha123" });
  assert.equal(common.body.user.role, "user");
  const commonData = await get(base, "/api/data", common.cookie);
  assert.equal(commonData.body.bills.length, 0);
  const forbidden = await get(base, "/api/admin/users", common.cookie);
  assert.equal(forbidden.status, 403);

  const overview = await get(base, "/api/admin/overview", adminCookie);
  assert.equal(overview.body.users, 2);
  assert.equal(overview.body.bills, 1);
});

test("promove automaticamente o e-mail principal para administrador", async (context) => {
  const storage = new MemoryStorage();
  const commonOptions = {
    storage,
    sessionSecret: "test-session-secret-with-more-than-32-characters",
    cpfPepper: "test-cpf-pepper-with-more-than-32-characters",
  };
  const initialApp = await createApp({ ...commonOptions, env: { ADMIN_EMAIL: "outro@example.com" } });
  const initialServer = initialApp.listen(0, "127.0.0.1");
  await once(initialServer, "listening");
  const initialBase = `http://127.0.0.1:${initialServer.address().port}`;
  const registered = await post(initialBase, "/api/register", { identifier: "apktemoficial@gmail.com", password: "SenhaForte123" });
  assert.equal(registered.body.user.role, "user");
  await new Promise((resolve) => initialServer.close(resolve));

  const app = await createApp({ ...commonOptions, env: {} });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await post(base, "/api/login", { identifier: "apktemoficial@gmail.com", password: "SenhaForte123" });
  assert.equal(login.body.user.role, "admin");
  assert.equal((await storage.findUser("email", "apktemoficial@gmail.com")).role, "admin");
});

test("cadastra nome e foto no perfil do cliente", async (context) => {
  const storage = new MemoryStorage();
  const app = await createApp({ storage, sessionSecret: "test-session-secret-with-more-than-32-characters", cpfPepper: "test-cpf-pepper-with-more-than-32-characters", env: { ADMIN_EMAIL: "admin@example.com" } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const avatarData = "data:image/jpeg;base64,dGVzdGU=";
  const account = await post(base, "/api/register", { name: "Maria Silva", identifier: "maria@example.com", avatarData, password: "SenhaForte123" });
  assert.equal(account.status, 201);
  assert.equal(account.body.user.name, "Maria Silva");
  assert.equal(account.body.user.avatarData, avatarData);
});

test("recupera a senha por token temporario enviado por email", async (context) => {
  const storage = new MemoryStorage();
  let resetToken;
  const mailer = { configured: true, async sendPasswordReset(data) { resetToken = data.token; } };
  const app = await createApp({ storage, mailer, sessionSecret: "test-session-secret-with-more-than-32-characters", cpfPepper: "test-cpf-pepper-with-more-than-32-characters", env: { ADMIN_EMAIL: "admin@example.com" } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  await post(base, "/api/register", { name: "Cliente Teste", identifier: "recuperar@example.com", password: "SenhaAntiga123" });
  const request = await post(base, "/api/password/forgot", { email: "recuperar@example.com" });
  assert.equal(request.status, 200);
  assert.ok(resetToken);
  const reset = await post(base, "/api/password/reset", { token: resetToken, password: "SenhaNova123" });
  assert.equal(reset.status, 200);
  assert.equal((await post(base, "/api/login", { identifier: "recuperar@example.com", password: "SenhaNova123" })).status, 200);
  assert.equal((await post(base, "/api/password/reset", { token: resetToken, password: "OutraSenha123" })).status, 400);
});

test("administrador gerencia perfil sem acessar o financeiro do cliente", async (context) => {
  const storage = new MemoryStorage();
  const app = await createApp({ storage, sessionSecret: "test-session-secret-with-more-than-32-characters", cpfPepper: "test-cpf-pepper-with-more-than-32-characters", env: { ADMIN_EMAIL: "admin@example.com" } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const admin = await post(base, "/api/register", { name: "Administrador", identifier: "admin@example.com", password: "SenhaForte123" });
  const client = await post(base, "/api/register", { name: "Cliente", identifier: "cliente-admin@example.com", password: "SenhaCliente123" });
  await post(base, "/api/bills", { name: "Conta privada", amount: 200, dueDate: "2026-07-10", profile: "Casa", category: "Moradia", status: "pending" }, client.cookie);
  const detail = await get(base, `/api/admin/users/${client.body.user.id}`, admin.cookie);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.user.name, "Cliente");
  assert.equal("bills" in detail.body, false);
  assert.equal("cards" in detail.body, false);
  const updated = await patch(base, `/api/admin/users/${client.body.user.id}`, { name: "Cliente Atualizada", email: "cliente-novo@example.com", avatarData: null }, admin.cookie);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.user.identifierLabel, "cliente-novo@example.com");
  assert.equal((await patch(base, `/api/admin/users/${client.body.user.id}/password`, { password: "SenhaTemporaria123" }, admin.cookie)).status, 200);
  assert.equal((await post(base, "/api/login", { identifier: "cliente-novo@example.com", password: "SenhaTemporaria123" })).status, 200);
});

test("aplica limites gratis e libera recursos apos assinatura Pro", async (context) => {
  const storage = new MemoryStorage();
  let remoteStatus = "pending";
  const payments = {
    configured: true,
    price: 29.9,
    async create(userId, payerEmail) { return { id: "sub-123", external_reference: userId, payer_email: payerEmail, status: remoteStatus, init_point: "https://checkout.example/sub-123" }; },
    async get(id) { return { id, external_reference: storage.users[0].id, payer_email: "cliente@example.com", status: remoteStatus }; },
    async cancel(id) { return { id, external_reference: storage.users[0].id, payer_email: "cliente@example.com", status: "cancelled" }; },
  };
  const app = await createApp({
    storage,
    payments,
    sessionSecret: "test-session-secret-with-more-than-32-characters",
    cpfPepper: "test-cpf-pepper-with-more-than-32-characters",
    env: { ADMIN_EMAIL: "admin@example.com" },
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const account = await post(base, "/api/register", { identifier: "cliente@example.com", password: "SenhaForte123" });
  const card = { name: "Nubank", limit: 1000, closeDay: 5, dueDay: 12, profile: "Casa" };
  const companyBill = { name: "Contabilidade", amount: 300, dueDate: "2026-07-15", profile: "Empresa", category: "Impostos", status: "pending", tags: [], installments: 1 };
  assert.equal((await post(base, "/api/bills", companyBill, account.cookie)).status, 402);
  assert.equal((await post(base, "/api/cards", { ...card, profile: "Empresa" }, account.cookie)).status, 402);
  assert.equal((await post(base, "/api/cards", card, account.cookie)).status, 201);
  assert.equal((await post(base, "/api/cards", { ...card, name: "Inter" }, account.cookie)).status, 402);

  const checkout = await post(base, "/api/subscription/checkout", { payerEmail: "cliente@example.com" }, account.cookie);
  assert.equal(checkout.status, 201);
  assert.equal(checkout.body.checkoutUrl, "https://checkout.example/sub-123");
  remoteStatus = "authorized";
  const synced = await post(base, "/api/subscription/sync", {}, account.cookie);
  assert.equal(synced.body.plan, "pro");
  assert.equal((await post(base, "/api/bills", companyBill, account.cookie)).status, 201);
  assert.equal((await post(base, "/api/cards", { ...card, name: "Inter" }, account.cookie)).status, 201);
});

test("libera o Pro por 30 dias apos a confirmacao do Pix", async (context) => {
  const storage = new MemoryStorage();
  let pixStatus = "pending";
  let userId;
  const pixRemote = () => ({
    id: "pix-123",
    external_reference: userId,
    status: pixStatus,
    date_approved: pixStatus === "approved" ? "2026-07-01T12:00:00.000Z" : null,
    date_last_updated: "2026-07-01T12:00:00.000Z",
    payer: { email: "pix@example.com" },
    point_of_interaction: { transaction_data: { qr_code: "000201PIX", qr_code_base64: "base64-png", ticket_url: "https://pix.example/pay" } },
  });
  const payments = {
    configured: true,
    price: 29.9,
    async createPix(id) { userId = id; return pixRemote(); },
    async getPayment() { return pixRemote(); },
  };
  const app = await createApp({ storage, payments, sessionSecret: "test-session-secret-with-more-than-32-characters", cpfPepper: "test-cpf-pepper-with-more-than-32-characters", env: { ADMIN_EMAIL: "admin@example.com" } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const account = await post(base, "/api/register", { identifier: "pix@example.com", password: "SenhaForte123" });
  const checkout = await post(base, "/api/subscription/pix", { payerEmail: "pix@example.com" }, account.cookie);
  assert.equal(checkout.status, 201);
  assert.equal(checkout.body.subscription.status, "pix_pending");
  assert.equal(checkout.body.subscription.pix.qrCode, "000201PIX");

  pixStatus = "approved";
  const webhook = await post(base, "/api/webhooks/mercadopago", { type: "payment", data: { id: "pix-123" } });
  assert.equal(webhook.status, 200);
  const subscription = await get(base, "/api/subscription", account.cookie);
  assert.equal(subscription.body.plan, "pro");
  assert.equal(subscription.body.billingType, "pix");
  assert.equal(subscription.body.nextPaymentDate, "2026-07-31T12:00:00.000Z");
});

test("expira o acesso Pix ao final dos 30 dias", () => {
  const active = normalizePixPayment({ id: "1", external_reference: "user", status: "approved", date_approved: new Date(Date.now() - 29 * 86400000).toISOString() });
  const expired = normalizePixPayment({ id: "2", external_reference: "user", status: "approved", date_approved: new Date(Date.now() - 31 * 86400000).toISOString() });
  assert.equal(subscriptionPlan(active), "pro");
  assert.equal(subscriptionPlan(expired), "free");
});

test("cria parcelas futuras com tags e clona contas recorrentes", async (context) => {
  const storage = new MemoryStorage();
  const app = await createApp({ storage, sessionSecret: "test-session-secret-with-more-than-32-characters", cpfPepper: "test-cpf-pepper-with-more-than-32-characters", env: { ADMIN_EMAIL: "admin@example.com" } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const account = await post(base, "/api/register", { identifier: "admin@example.com", password: "SenhaForte123" });
  const installment = await post(base, "/api/bills", { name: "Notebook", amount: 100, dueDate: "2026-07-10", profile: "Empresa", category: "Cartao", status: "pending", tags: ["equipamento"], installments: 3 }, account.cookie);
  assert.equal(installment.body.bills.length, 3);
  assert.deepEqual(installment.body.bills.map((bill) => bill.dueDate), ["2026-07-10", "2026-08-10", "2026-09-10"]);
  assert.deepEqual(installment.body.bills.map((bill) => bill.amount), [100, 100, 100]);
  assert.equal(installment.body.bills.reduce((sum, bill) => sum + bill.amount, 0), 300);
  assert.equal(installment.body.bills[0].tags[0], "equipamento");

  const fixed = await post(base, "/api/bills", { name: "Internet", amount: 120, dueDate: "2026-07-25", profile: "Casa", category: "Servicos", status: "pending", tags: [], installments: 1, recurring: true }, account.cookie);
  assert.equal(fixed.status, 201);
  assert.equal(fixed.body.bills.length, 12);
  assert.deepEqual(fixed.body.bills.slice(0, 3).map((bill) => bill.dueDate), ["2026-07-25", "2026-08-25", "2026-09-25"]);
  assert.ok(fixed.body.bills.every((bill) => bill.amount === 120 && bill.seriesType === "recurring"));

  const recurring = await post(base, "/api/bills", { name: "Aluguel", amount: 900, dueDate: "2026-07-31", profile: "Casa", category: "Moradia", status: "pending", tags: ["fixa"], installments: 1 }, account.cookie);
  const cloned = await post(base, `/api/bills/${recurring.body.bills[0].id}/clone`, {}, account.cookie);
  assert.equal(cloned.body.dueDate, "2026-08-31");
  assert.equal(cloned.body.seriesType, "recurring");
  assert.deepEqual(cloned.body.tags, ["fixa"]);
});

test("registra lançamentos separados por área e usuário", async (context) => {
  const storage = new MemoryStorage();
  const app = await createApp({ storage, sessionSecret: "test-session-secret-with-more-than-32-characters", cpfPepper: "test-cpf-pepper-with-more-than-32-characters", env: { ADMIN_EMAIL: "admin@example.com" } });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const admin = await post(base, "/api/register", { identifier: "admin@example.com", password: "SenhaForte123" });
  const user = await post(base, "/api/register", { identifier: "movimentos@example.com", password: "SenhaForte123" });
  assert.equal((await post(base, "/api/financial-entries", { type: "income", profile: "Casa", description: "Salário", amount: 5000, date: "2026-07-05", category: "Salário", status: "settled", notes: "" }, user.cookie)).status, 201);
  assert.equal((await post(base, "/api/financial-entries", { type: "income", profile: "Empresa", description: "Venda", amount: 8000, date: "2026-07-05", category: "Vendas", status: "settled", notes: "" }, user.cookie)).status, 402);
  const company = await post(base, "/api/financial-entries", { type: "receivable", profile: "Empresa", description: "Cliente A", amount: 2500, date: "2026-07-10", category: "Serviços", status: "pending", notes: "NF 10" }, admin.cookie);
  assert.equal(company.status, 201);
  assert.equal((await get(base, "/api/data", user.cookie)).body.financialEntries.length, 1);
  assert.equal((await get(base, "/api/data", admin.cookie)).body.financialEntries[0].profile, "Empresa");
});

test("contador acessa DRE compartilhada somente para leitura", async (context) => {
  const storage = new MemoryStorage();
  const app = await createApp({ storage, sessionSecret: "test-session-secret-with-more-than-32-characters", cpfPepper: "test-cpf-pepper-with-more-than-32-characters", env: { ADMIN_EMAIL: "admin@example.com" } });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const owner = await post(base, "/api/register", { identifier: "admin@example.com", password: "SenhaForte123" });
  const accountant = await post(base, "/api/register", { identifier: "contador@example.com", password: "SenhaForte123" });
  const outsider = await post(base, "/api/register", { identifier: "outro@example.com", password: "SenhaForte123" });
  const entry = await post(base, "/api/financial-entries", { type: "income", profile: "Empresa", description: "Venda", amount: 9000, date: "2026-07-05", category: "Vendas", status: "settled", notes: "" }, owner.cookie);
  assert.equal((await post(base, "/api/accountants", { email: "contador@example.com" }, owner.cookie)).status, 201);
  const companies = await get(base, "/api/accountant/companies", accountant.cookie);
  assert.equal(companies.body.companies.length, 1);
  assert.equal((await get(base, `/api/accountant/companies/${owner.body.user.id}`, accountant.cookie)).body.financialEntries[0].amount, 9000);
  assert.equal((await get(base, `/api/accountant/companies/${owner.body.user.id}`, outsider.cookie)).status, 403);
  assert.equal((await put(base, `/api/financial-entries/${entry.body.id}`, { ...entry.body, amount: 1 }, accountant.cookie)).status, 402);
});

test("lista de compras é privada, limita o total grátis e lança no financeiro", async (context) => {
  const storage = new MemoryStorage();
  const app = await createApp({ storage, sessionSecret: "test-session-secret-with-more-than-32-characters", cpfPepper: "test-cpf-pepper-with-more-than-32-characters", env: { ADMIN_EMAIL: "admin@example.com" } });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening"); context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const first = await post(base, "/api/register", { identifier: "compras1@example.com", password: "SenhaForte123" });
  const second = await post(base, "/api/register", { identifier: "compras2@example.com", password: "SenhaForte123" });
  const admin = await post(base, "/api/register", { identifier: "admin@example.com", password: "SenhaForte123" });
  const item = await post(base, "/api/shopping-items", { name: "Carne bovina", category: "Carnes e peixes", quantity: 2, unit: "kg" }, first.cookie);
  assert.equal(item.status, 201);
  assert.equal((await get(base, "/api/data", second.cookie)).body.shoppingItems.length, 0);
  assert.equal((await patch(base, `/api/shopping-items/${item.body.id}`, { checked: true }, first.cookie)).body.checked, true);
  const blocked = await post(base, "/api/shopping-items/checkout", { amount: 500.01, date: "2026-07-06" }, first.cookie);
  assert.equal(blocked.status, 402);
  assert.match(blocked.body.error, /R\$ 500/);
  assert.equal((await get(base, "/api/data", first.cookie)).body.shoppingItems.length, 1);
  const checkout = await post(base, "/api/shopping-items/checkout", { amount: 500, date: "2026-07-06" }, first.cookie);
  assert.equal(checkout.status, 201);
  assert.equal(checkout.body.entry.amount, 500);
  assert.equal(checkout.body.removed, 1);
  const data = (await get(base, "/api/data", first.cookie)).body;
  assert.equal(data.shoppingItems.length, 0);
  assert.equal(data.financialEntries[0].description, "Compra no supermercado");
  assert.equal((await post(base, "/api/shopping-items/checkout", { amount: 900, date: "2026-07-06" }, admin.cookie)).status, 201);
});
test("isola categorias personalizadas por usuário", async (context) => {
  const storage = new MemoryStorage();
  const app = await createApp({ storage, sessionSecret: "test-session-secret-with-more-than-32-characters", cpfPepper: "test-cpf-pepper-with-more-than-32-characters", env: { ADMIN_EMAIL: "admin@example.com" } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const first = await post(base, "/api/register", { identifier: "admin@example.com", password: "SenhaForte123" });
  const second = await post(base, "/api/register", { identifier: "categoria2@example.com", password: "SenhaForte123" });
  assert.equal((await post(base, "/api/categories", { name: "Educação" }, first.cookie)).status, 201);
  assert.equal((await get(base, "/api/data", second.cookie)).body.categories.length, 0);
  const foreignCategory = await post(base, "/api/bills", { name: "Curso", amount: 100, dueDate: "2026-07-10", profile: "Casa", category: "Educação", status: "pending", tags: [], installments: 1 }, second.cookie);
  assert.equal(foreignCategory.status, 400);
  assert.equal((await post(base, "/api/categories", { name: "Educação" }, second.cookie)).status, 201);
  assert.equal((await post(base, "/api/bills", { name: "Curso", amount: 100, dueDate: "2026-07-10", profile: "Casa", category: "Educação", status: "pending", tags: [], installments: 1 }, second.cookie)).status, 201);
  assert.deepEqual((await get(base, "/api/data", first.cookie)).body.categories.map((category) => category.name), ["Educação"]);
});
test("salva renda mensal isolada por usuário, mês e área", async (context) => {
  const storage = new MemoryStorage();
  const app = await createApp({ storage, sessionSecret: "test-session-secret-with-more-than-32-characters", cpfPepper: "test-cpf-pepper-with-more-than-32-characters", env: { ADMIN_EMAIL: "admin@example.com" } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const first = await post(base, "/api/register", { identifier: "admin@example.com", password: "SenhaForte123" });
  const second = await post(base, "/api/register", { identifier: "renda2@example.com", password: "SenhaForte123" });
  const home = await put(base, "/api/income", { month: "2026-07", profile: "Casa", amount: 10000 }, first.cookie);
  const company = await put(base, "/api/income", { month: "2026-07", profile: "Empresa", amount: 20000 }, first.cookie);
  assert.equal(home.status, 200);
  assert.equal(company.status, 200);
  const incomes = (await get(base, "/api/data", first.cookie)).body.incomes;
  assert.deepEqual(incomes.map((income) => [income.profile, income.amount]), [["Casa", 10000], ["Empresa", 20000]]);
  const freeIncome = await put(base, "/api/income", { month: "2026-07", profile: "Casa", amount: 3000 }, second.cookie);
  const aboveFreeLimit = await put(base, "/api/income", { month: "2026-07", profile: "Casa", amount: 3000.01 }, second.cookie);
  const freeCompany = await put(base, "/api/income", { month: "2026-07", profile: "Empresa", amount: 1000 }, second.cookie);
  assert.equal(freeIncome.status, 200);
  assert.equal(aboveFreeLimit.status, 402);
  assert.match(aboveFreeLimit.body.error, /R\$ 3\.000/);
  assert.equal(freeCompany.status, 402);
  assert.deepEqual((await get(base, "/api/data", second.cookie)).body.incomes.map((income) => [income.profile, income.amount]), [["Casa", 3000]]);
});
test("cliente envia feedback e administrador responde sem expor mensagens de terceiros", async (context) => {
  const storage = new MemoryStorage();
  const app = await createApp({ storage, sessionSecret: "test-session-secret-with-more-than-32-characters", cpfPepper: "test-cpf-pepper-with-more-than-32-characters", env: { ADMIN_EMAIL: "admin@example.com" } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const admin = await post(base, "/api/register", { identifier: "admin@example.com", password: "SenhaForte123" });
  const client = await post(base, "/api/register", { identifier: "feedback@example.com", password: "SenhaForte123" });
  const created = await post(base, "/api/feedback", { rating: 9, message: "Painel muito útil." }, client.cookie);
  assert.equal(created.status, 201);
  assert.equal((await get(base, "/api/feedback", client.cookie)).body.feedbacks.length, 1);
  assert.equal((await get(base, "/api/feedback", admin.cookie)).body.feedbacks.length, 0);
  const inbox = await get(base, "/api/admin/feedback", admin.cookie);
  assert.equal(inbox.body.feedbacks[0].rating, 9);
  assert.equal(inbox.body.feedbacks[0].user.identifierLabel, "feedback@example.com");
  const reply = await patch(base, `/api/admin/feedback/${created.body.id}`, { response: "Obrigado pela avaliação!" }, admin.cookie);
  assert.equal(reply.status, 200);
  assert.equal((await get(base, "/api/feedback", client.cookie)).body.feedbacks[0].response, "Obrigado pela avaliação!");
  assert.equal((await get(base, "/api/admin/feedback", client.cookie)).status, 403);
});
test("agenda isola compromissos por usuario e notifica no horario", async (context) => {
  const storage = new MemoryStorage();
  const app = await createApp({ storage, sessionSecret: "test-session-secret-with-more-than-32-characters", cpfPepper: "test-cpf-pepper-with-more-than-32-characters", env: { ADMIN_EMAIL: "admin@example.com" } });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const first = await post(base, "/api/register", { identifier: "agenda1@example.com", password: "SenhaForte123" });
  const second = await post(base, "/api/register", { identifier: "agenda2@example.com", password: "SenhaForte123" });
  const created = await post(base, "/api/appointments", { date: "2026-07-19", time: "18:30", description: "Reuniao com cliente", notes: "Levar contrato" }, first.cookie);
  assert.equal(created.status, 201);
  assert.equal((await get(base, "/api/data", first.cookie)).body.appointments.length, 1);
  assert.equal((await get(base, "/api/data", second.cookie)).body.appointments.length, 0);
  await storage.upsertNotificationPreferences(first.body.user.id, { pushEnabled: true, reminderDays: 2 });
  await storage.upsertPushSubscription(first.body.user.id, { endpoint: "https://push.example/agenda", keys: { p256dh: "public-key", auth: "auth-key" } });
  let sends = 0;
  const push = { configured: true, async send(_subscription, reminder) { sends += 1; assert.equal(reminder.type, "appointment"); } };
  assert.deepEqual(await runPushDispatch(storage, push, new Date("2026-07-19T18:29:00")), { sent: 0, failed: 0 });
  assert.deepEqual(await runPushDispatch(storage, push, new Date("2026-07-19T18:31:00")), { sent: 1, failed: 0 });
  assert.deepEqual(await runPushDispatch(storage, push, new Date("2026-07-19T18:40:00")), { sent: 0, failed: 0 });
  assert.equal(sends, 1);
});
test("envia cada notificação push uma unica vez", async () => {
  const storage = new MemoryStorage();
  const user = await storage.createUser({ email: "alerta@example.com", lookup: "alerta@example.com", identifierType: "email", identifierLabel: "alerta@example.com", passwordHash: "hash", role: "user" });
  await storage.upsertNotificationPreferences(user.id, { pushEnabled: true, reminderDays: 2 });
  await storage.upsertPushSubscription(user.id, { endpoint: "https://push.example/device", keys: { p256dh: "public-key", auth: "auth-key" } });
  await storage.createBill(user.id, { name: "Internet", amount: 100, dueDate: "2026-07-02", profile: "Casa", category: "Servicos", status: "pending", tags: ["fixa"] });
  let sends = 0;
  const push = { configured: true, async send() { sends += 1; } };
  assert.deepEqual(await runPushDispatch(storage, push, new Date("2026-06-30T12:00:00")), { sent: 1, failed: 0 });
  assert.deepEqual(await runPushDispatch(storage, push, new Date("2026-06-30T12:00:00")), { sent: 0, failed: 0 });
  assert.equal(sends, 1);
});

async function post(base, path, body, cookie = "") {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie };
}

async function get(base, path, cookie) {
  const response = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
  return { status: response.status, body: await response.json() };
}

async function put(base, path, body, cookie = "") {
  const response = await fetch(`${base}${path}`, { method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function remove(base, path, cookie = "") {
  const response = await fetch(`${base}${path}`, { method: "DELETE", headers: { Cookie: cookie } });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
async function patch(base, path, body, cookie = "") {
  const response = await fetch(`${base}${path}`, { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie };
}
