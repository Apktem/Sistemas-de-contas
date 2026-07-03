import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export class MemoryStorage {
  constructor() { this.users = []; this.bills = []; this.cards = []; this.incomes = []; this.subscriptions = []; this.notificationPreferences = []; this.notificationDeliveries = []; this.pushSubscriptions = []; this.passwordResetTokens = []; }
  async findUser(type, lookup) { return this.users.find((user) => (type === "email" ? user.email === lookup : user.cpfHash === lookup)) || null; }
  async createUser(data) {
    if (await this.findUser(data.identifierType, data.lookup)) throw duplicateError();
    const user = { id: randomUUID(), ...data, active: true, createdAt: new Date().toISOString() };
    this.users.push(user); return publicUser(user);
  }
  async getUser(id) { const user = this.users.find((item) => item.id === id); return user ? publicUser(user) : null; }
  async updateUserProfile(id, data) { const user = this.users.find((item) => item.id === id); if (!user) return null; if (data.email && user.identifierType !== "email") throw profileEmailError(); Object.assign(user, data, data.email ? { identifierLabel: data.email } : {}); return publicUser(user); }
  async updateUserPassword(id, passwordHash) { const user = this.users.find((item) => item.id === id); if (!user) return false; user.passwordHash = passwordHash; return true; }
  async createPasswordResetToken(userId, tokenHash, expiresAt) { this.passwordResetTokens = this.passwordResetTokens.filter((item) => item.userId !== userId); this.passwordResetTokens.push({ userId, tokenHash, expiresAt, usedAt: null }); }
  async consumePasswordResetToken(tokenHash) { const token = this.passwordResetTokens.find((item) => item.tokenHash === tokenHash && !item.usedAt && new Date(item.expiresAt) > new Date()); if (!token) return null; token.usedAt = new Date().toISOString(); return token.userId; }
  async listData(userId) { return { bills: this.bills.filter((item) => item.userId === userId), cards: this.cards.filter((item) => item.userId === userId), incomes: this.incomes.filter((item) => item.userId === userId) }; }
  async getBill(userId, id) { return this.bills.find((item) => item.id === id && item.userId === userId) || null; }
  async createBill(userId, data) { const bill = { id: randomUUID(), userId, ...data }; this.bills.push(bill); return bill; }
  async createBills(userId, entries) { const bills = entries.map((data) => ({ id: randomUUID(), userId, ...data })); this.bills.push(...bills); return bills; }
  async updateBill(userId, id, data) { const index = this.bills.findIndex((item) => item.id === id && item.userId === userId); if (index < 0) return null; this.bills[index] = { ...this.bills[index], ...data }; return this.bills[index]; }
  async deleteBill(userId, id) { const before = this.bills.length; this.bills = this.bills.filter((item) => !(item.id === id && item.userId === userId)); return this.bills.length < before; }
  async createCard(userId, data) { const card = { id: randomUUID(), userId, ...data }; this.cards.push(card); return card; }
  async deleteCard(userId, id) { const before = this.cards.length; this.cards = this.cards.filter((item) => !(item.id === id && item.userId === userId)); return this.cards.length < before; }
  async upsertIncome(userId, data) { const index = this.incomes.findIndex((item) => item.userId === userId && item.month === data.month && item.profile === data.profile); const income = { id: index >= 0 ? this.incomes[index].id : randomUUID(), userId, ...data }; if (index >= 0) this.incomes[index] = income; else this.incomes.push(income); return income; }
  async getSubscription(userId) { return this.subscriptions.find((item) => item.userId === userId) || null; }
  async getSubscriptionByProviderId(providerId) { return this.subscriptions.find((item) => item.providerId === providerId) || null; }
  async upsertSubscription(data) { const index = this.subscriptions.findIndex((item) => item.userId === data.userId); const item = { ...(index >= 0 ? this.subscriptions[index] : {}), ...data }; if (index >= 0) this.subscriptions[index] = item; else this.subscriptions.push(item); return item; }
  async getNotificationPreferences(userId) { return this.notificationPreferences.find((item) => item.userId === userId) || { userId, pushEnabled: false, reminderDays: 2 }; }
  async upsertNotificationPreferences(userId, data) { const index = this.notificationPreferences.findIndex((item) => item.userId === userId); const item = { userId, ...data, updatedAt: new Date().toISOString() }; if (index >= 0) this.notificationPreferences[index] = item; else this.notificationPreferences.push(item); return item; }
  async listPushReminders(today) { return buildReminders(this.notificationPreferences.filter((item) => item.pushEnabled), this.bills, today); }
  async listPushSubscriptions(userId) { return this.pushSubscriptions.filter((item) => item.userId === userId).map(({ userId: _userId, ...item }) => item); }
  async upsertPushSubscription(userId, data) { const index = this.pushSubscriptions.findIndex((item) => item.endpoint === data.endpoint); const item = { userId, ...data, updatedAt: new Date().toISOString() }; if (index >= 0) this.pushSubscriptions[index] = item; else this.pushSubscriptions.push(item); return item; }
  async deletePushSubscription(userId, endpoint) { const before = this.pushSubscriptions.length; this.pushSubscriptions = this.pushSubscriptions.filter((item) => !(item.userId === userId && item.endpoint === endpoint)); return this.pushSubscriptions.length < before; }
  async getNotificationDelivery(billId, scheduledFor) { return this.notificationDeliveries.find((item) => item.billId === billId && item.scheduledFor === scheduledFor) || null; }
  async recordNotificationDelivery(data) { const index = this.notificationDeliveries.findIndex((item) => item.billId === data.billId && item.scheduledFor === data.scheduledFor); const item = { id: index >= 0 ? this.notificationDeliveries[index].id : randomUUID(), ...data }; if (index >= 0) this.notificationDeliveries[index] = item; else this.notificationDeliveries.push(item); return item; }
  async adminOverview() { return { users: this.users.length, activeUsers: this.users.filter((user) => user.active).length, proUsers: this.subscriptions.filter(isActiveSubscription).length, bills: this.bills.length, totalAmount: this.bills.reduce((sum, bill) => sum + Number(bill.amount), 0) }; }
  async adminUsers() { return this.users.map((user) => ({ ...publicUser(user), plan: user.role === "admin" || this.subscriptions.some((item) => item.userId === user.id && isActiveSubscription(item)) ? "pro" : "free", subscriptionStatus: this.subscriptions.find((item) => item.userId === user.id)?.status || null })); }
  async adminUser(id) { return (await this.adminUsers()).find((user) => user.id === id) || null; }
  async setUserActive(id, active) { const user = this.users.find((item) => item.id === id); if (!user) return null; user.active = active; return publicUser(user); }
  async setUserRole(id, role) { const user = this.users.find((item) => item.id === id); if (!user) return null; user.role = role; return publicUser(user); }
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
    const row = { id: randomUUID(), email: data.email || null, cpf_hash: data.cpfHash || null, identifier_type: data.identifierType, identifier_label: data.identifierLabel, password_hash: data.passwordHash, role: data.role, name: data.name, avatar_data: data.avatarData || null };
    let result = await this.client.from("users").insert(row).select("*").single();
    if (isMissingFeatureColumn(result.error)) { const { name, avatar_data, ...legacy } = row; result = await this.client.from("users").insert(legacy).select("*").single(); }
    const { data: created, error } = result;
    if (error?.code === "23505") throw duplicateError();
    check(error); return mapUser(created);
  }

  async getUser(id) {
    const { data, error } = await this.client.from("users").select("*").eq("id", id).maybeSingle();
    check(error); return data ? mapUser(data) : null;
  }

  async updateUserProfile(id, data) {
    const current = await this.getUser(id);
    if (!current) return null;
    if (data.email && current.identifierType !== "email") throw profileEmailError();
    const row = { name: data.name, avatar_data: data.avatarData || null };
    if (data.email) { row.email = data.email; row.identifier_label = data.email; }
    const { data: saved, error } = await this.client.from("users").update(row).eq("id", id).select("*").maybeSingle();
    if (isMissingFeatureColumn(error)) throw migrationError("Atualize a estrutura de clientes no Supabase.");
    if (error?.code === "23505") throw duplicateError();
    check(error); return saved ? mapUser(saved) : null;
  }

  async updateUserPassword(id, passwordHash) {
    const { data, error } = await this.client.from("users").update({ password_hash: passwordHash }).eq("id", id).select("id").maybeSingle();
    check(error); return Boolean(data);
  }

  async createPasswordResetToken(userId, tokenHash, expiresAt) {
    const deleteResult = await this.client.from("password_reset_tokens").delete().eq("user_id", userId);
    if (isMissingFeatureTable(deleteResult.error)) throw migrationError("Crie a estrutura de recuperação de senha no Supabase.");
    check(deleteResult.error);
    const { error } = await this.client.from("password_reset_tokens").insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt });
    check(error);
  }

  async consumePasswordResetToken(tokenHash) {
    const { data, error } = await this.client.from("password_reset_tokens").update({ used_at: new Date().toISOString() }).eq("token_hash", tokenHash).is("used_at", null).gt("expires_at", new Date().toISOString()).select("user_id").maybeSingle();
    if (isMissingFeatureTable(error)) throw migrationError("Crie a estrutura de recuperação de senha no Supabase.");
    check(error); return data?.user_id || null;
  }

  async listData(userId) {
    const [{ data: bills, error: billsError }, { data: cards, error: cardsError }, incomeResult] = await Promise.all([
      this.client.from("bills").select("*").eq("user_id", userId).order("due_date"),
      this.client.from("cards").select("id, name, credit_limit, close_day, due_day, profile").eq("user_id", userId).order("name"),
      this.client.from("monthly_incomes").select("id, user_id, month, profile, amount").eq("user_id", userId).order("month"),
    ]);
    check(billsError); check(cardsError);
    const incomes = isMissingFeatureTable(incomeResult.error) ? [] : (check(incomeResult.error), incomeResult.data.map(mapIncome));
    return { bills: bills.map(mapBill), cards: cards.map(mapCard), incomes };
  }

  async getBill(userId, id) {
    const { data, error } = await this.client.from("bills").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
    check(error); return data ? mapBill(data) : null;
  }

  async createBill(userId, data) {
    const row = toBillRow(randomUUID(), userId, data);
    let result = await this.client.from("bills").insert(row).select("*").single();
    if (isMissingFeatureColumn(result.error)) result = await this.client.from("bills").insert(toLegacyBillRow(row)).select("*").single();
    check(result.error); return mapBill(result.data);
  }

  async createBills(userId, entries) {
    const rows = entries.map((data) => toBillRow(randomUUID(), userId, data));
    let result = await this.client.from("bills").insert(rows).select("*");
    if (isMissingFeatureColumn(result.error)) result = await this.client.from("bills").insert(rows.map(toLegacyBillRow)).select("*");
    check(result.error); return result.data.map(mapBill);
  }

  async updateBill(userId, id, data) {
    const row = toBillRow(id, userId, data);
    delete row.id; delete row.user_id;
    let result = await this.client.from("bills").update(row).eq("id", id).eq("user_id", userId).select("*").maybeSingle();
    if (isMissingFeatureColumn(result.error)) result = await this.client.from("bills").update(toLegacyBillRow(row)).eq("id", id).eq("user_id", userId).select("*").maybeSingle();
    check(result.error); return result.data ? mapBill(result.data) : null;
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

  async upsertIncome(userId, data) {
    const row = { user_id: userId, month: data.month, profile: data.profile, amount: data.amount, updated_at: new Date().toISOString() };
    const { data: saved, error } = await this.client.from("monthly_incomes").upsert(row, { onConflict: "user_id,month,profile" }).select("id, user_id, month, profile, amount").single();
    if (isMissingFeatureTable(error)) throw migrationError("Crie a tabela de renda mensal no Supabase.");
    check(error); return mapIncome(saved);
  }

  async getSubscription(userId) {
    const { data, error } = await this.client.from("subscriptions").select("*").eq("user_id", userId).maybeSingle();
    if (isMissingSubscriptionTable(error)) return null;
    check(error); return data ? mapSubscription(data) : null;
  }

  async getSubscriptionByProviderId(providerId) {
    const { data, error } = await this.client.from("subscriptions").select("*").eq("provider_id", providerId).maybeSingle();
    if (isMissingSubscriptionTable(error)) return null;
    check(error); return data ? mapSubscription(data) : null;
  }

  async upsertSubscription(data) {
    const row = { user_id: data.userId, provider_id: data.providerId, payer_email: data.payerEmail, status: data.status, next_payment_date: data.nextPaymentDate, updated_at: data.updatedAt || new Date().toISOString() };
    const { data: saved, error } = await this.client.from("subscriptions").upsert(row, { onConflict: "user_id" }).select("*").single();
    if (isMissingSubscriptionTable(error)) { const migrationError = new Error("A tabela de assinaturas ainda nao foi criada no Supabase."); migrationError.status = 503; throw migrationError; }
    check(error); return mapSubscription(saved);
  }

  async getNotificationPreferences(userId) {
    const { data, error } = await this.client.from("notification_preferences").select("*").eq("user_id", userId).maybeSingle();
    if (isMissingFeatureTable(error)) return { userId, pushEnabled: false, reminderDays: 2 };
    check(error); return data ? mapNotificationPreferences(data) : { userId, pushEnabled: false, reminderDays: 2 };
  }

  async upsertNotificationPreferences(userId, data) {
    const row = { user_id: userId, push_enabled: data.pushEnabled, reminder_days: data.reminderDays, updated_at: new Date().toISOString() };
    const { data: saved, error } = await this.client.from("notification_preferences").upsert(row, { onConflict: "user_id" }).select("*").single();
    if (isMissingFeatureColumn(error)) throw migrationError("Atualize a estrutura de notificações no Supabase.");
    check(error); return mapNotificationPreferences(saved);
  }

  async listPushReminders(today) {
    const { data: preferences, error: preferencesError } = await this.client.from("notification_preferences").select("*").eq("push_enabled", true);
    if (isMissingFeatureTable(preferencesError) || !preferences?.length) return [];
    if (isMissingFeatureColumn(preferencesError)) return [];
    check(preferencesError);
    const maxDate = addDays(today, 30);
    const { data: bills, error: billsError } = await this.client.from("bills").select("*").in("user_id", preferences.map((item) => item.user_id)).eq("status", "pending").gte("due_date", addDays(today, 1)).lte("due_date", maxDate);
    check(billsError);
    return buildReminders(preferences.map(mapNotificationPreferences), bills.map(mapBill), today);
  }

  async listPushSubscriptions(userId) {
    const { data, error } = await this.client.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", userId);
    if (isMissingFeatureTable(error)) return [];
    check(error); return data.map((row) => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }));
  }

  async upsertPushSubscription(userId, subscription) {
    const row = { user_id: userId, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, updated_at: new Date().toISOString() };
    const { data, error } = await this.client.from("push_subscriptions").upsert(row, { onConflict: "endpoint" }).select("endpoint, p256dh, auth").single();
    if (isMissingFeatureTable(error)) throw migrationError("Crie a tabela de notificações push no Supabase.");
    check(error); return { endpoint: data.endpoint, keys: { p256dh: data.p256dh, auth: data.auth } };
  }

  async deletePushSubscription(userId, endpoint) {
    const { data, error } = await this.client.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint).select("endpoint");
    if (isMissingFeatureTable(error)) return false;
    check(error); return Boolean(data?.length);
  }

  async getNotificationDelivery(billId, scheduledFor) {
    const { data, error } = await this.client.from("notification_deliveries").select("*").eq("bill_id", billId).eq("channel", "push").eq("scheduled_for", scheduledFor).maybeSingle();
    if (isMissingFeatureTable(error)) return null;
    check(error); return data ? mapNotificationDelivery(data) : null;
  }

  async recordNotificationDelivery(data) {
    const row = { user_id: data.userId, bill_id: data.billId, scheduled_for: data.scheduledFor, channel: "push", status: data.status, provider_message_id: data.providerMessageId, error: data.error, updated_at: new Date().toISOString() };
    const { data: saved, error } = await this.client.from("notification_deliveries").upsert(row, { onConflict: "bill_id,channel,scheduled_for" }).select("*").single();
    check(error); return mapNotificationDelivery(saved);
  }

  async adminOverview() {
    const [usersResult, activeResult, billsResult, subscriptionsResult] = await Promise.all([
      this.client.from("users").select("*", { count: "exact", head: true }),
      this.client.from("users").select("*", { count: "exact", head: true }).eq("active", true),
      this.client.from("bills").select("amount"),
      this.client.from("subscriptions").select("status, next_payment_date"),
    ]);
    check(usersResult.error); check(activeResult.error); check(billsResult.error);
    const subscriptions = isMissingSubscriptionTable(subscriptionsResult.error) ? [] : (check(subscriptionsResult.error), subscriptionsResult.data);
    return { users: usersResult.count || 0, activeUsers: activeResult.count || 0, proUsers: subscriptions.filter((item) => isActiveSubscription(mapSubscription(item))).length, bills: billsResult.data.length, totalAmount: billsResult.data.reduce((sum, bill) => sum + Number(bill.amount), 0) };
  }

  async adminUsers() {
    const [{ data: users, error: usersError }, subscriptionsResult] = await Promise.all([
      this.client.from("users").select("*").order("created_at", { ascending: false }),
      this.client.from("subscriptions").select("user_id, status, next_payment_date"),
    ]);
    check(usersError);
    const subscriptions = isMissingSubscriptionTable(subscriptionsResult.error) ? [] : (check(subscriptionsResult.error), subscriptionsResult.data);
    return users.map((user) => {
      const subscription = subscriptions.find((item) => item.user_id === user.id);
      return { ...mapUser(user), plan: user.role === "admin" || isActiveSubscription(subscription ? mapSubscription(subscription) : null) ? "pro" : "free", subscriptionStatus: subscription?.status || null };
    });
  }

  async adminUser(id) { return (await this.adminUsers()).find((user) => user.id === id) || null; }

  async setUserActive(id, active) {
    const { data, error } = await this.client.from("users").update({ active }).eq("id", id).select("id, identifier_type, identifier_label, role, active, created_at").maybeSingle();
    check(error); return data ? mapUser(data) : null;
  }

  async setUserRole(id, role) {
    const { data, error } = await this.client.from("users").update({ role }).eq("id", id).select("id, identifier_type, identifier_label, role, active, created_at").maybeSingle();
    check(error); return data ? mapUser(data) : null;
  }
}

