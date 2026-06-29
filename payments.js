const apiBase = "https://api.mercadopago.com";

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

  async request(path, options = {}) {
    const response = await this.fetch(`${apiBase}${path}`, {
      method: options.method || "GET",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
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
  return role === "admin" || subscription?.status === "authorized" ? "pro" : "free";
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
