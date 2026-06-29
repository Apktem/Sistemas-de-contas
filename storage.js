import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

export class MemoryStorage {
  constructor() {
    this.users = [];
    this.bills = [];
    this.cards = [];
  }

  async findUser(type, lookup) {
    return this.users.find((user) => (type === "email" ? user.email === lookup : user.cpfHash === lookup)) || null;
  }

  async createUser(data) {
    if (await this.findUser(data.identifierType, data.lookup)) throw duplicateError();
    const user = { id: randomUUID(), ...data, active: true, createdAt: new Date().toISOString() };
    this.users.push(user);
    return publicUser(user);
  }

  async getUser(id) {
    const user = this.users.find((item) => item.id === id);
    return user ? publicUser(user) : null;
  }

  async getUserWithPassword(id) {
    return this.users.find((item) => item.id === id) || null;
  }

  async listData(userId) {
    return { bills: this.bills.filter((item) => item.userId === userId), cards: this.cards.filter((item) => item.userId === userId) };
  }

  async createBill(userId, data) {
    const bill = { id: randomUUID(), userId, ...data };
    this.bills.push(bill);
    return bill;
  }

  async updateBill(userId, id, data) {
    const index = this.bills.findIndex((item) => item.id === id && item.userId === userId);
    if (index < 0) return null;
    this.bills[index] = { ...this.bills[index], ...data };
    return this.bills[index];
  }

  async deleteBill(userId, id) {
    const before = this.bills.length;
    this.bills = this.bills.filter((item) => !(item.id === id && item.userId === userId));
    return this.bills.length < before;
  }

  async createCard(userId, data) {
    const card = { id: randomUUID(), userId, ...data };
    this.cards.push(card);
    return card;
  }

  async deleteCard(userId, id) {
    const before = this.cards.length;
    this.cards = this.cards.filter((item) => !(item.id === id && item.userId === userId));
    return this.cards.length < before;
  }

  async adminOverview() {
    return {
      users: this.users.length,
      activeUsers: this.users.filter((user) => user.active).length,
      bills: this.bills.length,
      totalAmount: this.bills.reduce((sum, bill) => sum + Number(bill.amount), 0),
    };
  }

  async adminUsers() {
    return this.users.map((user) => ({
      ...publicUser(user),
      billCount: this.bills.filter((bill) => bill.userId === user.id).length,
      totalAmount: this.bills.filter((bill) => bill.userId === user.id).reduce((sum, bill) => sum + Number(bill.amount), 0),
    }));
  }

  async setUserActive(id, active) {
    const user = this.users.find((item) => item.id === id);
    if (!user) return null;
    user.active = active;
    return publicUser(user);
  }
}

export async function createStorage(env = process.env) {
  if (!env.DB_HOST || !env.DB_USER || !env.DB_NAME) {
    if (env.NODE_ENV === "production") throw new Error("Banco MySQL não configurado.");
    return new MemoryStorage();
  }

  const pool = mysql.createPool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    connectionLimit: 10,
    decimalNumbers: true,
    dateStrings: true,
  });
  await initializeSchema(pool);
  return new MysqlStorage(pool);
}

class MysqlStorage {
  constructor(pool) { this.pool = pool; }

  async findUser(type, lookup) {
    const field = type === "email" ? "email" : "cpf_hash";
    const [rows] = await this.pool.execute(`SELECT * FROM users WHERE ${field} = ? LIMIT 1`, [lookup]);
    return rows[0] ? mapUser(rows[0], true) : null;
  }

  async createUser(data) {
    const id = randomUUID();
    await this.pool.execute(
      "INSERT INTO users (id, email, cpf_hash, identifier_type, identifier_label, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, data.email || null, data.cpfHash || null, data.identifierType, data.identifierLabel, data.passwordHash, data.role],
    );
    return this.getUser(id);
  }

