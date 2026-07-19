import assert from "node:assert/strict";
import test from "node:test";
import { dashboardMonthSummary } from "../dashboard.js";

test("resume o mes por area com recebimentos, despesas variaveis e cartoes", () => {
  const summary = dashboardMonthSummary({
    month: "2026-07",
    profile: "Casa",
    bills: [
      { profile: "Casa", dueDate: "2026-07-10", amount: 900, category: "Moradia", name: "Aluguel" },
      { profile: "Casa", dueDate: "2026-07-15", amount: 300, category: "Cartao", name: "Nubank fatura" },
      { profile: "Empresa", dueDate: "2026-07-10", amount: 5000, category: "Impostos", name: "Imposto" },
      { profile: "Casa", dueDate: "2026-08-10", amount: 100, category: "Cartao", name: "Nubank agosto" },
    ],
    entries: [
      { type: "income", profile: "Casa", date: "2026-07-05", amount: 2000, status: "settled" },
      { type: "receivable", profile: "Casa", date: "2026-07-06", amount: 450, status: "settled" },
      { type: "receivable", profile: "Casa", date: "2026-07-20", amount: 700, status: "pending" },
      { type: "variable_expense", profile: "Casa", date: "2026-07-08", amount: 250, status: "settled" },
      { type: "income", profile: "Empresa", date: "2026-07-05", amount: 9000, status: "settled" },
      { type: "income", profile: "Casa", date: "2026-08-05", amount: 800, status: "settled" },
    ],
    cards: [{ name: "Nubank", profile: "Casa", limit: 2000 }, { name: "Inter", profile: "Empresa", limit: 10000 }],
  });
  assert.equal(summary.receivedTotal, 2450);
  assert.equal(summary.pendingReceivables.reduce((sum, entry) => sum + entry.amount, 0), 700);
  assert.equal(summary.variableTotal, 250);
  assert.equal(summary.expenseTotal, 1450);
  assert.equal(summary.cards.length, 1);
  assert.equal(summary.cards[0].used, 300);
});
