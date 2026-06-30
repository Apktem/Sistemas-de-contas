const sixHours = 6 * 60 * 60 * 1000;

export class WhatsAppCloud {
  constructor({ accessToken, phoneNumberId, templateName = "finance_due_reminder", language = "pt_BR", graphVersion = "v23.0", fetchImpl = fetch }) {
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
    this.templateName = templateName;
    this.language = language;
    this.graphVersion = graphVersion;
    this.fetch = fetchImpl;
  }

  get configured() { return Boolean(this.accessToken && this.phoneNumberId && this.templateName); }

  async sendReminder(reminder) {
    if (!this.configured) throw serviceError("WhatsApp ainda nao configurado.", 503);
    const response = await this.fetch(`https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: reminder.phone.replace(/\D/g, ""),
        type: "template",
        template: {
          name: this.templateName,
          language: { code: this.language },
          components: [{
            type: "body",
            parameters: [
              { type: "text", text: reminder.bill.name },
              { type: "text", text: formatMoney(reminder.bill.amount) },
              { type: "text", text: formatDate(reminder.bill.dueDate) },
              { type: "text", text: String(reminder.days) },
            ],
          }],
        },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw serviceError(body.error?.message || "Nao foi possivel enviar o alerta pelo WhatsApp.", response.status);
    return body.messages?.[0]?.id || null;
  }
}

export async function runReminderDispatch(storage, whatsapp, today = new Date()) {
  if (!whatsapp.configured) return { sent: 0, failed: 0 };
  const date = toDateOnly(today);
  const reminders = await storage.listWhatsAppReminders(date);
  let sent = 0;
  let failed = 0;
  for (const reminder of reminders) {
    const existing = await storage.getNotificationDelivery(reminder.bill.id, date);
    if (existing?.status === "sent") continue;
    try {
      const providerMessageId = await whatsapp.sendReminder(reminder);
      await storage.recordNotificationDelivery({ userId: reminder.userId, billId: reminder.bill.id, scheduledFor: date, status: "sent", providerMessageId, error: null });
      sent += 1;
    } catch (error) {
      await storage.recordNotificationDelivery({ userId: reminder.userId, billId: reminder.bill.id, scheduledFor: date, status: "failed", providerMessageId: null, error: error.message });
      failed += 1;
    }
  }
  return { sent, failed };
}

export function startReminderWorker(storage, whatsapp, logger = console) {
  const execute = () => runReminderDispatch(storage, whatsapp).catch((error) => logger.error("Falha nos alertas do WhatsApp:", error));
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
