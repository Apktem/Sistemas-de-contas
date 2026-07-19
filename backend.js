import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { normalizeIdentifier } from "./auth.js";
import { SupportMailer } from "./mailer.js";
import { isPixSubscription, MercadoPagoSubscriptions, normalizePixPayment, normalizeSubscription, pixPaymentDetails, subscriptionPlan } from "./payments.js";
import { createStorage } from "./storage.js";
import { runPushDispatch, startPushWorker, WebPushService } from "./push.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const profiles = ["Casa", "Empresa"];
const categories = ["Moradia", "Servicos", "Cartao", "Impostos", "Saude", "Equipe", "Outros"];
const categorySchema = z.object({ name: z.string().trim().min(2).max(40).regex(/^[\p{L}\p{N}][\p{L}\p{N} .&/-]*$/u) });
const avatarSchema = z.string().max(350000).regex(/^data:image\/(jpeg|png|webp);base64,/).nullable().optional();
const loginSchema = z.object({ identifier: z.string().min(5).max(320), password: z.string().min(8).max(72) });
const registerSchema = loginSchema.extend({ name: z.string().trim().min(2).max(100).optional(), avatarData: avatarSchema });
const forgotPasswordSchema = z.object({ email: z.string().trim().email().max(320) });
const resetPasswordSchema = z.object({ token: z.string().min(40).max(200), password: z.string().min(8).max(72) });
const adminProfileSchema = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(320).optional(), avatarData: avatarSchema });
const adminPasswordSchema = z.object({ password: z.string().min(8).max(72) });
const adminPlanSchema = z.object({ plan: z.enum(["free", "pro"]) });
const feedbackSchema = z.object({ rating: z.coerce.number().int().min(1).max(10), message: z.string().trim().min(3).max(2000) });
const feedbackReplySchema = z.object({ response: z.string().trim().min(2).max(2000) });
const accountantSchema = z.object({ email: z.string().trim().email().max(320) });
const shoppingItemSchema = z.object({ name: z.string().trim().min(1).max(100), category: z.string().trim().min(2).max(40), quantity: z.coerce.number().positive().max(9999), unit: z.enum(["un", "kg", "g", "L", "ml", "pct", "cx"]) });
const shoppingUpdateSchema = z.object({ checked: z.boolean() });
const shoppingCheckoutSchema = z.object({ amount: z.coerce.number().positive().max(999999999.99), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const appointmentSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/), description: z.string().trim().min(2).max(180), notes: z.string().trim().max(500).optional().default(""), profile: z.enum(profiles).optional().default("Casa") });
const financialEntrySchema = z.object({
  type: z.enum(["income", "variable_expense", "receivable"]),
  profile: z.enum(profiles),
  description: z.string().trim().min(2).max(160),
  amount: z.coerce.number().positive().max(999999999.99),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().trim().min(2).max(40),
  status: z.enum(["pending", "settled"]),
  notes: z.string().trim().max(500).optional().default(""),
});const billSchema = z.object({
  name: z.string().trim().min(2).max(160),
  amount: z.coerce.number().positive().max(999999999.99),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  profile: z.enum(profiles),
  category: z.string().trim().min(2).max(40),
  status: z.enum(["pending", "paid"]),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
});
const billCreateSchema = billSchema.extend({
  installments: z.coerce.number().int().min(1).max(60).default(1),
  recurring: z.boolean().default(false),
});
const cardSchema = z.object({
  name: z.string().trim().min(2).max(120),
  limit: z.coerce.number().positive().max(999999999.99),
  closeDay: z.coerce.number().int().min(1).max(31),
  dueDay: z.coerce.number().int().min(1).max(31),
  profile: z.enum(profiles),
});
const checkoutSchema = z.object({ payerEmail: z.string().trim().email().max(320) });
const notificationSchema = z.object({ pushEnabled: z.boolean(), reminderDays: z.coerce.number().int().min(1).max(30) });
const incomeSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), profile: z.enum(profiles), amount: z.coerce.number().nonnegative().max(999999999.99) });
const pushSubscriptionSchema = z.object({ endpoint: z.string().url().max(2048), keys: z.object({ p256dh: z.string().min(20).max(512), auth: z.string().min(8).max(256) }) });
const freeLimits = { billsPerMonth: 10, cards: 1, monthlyIncome: 3000, shoppingPurchase: 500 };

