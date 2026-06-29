import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export class MemoryStorage {
  constructor() { this.users = []; this.bills = []; this.cards = []; }
  async findUser(type, lookup) { return this.users.find((user) => (type === "email" ? user.email === lookup : user.cpfHash === lookup)) || null; }
  async createUser(data) {
    if (await this.findUser(data.identifierType, data.lookup)) throw duplicateError();
    const user = { id: randomUUID(), ...data, active: true, createdAt: new Date().toISOString() };
    this.users.push(user); return publicUser(user);
  }
  async getUser(id) { const user = this.users.find((item) => item.id === id); return user ? publicUser(user) : null; }
  async listData(userId) { return { bills: this.bills.filter((item) => item.userId === userId), cards: this.cards.filter((item) => item.userId === userId) }; }
  async createBill(userId, data) { const bill = { id: randomUUID(), userId, ...data }; this.bills.push(bill); return bill; }
  async updateBill(userId, id, data) { const index = this.bills.findIndex((item) => item.id === id && item.userId === userId); if (index < 0) return null; this.bills[index] = { ...this.bills[index], ...data }; return this.bills[index]; }
  async deleteBill(userId, id) { const before = this.bills.length; this.bills = this.bills.filter((item) => !(item.id === id && item.userId === userId)); return this.bills.length < before; }
  async createCard(userId, data) { const card = { id: randomUUID(), userId, ...data }; this.cards.push(card); return card; }
  async deleteCard(userId, id) { const before = this.cards.length; this.cards = this.cards.filter((item) => !(item.id === id && item.userId === userId)); return this.cards.length < before; }
  async adminOverview() { return { users: this.users.length, activeUsers: this.users.filter((user) => user.active).length, bills: this.bills.length, totalAmount: this.bills.reduce((sum, bill) => sum + Number(bill.amount), 0) }; }
  async adminUsers() { return this.users.map((user) => ({ ...publicUser(user), billCount: this.bills.filter((bill) => bill.userId === user.id).length, totalAmount: this.bills.filter((bill) => bill.userId === user.id).reduce((sum, bill) => sum + Number(bill.amount), 0) })); }
  async setUserActive(id, active) { const user = this.users.find((item) => item.id === id); if (!user) return null; user.active = active; return publicUser(user); }
}

export function createStorage(env = process.env) {
  if (env.SUPABASE_URL && env.SUPABASE_API_KEY) {
    if (env.NODE_ENV === "production" && isPublicKey(env.SUPABASE_API_KEY)) throw new Error("SUPABASE_API_KEY precisa ser uma chave secreta/service_role para o servidor.");
    return new SupabaseStorage(createClient(env.SUPABASE_URL, env.SUPABASE_API_KEY, { auth: { persistSession: false, autoRefreshToken: false } }));
  }
  if (env.NODE_ENV === "production") throw new Error("Supabase não configurado. Defina SUPABASE_URL e SUPABASE_API_KEY.");
  return new MemoryStorage();
}

class SupabaseStorage {
  constructor(client) { this.client = client; }

  async findUser(type, lookup) {
    const field = type === "email" ? "email" : "cpf_hash";
    const { data, error } = await this.client.from("users").select("*").eq(field, lookup).maybeSingle();
    check(error); return data ? mapUser(data, true) : null;
  }

  async createUser(data) {
    const row = { id: randomUUID(), email: data.email || null, cpf_hash: data.cpfHash || null, identifier_type: data.identifierType, identifier_label: data.identifierLabel, password_hash: data.passwordHash, role: data.role };
    const { data: created, error } = await this.client.from("users").insert(row).select("id, identifier_type, identifier_label, role, active, created_at").single();
    if (error?.code === "23505") throw duplicateError();
    check(error); return mapUser(created);
  }

  async getUser(id) {
    const { data, error } = await this.client.from("users").select("id, identifier_type, identifier_label, role, active, created_at").eq("id", id).maybeSingle();
    check(error); return data ? mapUser(data) : null;
  }

  async listData(userId) {
    const [{ data: bills, error: billsError }, { data: cards, error: cardsError }] = await Promise.all([
      this.client.from("bills").select("id, name, amount, due_date, profile, category, status").eq("user_id", userId).order("due_date"),
      this.client.from("cards").select("id, name, credit_limit, close_day, due_day, profile").eq("user_id", userId).order("name"),
    ]);
    check(billsError); check(cardsError);
    return { bills: bills.map(mapBill), cards: cards.map(mapCard) };
  }

