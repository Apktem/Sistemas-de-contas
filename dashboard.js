export function dashboardMonthSummary({ bills = [], entries = [], cards = [], month, profile }) {
  const monthBills = bills.filter((bill) => bill.profile === profile && bill.dueDate.startsWith(month));
  const monthEntries = entries.filter((entry) => entry.profile === profile && entry.date.startsWith(month));
  const pendingReceivables = monthEntries.filter((entry) => entry.type === "receivable" && entry.status !== "settled");
  const received = monthEntries.filter((entry) => (entry.type === "income" || entry.type === "receivable") && entry.status === "settled");
  const variableExpenses = monthEntries.filter((entry) => entry.type === "variable_expense");
  const monthCards = cards.filter((card) => card.profile === profile).map((card) => ({
    ...card,
    used: monthBills.filter((bill) => bill.category === "Cartao" && bill.name.toLowerCase().includes(card.name.split(" ")[0].toLowerCase())).reduce((sum, bill) => sum + Number(bill.amount), 0),
  }));
  const sum = (items, field = "amount") => items.reduce((total, item) => total + Number(item[field] || 0), 0);
  return { bills: monthBills, pendingReceivables, received, variableExpenses, cards: monthCards, receivedTotal: sum(received), variableTotal: sum(variableExpenses), expenseTotal: sum(monthBills) + sum(variableExpenses) };
}