export async function createApp(options = {}) {
  const env = options.env || process.env;
  const production = env.NODE_ENV === "production";
  const sessionSecret = resolveSecret(options.sessionSecret || env.SESSION_SECRET, "session", env, production);
  const cpfPepper = resolveSecret(options.cpfPepper || env.CPF_PEPPER, "cpf", env, production);
  if (production && (sessionSecret.length < 32 || cpfPepper.length < 32)) throw new Error("SESSION_SECRET e CPF_PEPPER devem ter pelo menos 32 caracteres.");
  const storage = options.storage || await createStorage(env);
  const payments = options.payments || new MercadoPagoSubscriptions({ accessToken: env.MERCADOPAGO_ACCESS_TOKEN, siteUrl: env.SITE_URL || "https://ricoxp.com", price: env.PRO_PRICE || 29.9 });
  const mailer = options.mailer || new SupportMailer({ host: env.SMTP_HOST, port: env.SMTP_PORT || 465, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM || "RicoXP <contato@ricoxp.com>", siteUrl: env.SITE_URL || "https://ricoxp.com" });
  const push = options.push || new WebPushService({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || `mailto:${env.ADMIN_EMAIL || "suporte@ricoxp.com"}` });
  const adminEmail = String(env.ADMIN_EMAIL || "apktemoficial@gmail.com").trim().toLowerCase();
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-origin" } }));
  app.use(express.json({ limit: "512kb" }));
  app.use(cookieParser());

  const sessionMaxAge = 30 * 24 * 60 * 60 * 1000;
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
  const setSession = (res, user) => {
    const token = jwt.sign({ sub: user.id, role: user.role }, sessionSecret, { expiresIn: "30d", issuer: "gestao-financeira" });
    res.cookie("finance_session", token, { httpOnly: true, secure: production, sameSite: "lax", priority: "high", maxAge: sessionMaxAge, path: "/" });
  };
  const ensureAdminRole = async (user) => {
    const isConfiguredAdmin = user?.identifierType === "email" && user.identifierLabel?.toLowerCase() === adminEmail;
    if (!isConfiguredAdmin || user.role === "admin") return user;
    return await storage.setUserRole(user.id, "admin") || { ...user, role: "admin" };
  };
  const authenticate = async (req, res, next) => {
    try {
      const payload = jwt.verify(req.cookies.finance_session || "", sessionSecret, { issuer: "gestao-financeira" });
      let user = await storage.getUser(payload.sub);
      if (!user?.active) return res.status(401).json({ error: "Sessão inválida." });
      user = await ensureAdminRole(user);
      req.user = user;
      return next();
    } catch {
      return res.status(401).json({ error: "Faça login para continuar." });
    }
  };
  const adminOnly = (req, res, next) => req.user.role === "admin" ? next() : res.status(403).json({ error: "Acesso restrito ao administrador." });
  const getAccess = async (user) => {
    const subscription = await storage.getSubscription(user.id);
    return { subscription, plan: subscriptionPlan(subscription, user.role) };
  };
  const ensureProfileAccess = async (user, profile) => {
    const access = await getAccess(user);
    if (profile === "Empresa" && access.plan !== "pro") throw serviceError("A área Empresa é exclusiva do plano Pro.", 402);
    return access;
  };
  const ensureCategoryAccess = async (userId, category) => {
    if (categories.some((item) => item.toLocaleLowerCase("pt-BR") === category.toLocaleLowerCase("pt-BR"))) return;
    const custom = await storage.listCategories(userId);
    if (!custom.some((item) => item.name.toLocaleLowerCase("pt-BR") === category.toLocaleLowerCase("pt-BR"))) throw serviceError("Categoria personalizada inválida.", 400);
  };
  const ensureBillCapacity = async (user, entries, excludedId = null) => {
    const access = await getAccess(user);
    if (access.plan === "pro") return;
    const data = await storage.listData(user.id);
    const existing = data.bills.filter((item) => item.id !== excludedId && item.profile === "Casa");
    const months = new Set(entries.map((item) => item.dueDate.slice(0, 7)));
    for (const month of months) {
      const count = existing.filter((item) => item.dueDate.startsWith(month)).length + entries.filter((item) => item.dueDate.startsWith(month)).length;
      if (count > freeLimits.billsPerMonth) throw serviceError(`O plano gratis permite ${freeLimits.billsPerMonth} contas por mes. Assine o Pro para continuar.`, 402);
    }
  };
  const listDataWithRecurringHorizon = async (user) => {
    const data = await storage.listData(user.id);
    const access = await getAccess(user);
    const recurring = data.bills.filter((bill) => bill.seriesType === "recurring" && bill.seriesId && (access.plan === "pro" || bill.profile === "Casa"));
    const targetDate = addMonths(localDate(), 11);
    const entries = [];
    for (const seriesId of new Set(recurring.map((bill) => bill.seriesId))) {
      const series = recurring.filter((bill) => bill.seriesId === seriesId).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const first = series[0];
      const latest = series[series.length - 1];
      for (let index = monthDifference(first.dueDate, latest.dueDate) + 1, dueDate = addMonths(first.dueDate, index); dueDate <= targetDate; index += 1, dueDate = addMonths(first.dueDate, index)) {
        entries.push({ ...latest, id: undefined, dueDate, status: "pending" });
      }
    }
    if (!entries.length) return data;
    await ensureBillCapacity(user, entries);
    await storage.createBills(user.id, entries);
    return storage.listData(user.id);
  };

  app.post("/api/register", authLimiter, asyncRoute(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const identity = normalizeIdentifier(input.identifier, cpfPepper);
    const existing = await storage.findUser(identity.type, identity.lookup);
    if (existing) return res.status(409).json({ error: "Já existe uma conta com esse e-mail ou CPF." });
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await storage.createUser({
      email: identity.email,
      cpfHash: identity.cpfHash,
      lookup: identity.lookup,
      identifierType: identity.type,
      identifierLabel: identity.label,
      name: input.name || identity.label,
      avatarData: input.avatarData || null,
      passwordHash,
      role: identity.type === "email" && identity.email === adminEmail ? "admin" : "user",
    });
    setSession(res, user);
    return res.status(201).json({ user });
  }));

  app.post("/api/login", authLimiter, asyncRoute(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const identity = normalizeIdentifier(input.identifier, cpfPepper);
    let user = await storage.findUser(identity.type, identity.lookup);
    if (!user || !user.active || !(await bcrypt.compare(input.password, user.passwordHash))) return res.status(401).json({ error: "E-mail/CPF ou senha incorretos." });
    user = await ensureAdminRole(user);
    setSession(res, user);
    return res.json({ user: sanitizeUser(user) });
  }));

  app.post("/api/password/forgot", authLimiter, asyncRoute(async (req, res) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    if (!mailer.configured) return res.status(503).json({ error: "A recuperação por e-mail ainda não foi configurada." });
    const user = await storage.findUser("email", email.toLowerCase());
    if (user?.active) {
      const token = `${randomUUID()}${randomUUID()}`.replaceAll("-", "");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await storage.createPasswordResetToken(user.id, tokenHash, new Date(Date.now() + 30 * 60 * 1000).toISOString());
      await mailer.sendPasswordReset({ email: user.email, name: user.name, token });
    }
    return res.json({ message: "Se o e-mail estiver cadastrado, enviaremos um link válido por 30 minutos." });
  }));

  app.post("/api/password/reset", authLimiter, asyncRoute(async (req, res) => {
    const { token, password } = resetPasswordSchema.parse(req.body);
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const userId = await storage.consumePasswordResetToken(tokenHash);
    if (!userId) return res.status(400).json({ error: "Este link é inválido ou expirou. Solicite uma nova recuperação." });
    await storage.updateUserPassword(userId, await bcrypt.hash(password, 12));
    return res.json({ message: "Senha atualizada. Você já pode entrar no RicoXP." });
  }));

  app.post("/api/logout", (_req, res) => {
    res.clearCookie("finance_session", { httpOnly: true, secure: production, sameSite: "lax", path: "/" });
    res.status(204).end();
  });
  app.get("/api/session", authenticate, (req, res) => {
    setSession(res, req.user);
    return res.json({ user: sanitizeUser(req.user) });
  });
  app.get("/api/data", authenticate, asyncRoute(async (req, res) => {
    const [data, access] = await Promise.all([listDataWithRecurringHorizon(req.user), getAccess(req.user)]);
    if (access.plan === "pro") return res.json(data);
    return res.json({ bills: data.bills.filter((bill) => bill.profile === "Casa"), cards: data.cards.filter((card) => card.profile === "Casa"), incomes: data.incomes.filter((income) => income.profile === "Casa"), categories: data.categories || [], financialEntries: (data.financialEntries || []).filter((entry) => entry.profile === "Casa"), shoppingItems: data.shoppingItems || [], appointments: (data.appointments || []).filter((item) => (item.profile || "Casa") === "Casa") });
  }));
  app.post("/api/categories", authenticate, asyncRoute(async (req, res) => {
    const { name } = categorySchema.parse(req.body);
    const existing = [...categories.map((item) => ({ name: item })), ...await storage.listCategories(req.user.id)];
    if (existing.some((item) => item.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) return res.status(409).json({ error: "Esta categoria já existe." });
    return res.status(201).json(await storage.createCategory(req.user.id, name));
  }));
  app.put("/api/income", authenticate, asyncRoute(async (req, res) => {
    const input = incomeSchema.parse(req.body);
    const access = await ensureProfileAccess(req.user, input.profile);
    if (access.plan !== "pro" && input.amount > freeLimits.monthlyIncome) return res.status(402).json({ error: "O plano Grátis permite renda mensal de até R$ 3.000. Assine o Pro para cadastrar valores maiores." });
    return res.json(await storage.upsertIncome(req.user.id, input));
  }));
  app.get("/api/notifications/preferences", authenticate, asyncRoute(async (req, res) => {
    const access = await getAccess(req.user);
    return res.json({ ...await storage.getNotificationPreferences(req.user.id), configured: push.configured, publicKey: push.configured ? push.publicKey : null, available: access.plan === "pro" });
  }));
  app.put("/api/notifications/preferences", authenticate, asyncRoute(async (req, res) => {
    const input = notificationSchema.parse(req.body);
    const access = await getAccess(req.user);
    if (input.pushEnabled && access.plan !== "pro") return res.status(402).json({ error: "Notificações automáticas são exclusivas do plano Pro." });
    if (input.pushEnabled && !push.configured) return res.status(503).json({ error: "Notificações push ainda não configuradas." });
    const preferences = await storage.upsertNotificationPreferences(req.user.id, input);
    return res.json({ ...preferences, configured: push.configured, publicKey: push.configured ? push.publicKey : null, available: access.plan === "pro" });
  }));
  app.post("/api/notifications/subscriptions", authenticate, asyncRoute(async (req, res) => {
    const access = await getAccess(req.user);
    if (access.plan !== "pro") return res.status(402).json({ error: "Notificações automáticas são exclusivas do plano Pro." });
    if (!push.configured) return res.status(503).json({ error: "Notificações push ainda não configuradas." });
    return res.status(201).json(await storage.upsertPushSubscription(req.user.id, pushSubscriptionSchema.parse(req.body)));
  }));
  app.delete("/api/notifications/subscriptions", authenticate, asyncRoute(async (req, res) => {
    const endpoint = z.object({ endpoint: z.string().url().max(2048) }).parse(req.body).endpoint;
    await storage.deletePushSubscription(req.user.id, endpoint);
    return res.status(204).end();
  }));

  app.post("/api/appointments", authenticate, asyncRoute(async (req, res) => { const input = appointmentSchema.parse(req.body); await ensureProfileAccess(req.user, input.profile); return res.status(201).json(await storage.createAppointment(req.user.id, input)); }));
  app.put("/api/appointments/:id", authenticate, asyncRoute(async (req, res) => { const input = appointmentSchema.parse(req.body); await ensureProfileAccess(req.user, input.profile); const item = await storage.updateAppointment(req.user.id, req.params.id, input); return item ? res.json(item) : res.status(404).json({ error: "Compromisso nao encontrado." }); }));
  app.delete("/api/appointments/:id", authenticate, asyncRoute(async (req, res) => (await storage.deleteAppointment(req.user.id, req.params.id)) ? res.status(204).end() : res.status(404).json({ error: "Compromisso nao encontrado." })));

  app.post("/api/shopping-items", authenticate, asyncRoute(async (req, res) => res.status(201).json(await storage.createShoppingItem(req.user.id, shoppingItemSchema.parse(req.body)))));
  app.patch("/api/shopping-items/:id", authenticate, asyncRoute(async (req, res) => { const item = await storage.updateShoppingItem(req.user.id, req.params.id, shoppingUpdateSchema.parse(req.body)); return item ? res.json(item) : res.status(404).json({ error: "Item não encontrado." }); }));
  app.post("/api/shopping-items/checkout", authenticate, asyncRoute(async (req, res) => {
    const input = shoppingCheckoutSchema.parse(req.body);
    const access = await getAccess(req.user);
    if (access.plan !== "pro" && input.amount > freeLimits.shoppingPurchase) return res.status(402).json({ error: "O plano Grátis permite finalizar compras de até R$ 500. Assine o Pro para lançar valores maiores." });
    const data = await storage.listData(req.user.id);
    const checkedCount = (data.shoppingItems || []).filter((item) => item.checked).length;
    const entry = await storage.createFinancialEntry(req.user.id, { type: "variable_expense", profile: "Casa", description: "Compra no supermercado", amount: input.amount, date: input.date, category: "Supermercado", status: "settled", notes: checkedCount ? `${checkedCount} ${checkedCount === 1 ? "item comprado" : "itens comprados"}` : "Compra finalizada pela lista de compras" });
    const removed = checkedCount ? await storage.clearCheckedShoppingItems(req.user.id) : 0;
    return res.status(201).json({ entry, removed });
  }));
  app.delete("/api/shopping-items/checked", authenticate, asyncRoute(async (req, res) => res.json({ removed: await storage.clearCheckedShoppingItems(req.user.id) })));
  app.delete("/api/shopping-items/:id", authenticate, asyncRoute(async (req, res) => (await storage.deleteShoppingItem(req.user.id, req.params.id)) ? res.status(204).end() : res.status(404).json({ error: "Item não encontrado." })));
  app.post("/api/financial-entries", authenticate, asyncRoute(async (req, res) => {
    const input = financialEntrySchema.parse(req.body);
    await ensureProfileAccess(req.user, input.profile);
    return res.status(201).json(await storage.createFinancialEntry(req.user.id, input));
  }));
  app.put("/api/financial-entries/:id", authenticate, asyncRoute(async (req, res) => {
    const input = financialEntrySchema.parse(req.body);
    await ensureProfileAccess(req.user, input.profile);
    const entry = await storage.updateFinancialEntry(req.user.id, req.params.id, input);
    return entry ? res.json(entry) : res.status(404).json({ error: "Lançamento não encontrado." });
  }));
  app.delete("/api/financial-entries/:id", authenticate, asyncRoute(async (req, res) => {
    const deleted = await storage.deleteFinancialEntry(req.user.id, req.params.id);
    return deleted ? res.status(204).end() : res.status(404).json({ error: "Lançamento não encontrado." });
  }));
  app.post("/api/bills", authenticate, asyncRoute(async (req, res) => {
    const input = billCreateSchema.parse(req.body);
    if (input.recurring && input.installments > 1) return res.status(400).json({ error: "Conta fixa mensal não deve ter parcelas." });
    const access = await ensureProfileAccess(req.user, input.profile);
    if (input.installments > 1 && access.plan !== "pro") return res.status(402).json({ error: "Contas parceladas são exclusivas do plano Pro." });
    await ensureCategoryAccess(req.user.id, input.category);
    const entries = createBillEntries(input);
    await ensureBillCapacity(req.user, entries);
    return res.status(201).json({ bills: await storage.createBills(req.user.id, entries) });
  }));
  app.put("/api/bills/:id", authenticate, asyncRoute(async (req, res) => {
    const existing = await storage.getBill(req.user.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Conta não encontrada." });
    const input = billSchema.parse(req.body);
    await ensureProfileAccess(req.user, input.profile);
    await ensureCategoryAccess(req.user.id, input.category);
    const entry = { ...input, seriesId: existing.seriesId, seriesType: existing.seriesType, installmentNumber: existing.installmentNumber, installmentTotal: existing.installmentTotal };
    await ensureBillCapacity(req.user, [entry], req.params.id);
    const bill = await storage.updateBill(req.user.id, req.params.id, entry);
    return bill ? res.json(bill) : res.status(404).json({ error: "Conta não encontrada." });
  }));
  app.post("/api/bills/:id/clone", authenticate, asyncRoute(async (req, res) => {
    const access = await getAccess(req.user);
    if (access.plan !== "pro") return res.status(402).json({ error: "Clonagem mensal é exclusiva do plano Pro." });
    const existing = await storage.getBill(req.user.id, req.params.id);
    if (!existing) return res.status(404).json({ error: "Conta não encontrada." });
    if (existing.seriesType !== "single") return res.status(400).json({ error: "Esta conta já possui repetição automática." });
    const cloned = { ...existing, id: undefined, dueDate: addMonths(existing.dueDate, 1), status: "pending", seriesId: existing.seriesId || randomUUID(), seriesType: "recurring", installmentNumber: null, installmentTotal: null };
    await ensureBillCapacity(req.user, [cloned]);
    return res.status(201).json(await storage.createBill(req.user.id, cloned));
  }));
  app.delete("/api/bills/:id", authenticate, asyncRoute(async (req, res) => {
    const deleted = await storage.deleteBill(req.user.id, req.params.id);
    return deleted ? res.status(204).end() : res.status(404).json({ error: "Conta não encontrada." });
  }));
  app.post("/api/cards", authenticate, asyncRoute(async (req, res) => {
    const card = cardSchema.parse(req.body);
    const access = await ensureProfileAccess(req.user, card.profile);
    if (access.plan === "free") {
      const data = await storage.listData(req.user.id);
      if (data.cards.filter((item) => item.profile === "Casa").length >= freeLimits.cards) return res.status(402).json({ error: `O plano gratis permite ${freeLimits.cards} cartao na Casa. Assine o Pro para continuar.` });
    }
    return res.status(201).json(await storage.createCard(req.user.id, card));
  }));
  app.delete("/api/cards/:id", authenticate, asyncRoute(async (req, res) => {
    const deleted = await storage.deleteCard(req.user.id, req.params.id);
    return deleted ? res.status(204).end() : res.status(404).json({ error: "Cartão não encontrado." });
  }));

  app.get("/api/subscription", authenticate, asyncRoute(async (req, res) => {
    const { subscription, plan } = await getAccess(req.user);
    return res.json(subscriptionResponse(subscription, plan, payments));
  }));
  app.post("/api/subscription/checkout", authenticate, authLimiter, asyncRoute(async (req, res) => {
    const { payerEmail } = checkoutSchema.parse(req.body);
    const current = await storage.getSubscription(req.user.id);
    if (subscriptionPlan(current, req.user.role) === "pro") return res.status(409).json({ error: "Sua assinatura Pro ja esta ativa." });
    const remote = await payments.create(req.user.id, payerEmail.toLowerCase());
    const subscription = await storage.upsertSubscription(normalizeSubscription(remote));
    return res.status(201).json({ checkoutUrl: remote.init_point, subscription: subscriptionResponse(subscription, subscriptionPlan(subscription, req.user.role), payments) });
  }));
  app.post("/api/subscription/pix", authenticate, authLimiter, asyncRoute(async (req, res) => {
    const { payerEmail } = checkoutSchema.parse(req.body);
    const current = await storage.getSubscription(req.user.id);
    if (subscriptionPlan(current, req.user.role) === "pro") return res.status(409).json({ error: "Seu plano Pro ja esta ativo." });
    const remote = await payments.createPix(req.user.id, payerEmail.toLowerCase(), randomUUID());
    const subscription = await storage.upsertSubscription(normalizePixPayment(remote));
    return res.status(201).json({ subscription: subscriptionResponse(subscription, subscriptionPlan(subscription, req.user.role), payments, pixPaymentDetails(remote)) });
  }));
  app.post("/api/subscription/sync", authenticate, asyncRoute(async (req, res) => {
    const current = await storage.getSubscription(req.user.id);
    if (!current?.providerId) return res.json(subscriptionResponse(null, subscriptionPlan(null, req.user.role), payments));
    const remote = isPixSubscription(current) ? await payments.getPayment(current.providerId) : await payments.get(current.providerId);
    if (remote.external_reference !== req.user.id) return res.status(403).json({ error: "Assinatura invalida." });
    const subscription = await storage.upsertSubscription(isPixSubscription(current) ? normalizePixPayment(remote) : normalizeSubscription(remote));
    return res.json(subscriptionResponse(subscription, subscriptionPlan(subscription, req.user.role), payments, isPixSubscription(subscription) ? pixPaymentDetails(remote) : null));
  }));
  app.post("/api/subscription/cancel", authenticate, asyncRoute(async (req, res) => {
    const current = await storage.getSubscription(req.user.id);
    if (!current?.providerId) return res.status(404).json({ error: "Assinatura nao encontrada." });
    if (isPixSubscription(current)) return res.status(400).json({ error: "O Pix nao possui renovacao automatica para cancelar." });
    const remote = await payments.cancel(current.providerId);
    const subscription = await storage.upsertSubscription(normalizeSubscription(remote));
    return res.json(subscriptionResponse(subscription, subscriptionPlan(subscription, req.user.role), payments));
  }));
  app.post("/api/webhooks/mercadopago", asyncRoute(async (req, res) => {
    const providerId = String(req.query["data.id"] || req.body?.data?.id || "");
    if (!providerId) return res.status(200).json({ received: true });
    const current = await storage.getSubscriptionByProviderId(providerId);
    if (!current) return res.status(200).json({ received: true });
    const type = String(req.query.type || req.query.topic || req.body?.type || "");
    const pix = type === "payment" || isPixSubscription(current);
    const remote = pix ? await payments.getPayment(providerId) : await payments.get(providerId);
    const user = remote.external_reference === current.userId ? await storage.getUser(current.userId) : null;
    if (user) await storage.upsertSubscription(pix ? normalizePixPayment(remote) : normalizeSubscription(remote));
    return res.status(200).json({ received: true });
  }));

  app.get("/api/accountants", authenticate, asyncRoute(async (req, res) => res.json({ accountants: await storage.listAccountants(req.user.id) })));
  app.post("/api/accountants", authenticate, asyncRoute(async (req, res) => {
    const access = await getAccess(req.user);
    if (access.plan !== "pro") return res.status(402).json({ error: "O acesso do contador é exclusivo do plano Pro." });
    const { email } = accountantSchema.parse(req.body);
    if (req.user.email?.toLowerCase() === email.toLowerCase()) return res.status(400).json({ error: "Informe o e-mail do contador." });
    return res.status(201).json(await storage.grantAccountant(req.user.id, email.toLowerCase()));
  }));
  app.delete("/api/accountants/:id", authenticate, asyncRoute(async (req, res) => (await storage.deleteAccountant(req.user.id, req.params.id)) ? res.status(204).end() : res.status(404).json({ error: "Acesso não encontrado." })));
  app.get("/api/accountant/companies", authenticate, asyncRoute(async (req, res) => res.json({ companies: req.user.email ? await storage.listAccountantCompanies(req.user.email.toLowerCase()) : [] })));
  app.get("/api/accountant/companies/:ownerId", authenticate, asyncRoute(async (req, res) => {
    if (!req.user.email) return res.status(403).json({ error: "Acesso contábil exige uma conta com e-mail." });
    const companies = await storage.listAccountantCompanies(req.user.email.toLowerCase());
    const company = companies.find((item) => item.ownerUserId === req.params.ownerId);
    if (!company) return res.status(403).json({ error: "Empresa não compartilhada com esta conta." });
    const data = await listDataWithRecurringHorizon({ id: req.params.ownerId, role: "user" });
    return res.json({ company, bills: data.bills.filter((item) => item.profile === "Empresa"), financialEntries: (data.financialEntries || []).filter((item) => item.profile === "Empresa") });
  }));
  app.get("/api/feedback", authenticate, asyncRoute(async (req, res) => res.json({ feedbacks: await storage.listFeedback(req.user.id) })));
  app.post("/api/feedback", authenticate, asyncRoute(async (req, res) => res.status(201).json(await storage.createFeedback(req.user.id, feedbackSchema.parse(req.body)))));

  app.get("/api/admin/overview", authenticate, adminOnly, asyncRoute(async (_req, res) => res.json(await storage.adminOverview())));
  app.get("/api/admin/feedback", authenticate, adminOnly, asyncRoute(async (_req, res) => res.json({ feedbacks: await storage.adminFeedback() })));
  app.patch("/api/admin/feedback/:id", authenticate, adminOnly, asyncRoute(async (req, res) => {
    const feedback = await storage.replyFeedback(req.params.id, feedbackReplySchema.parse(req.body).response);
    return feedback ? res.json(feedback) : res.status(404).json({ error: "Feedback não encontrado." });
  }));
  app.post("/api/admin/notifications/run", authenticate, adminOnly, asyncRoute(async (_req, res) => res.json(await runPushDispatch(storage, push))));
  app.get("/api/admin/users", authenticate, adminOnly, asyncRoute(async (_req, res) => res.json({ users: await storage.adminUsers() })));
  app.get("/api/admin/users/:id", authenticate, adminOnly, asyncRoute(async (req, res) => {
    const user = await storage.adminUser(req.params.id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
    return res.json({ user });
  }));
  app.patch("/api/admin/users/:id", authenticate, adminOnly, asyncRoute(async (req, res) => {
    const input = adminProfileSchema.parse(req.body);
    const user = await storage.updateUserProfile(req.params.id, { ...input, email: input.email?.toLowerCase() });
    return user ? res.json({ user }) : res.status(404).json({ error: "Usuário não encontrado." });
  }));
  app.patch("/api/admin/users/:id/password", authenticate, adminOnly, authLimiter, asyncRoute(async (req, res) => {
    const { password } = adminPasswordSchema.parse(req.body);
    const updated = await storage.updateUserPassword(req.params.id, await bcrypt.hash(password, 12));
    return updated ? res.json({ message: "Senha do cliente atualizada." }) : res.status(404).json({ error: "Usuário não encontrado." });
  }));
  app.patch("/api/admin/users/:id/plan", authenticate, adminOnly, asyncRoute(async (req, res) => {
    const targetUser = await storage.adminUser(req.params.id);
    if (!targetUser) return res.status(404).json({ error: "Usuario nao encontrado." });
    const { plan } = adminPlanSchema.parse(req.body);
    await storage.upsertSubscription({
      userId: req.params.id,
      providerId: `manual:${req.params.id}`,
      payerEmail: targetUser.email || targetUser.identifierLabel || null,
      status: plan === "pro" ? "authorized" : "cancelled",
      nextPaymentDate: null,
      updatedAt: new Date().toISOString(),
    });
    const user = await storage.adminUser(req.params.id);
    return res.json({ user, message: plan === "pro" ? "Plano Pro liberado para este cliente." : "Cliente voltou ao Plano Gratis." });
  }));
  app.patch("/api/admin/users/:id/status", authenticate, adminOnly, asyncRoute(async (req, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ error: "Você não pode desativar sua própria conta." });
    const active = z.object({ active: z.boolean() }).parse(req.body).active;
    const user = await storage.setUserActive(req.params.id, active);
    return user ? res.json({ user }) : res.status(404).json({ error: "Usuário não encontrado." });
  }));

  app.use("/api", (_req, res) => res.status(404).json({ error: "Rota não encontrada." }));
  const brandAssets = {
    "/brand-icon-32": "ricoxp-icon-32.png",
    "/brand-icon-180": "ricoxp-icon-180.png",
    "/brand-icon-192": "ricoxp-icon-192.png",
    "/brand-icon-512": "ricoxp-icon-512.png",
    "/brand-social": "ricoxp-social.png",
  };
  Object.entries(brandAssets).forEach(([route, file]) => {
    app.get(route, (_req, res) => {
      res.type("png");
      res.set("Cache-Control", "public, max-age=86400");
      res.sendFile(path.join(root, "assets", file));
    });
  });
  app.get("/.well-known/assetlinks.json", (_req, res) => {
    const packageName = process.env.ANDROID_PACKAGE_NAME || "com.ricoxp.app";
    const fingerprints = (process.env.ANDROID_SHA256_CERT_FINGERPRINTS || "")
      .split(",")
      .map((fingerprint) => fingerprint.trim())
      .filter(Boolean);
    if (!fingerprints.length) {
      return res.status(404).json({ error: "Android asset links ainda nao configurado." });
    }
    res.type("application/json");
    res.set("Cache-Control", "public, max-age=3600");
    return res.json([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: packageName,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ]);
  });
  app.get("/app-manifest", (_req, res) => {
    res.type("application/manifest+json");
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(root, "manifest.webmanifest"));
  });
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain");
    res.set("Cache-Control", "public, max-age=3600");
    res.sendFile(path.join(root, "robots.txt"));
  });
  app.get("/sitemap.xml", (_req, res) => {
    res.type("application/xml");
    res.set("Cache-Control", "public, max-age=3600");
    res.sendFile(path.join(root, "sitemap.xml"));
  });
  const noStoreAppShell = (res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    res.set("Surrogate-Control", "no-store");
  };
  const distRoot = path.join(root, "dist");
  const hasBuild = existsSync(path.join(distRoot, "index.html"));
  if (hasBuild) {
    app.use(express.static(distRoot, { index: false, maxAge: production ? "1h" : 0, setHeaders: (res, filePath) => {
      if (/index\.html$|landing\.html$|privacy\.html$|service-worker\.js$/i.test(filePath)) noStoreAppShell(res);
    } }));
  } else {
    ["app.js", "styles.css", "landing.css", "landing.js", "manifest.webmanifest", "service-worker.js", "icon.svg"].forEach((file) => {
      app.get(`/${file}`, (_req, res) => { if (file === "service-worker.js") noStoreAppShell(res); else if (["app.js", "styles.css"].includes(file)) res.set("Cache-Control", "public, max-age=86400"); res.sendFile(path.join(root, file)); });
    });
  }
  const pageRoot = hasBuild ? distRoot : root;
  app.get("/", (_req, res) => { noStoreAppShell(res); res.sendFile(path.join(pageRoot, "landing.html")); });
  app.get(["/privacy", "/privacy/", "/privacidade", "/privacidade/"], (_req, res) => { noStoreAppShell(res); res.sendFile(path.join(pageRoot, "privacy.html")); });
  app.get(["/login", "/login/"], (_req, res) => { noStoreAppShell(res); res.sendFile(path.join(pageRoot, "index.html")); });
  app.use((req, res, next) => { if (req.method === "GET" && req.accepts("html")) { noStoreAppShell(res); return res.sendFile(path.join(pageRoot, "index.html")); } return next(); });
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Revise os dados informados." });
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Conta já cadastrada." });
    console.error(error);
    return res.status(error.status || 500).json({ error: error.status ? error.message : "Não foi possível concluir a operação." });
  });
  if (production && push.configured && options.startWorkers !== false) startPushWorker(storage, push);
  return app;
}

