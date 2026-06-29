import { createHash } from "node:crypto";
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
import { createStorage } from "./storage.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const profiles = ["Casa", "Empresa"];
const categories = ["Moradia", "Servicos", "Cartao", "Impostos", "Saude", "Equipe", "Outros"];
const registerSchema = z.object({ identifier: z.string().min(5).max(320), password: z.string().min(8).max(72) });
const billSchema = z.object({
  name: z.string().trim().min(2).max(160),
  amount: z.coerce.number().positive().max(999999999.99),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  profile: z.enum(profiles),
  category: z.enum(categories),
  status: z.enum(["pending", "paid"]),
});
const cardSchema = z.object({
  name: z.string().trim().min(2).max(120),
  limit: z.coerce.number().positive().max(999999999.99),
  closeDay: z.coerce.number().int().min(1).max(31),
  dueDay: z.coerce.number().int().min(1).max(31),
  profile: z.enum(profiles),
});

export async function createApp(options = {}) {
  const env = options.env || process.env;
  const production = env.NODE_ENV === "production";
  const sessionSecret = resolveSecret(options.sessionSecret || env.SESSION_SECRET, "session", env, production);
  const cpfPepper = resolveSecret(options.cpfPepper || env.CPF_PEPPER, "cpf", env, production);
  if (production && (sessionSecret.length < 32 || cpfPepper.length < 32)) throw new Error("SESSION_SECRET e CPF_PEPPER devem ter pelo menos 32 caracteres.");
  const storage = options.storage || await createStorage(env);
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-origin" } }));
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
  const setSession = (res, user) => {
    const token = jwt.sign({ sub: user.id, role: user.role }, sessionSecret, { expiresIn: "7d", issuer: "gestao-financeira" });
    res.cookie("finance_session", token, { httpOnly: true, secure: production, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000, path: "/" });
  };
  const authenticate = async (req, res, next) => {
    try {
      const payload = jwt.verify(req.cookies.finance_session || "", sessionSecret, { issuer: "gestao-financeira" });
      const user = await storage.getUser(payload.sub);
      if (!user?.active) return res.status(401).json({ error: "Sessão inválida." });
      req.user = user;
      return next();
    } catch {
      return res.status(401).json({ error: "Faça login para continuar." });
    }
  };
  const adminOnly = (req, res, next) => req.user.role === "admin" ? next() : res.status(403).json({ error: "Acesso restrito ao administrador." });

  app.post("/api/register", authLimiter, asyncRoute(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const identity = normalizeIdentifier(input.identifier, cpfPepper);
    const existing = await storage.findUser(identity.type, identity.lookup);
    if (existing) return res.status(409).json({ error: "Já existe uma conta com esse e-mail ou CPF." });
    const passwordHash = await bcrypt.hash(input.password, 12);
    const adminEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();
    const user = await storage.createUser({
      email: identity.email,
      cpfHash: identity.cpfHash,
      lookup: identity.lookup,
      identifierType: identity.type,
      identifierLabel: identity.label,
      passwordHash,
      role: identity.type === "email" && identity.email === adminEmail ? "admin" : "user",
    });
    setSession(res, user);
    return res.status(201).json({ user });
  }));

  app.post("/api/login", authLimiter, asyncRoute(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const identity = normalizeIdentifier(input.identifier, cpfPepper);
    const user = await storage.findUser(identity.type, identity.lookup);
    if (!user || !user.active || !(await bcrypt.compare(input.password, user.passwordHash))) return res.status(401).json({ error: "E-mail/CPF ou senha incorretos." });
    setSession(res, user);
    return res.json({ user: sanitizeUser(user) });
  }));

  app.post("/api/logout", (_req, res) => {
    res.clearCookie("finance_session", { httpOnly: true, secure: production, sameSite: "lax", path: "/" });
    res.status(204).end();
  });
  app.get("/api/session", authenticate, (req, res) => res.json({ user: req.user }));
  app.get("/api/data", authenticate, asyncRoute(async (req, res) => res.json(await storage.listData(req.user.id))));

  app.post("/api/bills", authenticate, asyncRoute(async (req, res) => res.status(201).json(await storage.createBill(req.user.id, billSchema.parse(req.body)))));
  app.put("/api/bills/:id", authenticate, asyncRoute(async (req, res) => {
    const bill = await storage.updateBill(req.user.id, req.params.id, billSchema.parse(req.body));
    return bill ? res.json(bill) : res.status(404).json({ error: "Conta não encontrada." });
  }));
  app.delete("/api/bills/:id", authenticate, asyncRoute(async (req, res) => {
    const deleted = await storage.deleteBill(req.user.id, req.params.id);
    return deleted ? res.status(204).end() : res.status(404).json({ error: "Conta não encontrada." });
  }));
  app.post("/api/cards", authenticate, asyncRoute(async (req, res) => res.status(201).json(await storage.createCard(req.user.id, cardSchema.parse(req.body)))));
  app.delete("/api/cards/:id", authenticate, asyncRoute(async (req, res) => {
    const deleted = await storage.deleteCard(req.user.id, req.params.id);
    return deleted ? res.status(204).end() : res.status(404).json({ error: "Cartão não encontrado." });
  }));

  app.get("/api/admin/overview", authenticate, adminOnly, asyncRoute(async (_req, res) => res.json(await storage.adminOverview())));
  app.get("/api/admin/users", authenticate, adminOnly, asyncRoute(async (_req, res) => res.json({ users: await storage.adminUsers() })));
  app.get("/api/admin/users/:id/data", authenticate, adminOnly, asyncRoute(async (req, res) => {
    const user = await storage.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
    return res.json({ user, ...await storage.listData(req.params.id) });
  }));
  app.patch("/api/admin/users/:id/status", authenticate, adminOnly, asyncRoute(async (req, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ error: "Você não pode desativar sua própria conta." });
    const active = z.object({ active: z.boolean() }).parse(req.body).active;
    const user = await storage.setUserActive(req.params.id, active);
    return user ? res.json({ user }) : res.status(404).json({ error: "Usuário não encontrado." });
  }));

  app.use("/api", (_req, res) => res.status(404).json({ error: "Rota não encontrada." }));
  const distRoot = path.join(root, "dist");
  const hasBuild = existsSync(path.join(distRoot, "index.html"));
  if (hasBuild) {
    app.use(express.static(distRoot, { index: false, maxAge: production ? "1h" : 0 }));
  } else {
    ["app.js", "styles.css", "manifest.webmanifest", "service-worker.js", "icon.svg"].forEach((file) => {
      app.get(`/${file}`, (_req, res) => res.sendFile(path.join(root, file)));
    });
  }
  app.use((req, res, next) => req.method === "GET" && req.accepts("html") ? res.sendFile(path.join(hasBuild ? distRoot : root, "index.html")) : next());
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Revise os dados informados." });
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "Conta já cadastrada." });
    console.error(error);
    return res.status(500).json({ error: "Não foi possível concluir a operação." });
  });
  return app;
}

function sanitizeUser(user) {
  return { id: user.id, identifierType: user.identifierType, identifierLabel: user.identifierLabel, role: user.role, active: user.active, createdAt: user.createdAt };
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