function toBillRow(id, userId, data) { return { id, user_id: userId, name: data.name, amount: data.amount, due_date: data.dueDate, profile: data.profile, category: data.category, status: data.status, tags: data.tags || [], series_id: data.seriesId || null, series_type: data.seriesType || "single", installment_number: data.installmentNumber || null, installment_total: data.installmentTotal || null }; }
function toLegacyBillRow(row) { const { tags, series_id, series_type, installment_number, installment_total, ...legacy } = row; return legacy; }
function mapBill(row) { return { id: row.id, userId: row.user_id || row.userId, name: row.name, amount: Number(row.amount), dueDate: row.due_date || row.dueDate, profile: row.profile, category: row.category, status: row.status, tags: row.tags || [], seriesId: row.series_id || row.seriesId || null, seriesType: row.series_type || row.seriesType || "single", installmentNumber: row.installment_number || row.installmentNumber || null, installmentTotal: row.installment_total || row.installmentTotal || null }; }
function mapCard(row) { return { id: row.id, name: row.name, limit: Number(row.credit_limit), closeDay: row.close_day, dueDay: row.due_day, profile: row.profile }; }
function mapIncome(row) { return { id: row.id, userId: row.user_id || row.userId, month: row.month, profile: row.profile, amount: Number(row.amount) }; }
function mapSubscription(row) { return { userId: row.user_id, providerId: row.provider_id, payerEmail: row.payer_email, status: row.status, nextPaymentDate: row.next_payment_date, updatedAt: row.updated_at }; }
function mapNotificationPreferences(row) { return { userId: row.user_id, pushEnabled: Boolean(row.push_enabled), reminderDays: Number(row.reminder_days || 2), updatedAt: row.updated_at || null }; }
function mapNotificationDelivery(row) { return { id: row.id, userId: row.user_id, billId: row.bill_id, scheduledFor: row.scheduled_for, status: row.status, providerMessageId: row.provider_message_id, error: row.error }; }
function mapUser(row, includePassword = false) {
  const user = { id: row.id, email: row.email, cpfHash: row.cpf_hash, identifierType: row.identifier_type, identifierLabel: row.identifier_label, name: row.name || row.identifier_label, avatarData: row.avatar_data || null, role: row.role, active: Boolean(row.active), createdAt: row.created_at };
  if (includePassword) user.passwordHash = row.password_hash;
  return user;
}
function publicUser(user) { return { id: user.id, email: user.email || null, identifierType: user.identifierType, identifierLabel: user.identifierLabel, name: user.name || user.identifierLabel, avatarData: user.avatarData || null, role: user.role, active: user.active, createdAt: user.createdAt }; }
function isActiveSubscription(subscription) {
  if (subscription?.status === "authorized") return true;
  return subscription?.status === "pix_authorized" && new Date(subscription.nextPaymentDate || 0).getTime() > Date.now();
}
function check(error) { if (error) { const wrapped = new Error(error.message); wrapped.code = error.code; throw wrapped; } }
function isMissingSubscriptionTable(error) { return error?.code === "42P01" || error?.code === "PGRST205"; }
function isMissingFeatureTable(error) { return error?.code === "42P01" || error?.code === "PGRST205"; }
function isMissingFeatureColumn(error) { return error?.code === "42703" || error?.code === "PGRST204"; }
function migrationError(message) { const error = new Error(message); error.status = 503; return error; }
function duplicateError() { const error = new Error("Conta já cadastrada."); error.code = "ER_DUP_ENTRY"; return error; }
function profileEmailError() { const error = new Error("Contas criadas com CPF não podem trocar o identificador por e-mail."); error.status = 400; return error; }
function isPublicKey(key) {
  if (key.startsWith("sb_publishable_")) return true;
  try { return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "anon"; } catch { return false; }
}

function buildReminders(preferences, bills, today) {
  return preferences.flatMap((preference) => bills
    .filter((bill) => bill.userId === preference.userId && bill.status === "pending")
    .map((bill) => ({ bill, days: daysBetween(today, bill.dueDate) }))
    .filter((item) => item.days === preference.reminderDays)
    .map((item) => ({ ...item, userId: preference.userId })));
}
function daysBetween(from, to) { return Math.round((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 86400000); }
function addDays(value, days) { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + days); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