function subscriptionResponse(subscription, plan, payments, pix = null) {
  return { plan, status: subscription?.status || null, billingType: isPixSubscription(subscription) ? "pix" : subscription?.status ? "card" : null, payerEmail: subscription?.payerEmail || null, nextPaymentDate: subscription?.nextPaymentDate || null, price: payments.price, configured: payments.configured, pix, limits: plan === "pro" ? null : freeLimits };
}

function createBillEntries(input) {
  const { installments, recurring, ...bill } = input;
  if (recurring) {
    const seriesId = randomUUID();
    return Array.from({ length: 12 }, (_, index) => ({
      ...bill,
      dueDate: addMonths(bill.dueDate, index),
      status: index === 0 ? bill.status : "pending",
      seriesId,
      seriesType: "recurring",
      installmentNumber: null,
      installmentTotal: null,
    }));
  }
  if (installments === 1) return [{ ...bill, seriesType: "single" }];
  const seriesId = randomUUID();
  return Array.from({ length: installments }, (_, index) => ({
    ...bill,
    name: `${bill.name} (${index + 1}/${installments})`,
    dueDate: addMonths(bill.dueDate, index),
    status: "pending",
    seriesId,
    seriesType: "installment",
    installmentNumber: index + 1,
    installmentTotal: installments,
  }));
}

function addMonths(value, months) {
  const [year, month, day] = value.split("-").map(Number);
  const target = new Date(year, month - 1 + months, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(day, lastDay));
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function monthDifference(from, to) {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return (toYear - fromYear) * 12 + toMonth - fromMonth;
}

function serviceError(message, status) { const error = new Error(message); error.status = status; return error; }

function sanitizeUser(user) {
  return { id: user.id, email: user.email || null, identifierType: user.identifierType, identifierLabel: user.identifierLabel, name: user.name || user.identifierLabel, avatarData: user.avatarData || null, role: user.role, active: user.active, createdAt: user.createdAt };
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function resolveSecret(value, purpose, env, production) {
  if (value) return value;
  if (env.SUPABASE_API_KEY) return createHash("sha256").update(`${purpose}:${env.SUPABASE_API_KEY}`).digest("hex");
  if (production) throw new Error(`Segredo de ${purpose} não configurado.`);
  return `development-${purpose}-secret-change-me-now`;
}