  async createBill(userId, data) {
    const row = toBillRow(randomUUID(), userId, data);
    const { data: created, error } = await this.client.from("bills").insert(row).select("id, name, amount, due_date, profile, category, status").single();
    check(error); return mapBill(created);
  }

  async updateBill(userId, id, data) {
    const row = toBillRow(id, userId, data);
    delete row.id; delete row.user_id;
    const { data: updated, error } = await this.client.from("bills").update(row).eq("id", id).eq("user_id", userId).select("id, name, amount, due_date, profile, category, status").maybeSingle();
    check(error); return updated ? mapBill(updated) : null;
  }

  async deleteBill(userId, id) {
    const { data, error } = await this.client.from("bills").delete().eq("id", id).eq("user_id", userId).select("id").maybeSingle();
    check(error); return Boolean(data);
  }

  async createCard(userId, data) {
    const row = { id: randomUUID(), user_id: userId, name: data.name, credit_limit: data.limit, close_day: data.closeDay, due_day: data.dueDay, profile: data.profile };
    const { data: created, error } = await this.client.from("cards").insert(row).select("id, name, credit_limit, close_day, due_day, profile").single();
    check(error); return mapCard(created);
  }

  async deleteCard(userId, id) {
    const { data, error } = await this.client.from("cards").delete().eq("id", id).eq("user_id", userId).select("id").maybeSingle();
    check(error); return Boolean(data);
  }

  async adminOverview() {
    const [usersResult, activeResult, billsResult] = await Promise.all([
      this.client.from("users").select("*", { count: "exact", head: true }),
      this.client.from("users").select("*", { count: "exact", head: true }).eq("active", true),
      this.client.from("bills").select("amount"),
    ]);
    check(usersResult.error); check(activeResult.error); check(billsResult.error);
    return { users: usersResult.count || 0, activeUsers: activeResult.count || 0, bills: billsResult.data.length, totalAmount: billsResult.data.reduce((sum, bill) => sum + Number(bill.amount), 0) };
  }

  async adminUsers() {
    const [{ data: users, error: usersError }, { data: bills, error: billsError }] = await Promise.all([
      this.client.from("users").select("id, identifier_type, identifier_label, role, active, created_at").order("created_at", { ascending: false }),
      this.client.from("bills").select("user_id, amount"),
    ]);
    check(usersError); check(billsError);
    return users.map((user) => {
      const userBills = bills.filter((bill) => bill.user_id === user.id);
      return { ...mapUser(user), billCount: userBills.length, totalAmount: userBills.reduce((sum, bill) => sum + Number(bill.amount), 0) };
    });
  }

  async setUserActive(id, active) {
    const { data, error } = await this.client.from("users").update({ active }).eq("id", id).select("id, identifier_type, identifier_label, role, active, created_at").maybeSingle();
    check(error); return data ? mapUser(data) : null;
  }
}

function toBillRow(id, userId, data) { return { id, user_id: userId, name: data.name, amount: data.amount, due_date: data.dueDate, profile: data.profile, category: data.category, status: data.status }; }
function mapBill(row) { return { id: row.id, name: row.name, amount: Number(row.amount), dueDate: row.due_date, profile: row.profile, category: row.category, status: row.status }; }
function mapCard(row) { return { id: row.id, name: row.name, limit: Number(row.credit_limit), closeDay: row.close_day, dueDay: row.due_day, profile: row.profile }; }
function mapUser(row, includePassword = false) {
  const user = { id: row.id, email: row.email, cpfHash: row.cpf_hash, identifierType: row.identifier_type, identifierLabel: row.identifier_label, role: row.role, active: Boolean(row.active), createdAt: row.created_at };
  if (includePassword) user.passwordHash = row.password_hash;
  return user;
}
function publicUser(user) { return { id: user.id, identifierType: user.identifierType, identifierLabel: user.identifierLabel, role: user.role, active: user.active, createdAt: user.createdAt }; }
function check(error) { if (error) { const wrapped = new Error(error.message); wrapped.code = error.code; throw wrapped; } }
function duplicateError() { const error = new Error("Conta já cadastrada."); error.code = "ER_DUP_ENTRY"; return error; }
function isPublicKey(key) {
  if (key.startsWith("sb_publishable_")) return true;
  try { return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "anon"; } catch { return false; }
}
