import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { isValidCpf } from "../auth.js";
import { createApp } from "../backend.js";
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
  assert.equal((await post(base, "/api/cards", card, account.cookie)).status, 201);
  assert.equal((await post(base, "/api/cards", { ...card, name: "Inter" }, account.cookie)).status, 402);

  const checkout = await post(base, "/api/subscription/checkout", { payerEmail: "cliente@example.com" }, account.cookie);
  assert.equal(checkout.status, 201);
  assert.equal(checkout.body.checkoutUrl, "https://checkout.example/sub-123");
  remoteStatus = "authorized";
  const synced = await post(base, "/api/subscription/sync", {}, account.cookie);
  assert.equal(synced.body.plan, "pro");
  assert.equal((await post(base, "/api/cards", { ...card, name: "Inter" }, account.cookie)).status, 201);
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
