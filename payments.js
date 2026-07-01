const apiBase = "https://api.mercadopago.com";
const pixAccessDays = 30;

export class MercadoPagoSubscriptions {
  constructor({ accessToken, siteUrl, fetchImpl = fetch, price = 29.9 }) {
    this.accessToken = accessToken;
    this.siteUrl = String(siteUrl || "").replace(/\/$/, "");
    this.fetch = fetchImpl;
    this.price = Number(price);
  }

  get configured() { return Boolean(this.accessToken && this.siteUrl); }

  async create(userId, payerEmail) {
    this.assertConfigured();
    return this.request("/preapproval", {
      method: "POST",
      body: {
        reason: "Gestao Financeira Pro",
        external_reference: userId,
        payer_email: payerEmail,
        back_url: `${this.siteUrl}/?assinatura=retorno`,
        notification_url: `${this.siteUrl}/api/webhooks/mercadopago`,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: this.price,
          currency_id: "BRL",
        },
      },
    });
  }

  async get(id) {
    this.assertConfigured();
    return this.request(`/preapproval/${encodeURIComponent(id)}`);
  }

  async cancel(id) {
    this.assertConfigured();
    return this.request(`/preapproval/${encodeURIComponent(id)}`, { method: "PUT", body: { status: "cancelled" } });
  }

  async createPix(userId, payerEmail, idempotencyKey) {
    this.assertConfigured();
    return this.request("/v1/payments", {
      method: "POST",
      headers: { "X-Idempotency-Key": idempotencyKey },
      body: {
        transaction_amount: this.price,
        description: "RicoXP Gestao Financeira Pro - 30 dias",
        payment_method_id: "pix",
        external_reference: userId,
        notification_url: `${this.siteUrl}/api/webhooks/mercadopago`,
        payer: { email: payerEmail },
      },
    });
  }

  async getPayment(id) {
    this.assertConfigured();
    return this.request(`/v1/payments/${encodeURIComponent(id)}`);
  }

  async request(path, options = {}) {
    const response = await this.fetch(`${apiBase}${path}`, {
      method: options.method || "GET",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json", ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.message || "O Mercado Pago nao concluiu a operacao.");
      error.status = response.status;
      throw error;
    }
    return body;
  }

  assertConfigured() {
    if (!this.configured) {
      const error = new Error("Os pagamentos ainda nao foram configurados.");
      error.status = 503;
      throw error;
    }
  }
}

export function subscriptionPlan(subscription, role = "user") {
  if (role === "admin" || subscription?.status === "authorized") return "pro";
  if (subscription?.status !== "pix_authorized" || !subscription.nextPaymentDate) return "free";
  return new Date(subscription.nextPaymentDate).getTime() > Date.now() ? "pro" : "free";
}

export function isPixSubscription(subscription) {
  return String(subscription?.status || "").startsWith("pix_");
}

export function normalizeSubscription(remote) {
  return {
    providerId: remote.id,
    userId: remote.external_reference,
    payerEmail: remote.payer_email || null,
    status: remote.status || "pending",
    nextPaymentDate: remote.next_payment_date || null,
    updatedAt: remote.last_modified || new Date().toISOString(),
  };
}

export function normalizePixPayment(remote) {
  const approved = remote.status === "approved";
  const approvedAt = approved ? new Date(remote.date_approved || remote.date_last_updated || Date.now()) : null;
  const expiresAt = approvedAt ? new Date(approvedAt.getTime() + pixAccessDays * 24 * 60 * 60 * 1000).toISOString() : null;
  return {
    providerId: String(remote.id),
    userId: remote.external_reference,
    payerEmail: remote.payer?.email || null,
    status: approved ? "pix_authorized" : `pix_${remote.status || "pending"}`,
    nextPaymentDate: expiresAt,
    updatedAt: remote.date_last_updated || new Date().toISOString(),
  };
}

export function pixPaymentDetails(remote) {
  const data = remote.point_of_interaction?.transaction_data || {};
  return {
    qrCode: data.qr_code || null,
    qrCodeBase64: data.qr_code_base64 || null,
    ticketUrl: data.ticket_url || null,
    expiresAt: remote.date_of_expiration || null,
  };
}
