import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { isValidCpf } from "../auth.js";
import { createApp } from "../backend.js";
import { MemoryStorage } from "../storage.js";

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

async function post(base, path, body, cookie = "") {
  const response = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie };
}

async function get(base, path, cookie) {
  const response = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
  return { status: response.status, body: await response.json() };
}
