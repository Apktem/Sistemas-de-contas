import webpush from "web-push";

const sixHours = 6 * 60 * 60 * 1000;

export class WebPushService {
  constructor({ publicKey, privateKey, subject = "mailto:suporte@ricoxp.com", client = webpush }) {
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    this.subject = subject;
    this.client = client;
    if (this.configured) this.client.setVapidDetails(this.subject, this.publicKey, this.privateKey);
  }

  get configured() { return Boolean(this.publicKey && this.privateKey); }

  async send(subscription, reminder) {
    if (!this.configured) throw serviceError("Notificações push ainda não configuradas.", 503);
    const daysText = reminder.days === 1 ? "amanhã" : `em ${reminder.days} dias`;
    return this.client.sendNotification(subscription, JSON.stringify({
      title: `Conta vence ${daysText}`,
      body: `${reminder.bill.name}, ${formatMoney(reminder.bill.amount)}, vence em ${formatDate(reminder.bill.dueDate)}.`,
      tag: `bill-${reminder.bill.id}-${reminder.bill.dueDate}`,
      url: "/?abrir=lembretes",
    }));
  }
}

export async function runPushDispatch(storage, push, today = new Date()) {
  if (!push.configured) return { sent: 0, failed: 0 };
  const date = toDateOnly(today);
  const reminders = await storage.listPushReminders(date);
  let sent = 0;
  let failed = 0;
  for (const reminder of reminders) {
    const existing = await storage.getNotificationDelivery(reminder.bill.id, date);
    if (existing?.status === "sent") continue;
    const subscriptions = await storage.listPushSubscriptions(reminder.userId);
    if (!subscriptions.length) continue;
    let delivered = false;
    let lastError = null;
    for (const subscription of subscriptions) {
      try {
        await push.send(subscription, reminder);
        delivered = true;
      } catch (error) {
        lastError = error;
        if (error.statusCode === 404 || error.statusCode === 410) await storage.deletePushSubscription(reminder.userId, subscription.endpoint);
      }
    }
    await storage.recordNotificationDelivery({
      userId: reminder.userId,
      billId: reminder.bill.id,
      scheduledFor: date,
      status: delivered ? "sent" : "failed",
      providerMessageId: null,
      error: delivered ? null : lastError?.message || "Nenhum aparelho recebeu a notificação.",
    });
    if (delivered) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

export function startPushWorker(storage, push, logger = console) {
  const execute = () => runPushDispatch(storage, push).catch((error) => logger.error("Falha nas notificações push:", error));
  const initial = setTimeout(execute, 15_000);
  const interval = setInterval(execute, sixHours);
  initial.unref?.();
  interval.unref?.();
  return () => { clearTimeout(initial); clearInterval(interval); };
}

function toDateOnly(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function formatMoney(value) { return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function formatDate(value) { return new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR"); }
function serviceError(message, status) { const error = new Error(message); error.status = status; return error; }