  async getUser(id) {
    const [rows] = await this.pool.execute("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async getUserWithPassword(id) {
    const [rows] = await this.pool.execute("SELECT * FROM users WHERE id = ? LIMIT 1", [id]);
    return rows[0] ? mapUser(rows[0], true) : null;
  }

  async listData(userId) {
    const [bills] = await this.pool.execute("SELECT id, name, amount, due_date AS dueDate, profile, category, status FROM bills WHERE user_id = ? ORDER BY due_date", [userId]);
    const [cards] = await this.pool.execute("SELECT id, name, credit_limit AS `limit`, close_day AS closeDay, due_day AS dueDay, profile FROM cards WHERE user_id = ? ORDER BY name", [userId]);
    return { bills, cards };
  }

  async createBill(userId, data) {
    const id = randomUUID();
    await this.pool.execute("INSERT INTO bills (id, user_id, name, amount, due_date, profile, category, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, userId, data.name, data.amount, data.dueDate, data.profile, data.category, data.status]);
    return { id, ...data };
  }

  async updateBill(userId, id, data) {
    const [result] = await this.pool.execute("UPDATE bills SET name=?, amount=?, due_date=?, profile=?, category=?, status=? WHERE id=? AND user_id=?", [data.name, data.amount, data.dueDate, data.profile, data.category, data.status, id, userId]);
    return result.affectedRows ? { id, ...data } : null;
  }

  async deleteBill(userId, id) {
    const [result] = await this.pool.execute("DELETE FROM bills WHERE id=? AND user_id=?", [id, userId]);
    return result.affectedRows > 0;
  }

  async createCard(userId, data) {
    const id = randomUUID();
    await this.pool.execute("INSERT INTO cards (id, user_id, name, credit_limit, close_day, due_day, profile) VALUES (?, ?, ?, ?, ?, ?, ?)", [id, userId, data.name, data.limit, data.closeDay, data.dueDay, data.profile]);
    return { id, ...data };
  }

  async deleteCard(userId, id) {
    const [result] = await this.pool.execute("DELETE FROM cards WHERE id=? AND user_id=?", [id, userId]);
    return result.affectedRows > 0;
  }

  async adminOverview() {
    const [[users], [bills]] = await Promise.all([
      this.pool.execute("SELECT COUNT(*) AS users, SUM(active = 1) AS activeUsers FROM users"),
      this.pool.execute("SELECT COUNT(*) AS bills, COALESCE(SUM(amount), 0) AS totalAmount FROM bills"),
    ]);
    return { ...users[0], ...bills[0] };
  }

  async adminUsers() {
    const [rows] = await this.pool.execute("SELECT u.id, u.identifier_label AS identifierLabel, u.identifier_type AS identifierType, u.role, u.active, u.created_at AS createdAt, COUNT(b.id) AS billCount, COALESCE(SUM(b.amount), 0) AS totalAmount FROM users u LEFT JOIN bills b ON b.user_id=u.id GROUP BY u.id ORDER BY u.created_at DESC");
    return rows.map((row) => ({ ...row, active: Boolean(row.active) }));
  }

  async setUserActive(id, active) {
    const [result] = await this.pool.execute("UPDATE users SET active=? WHERE id=?", [active ? 1 : 0, id]);
    return result.affectedRows ? this.getUser(id) : null;
  }
}

async function initializeSchema(pool) {
  await pool.execute(`CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) PRIMARY KEY,
    email VARCHAR(320) UNIQUE NULL,
    cpf_hash CHAR(64) UNIQUE NULL,
    identifier_type VARCHAR(10) NOT NULL,
    identifier_label VARCHAR(320) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    role VARCHAR(16) NOT NULL DEFAULT 'user',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS bills (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    name VARCHAR(160) NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    due_date DATE NOT NULL,
    profile VARCHAR(20) NOT NULL,
    category VARCHAR(40) NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_bills_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_bills_user_date (user_id, due_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS cards (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    name VARCHAR(120) NOT NULL,
    credit_limit DECIMAL(12,2) NOT NULL,
    close_day TINYINT UNSIGNED NOT NULL,
    due_day TINYINT UNSIGNED NOT NULL,
    profile VARCHAR(20) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cards_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_cards_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

function mapUser(row, includePassword = false) {
  const user = {
    id: row.id,
    email: row.email,
    cpfHash: row.cpf_hash,
    identifierType: row.identifier_type,
    identifierLabel: row.identifier_label,
    role: row.role,
    active: Boolean(row.active),
    createdAt: row.created_at,
  };
  if (includePassword) user.passwordHash = row.password_hash;
  return user;
}

function publicUser(user) {
  return { id: user.id, identifierType: user.identifierType, identifierLabel: user.identifierLabel, role: user.role, active: user.active, createdAt: user.createdAt };
}

function duplicateError() {
  const error = new Error("Conta já cadastrada.");
  error.code = "ER_DUP_ENTRY";
  return error;
}
