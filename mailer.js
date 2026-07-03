import nodemailer from "nodemailer";

export class SupportMailer {
  constructor({ host, port = 465, user, pass, from = "RicoXP <contato@ricoxp.com>", siteUrl = "https://ricoxp.com", transport } = {}) {
    this.siteUrl = String(siteUrl).replace(/\/$/, "");
    this.from = from;
    this.transport = transport || (host && user && pass ? nodemailer.createTransport({ host, port: Number(port), secure: Number(port) === 465, auth: { user, pass } }) : null);
  }

  get configured() { return Boolean(this.transport); }

  async sendPasswordReset({ email, name, token }) {
    if (!this.configured) {
      const error = new Error("A recuperação por e-mail ainda não foi configurada.");
      error.status = 503;
      throw error;
    }
    const resetUrl = `${this.siteUrl}/login?reset_token=${encodeURIComponent(token)}`;
    await this.transport.sendMail({
      from: this.from,
      to: email,
      subject: "Redefinição de senha do RicoXP",
      text: `Olá, ${name || "cliente"}.\n\nRecebemos uma solicitação para redefinir sua senha do RicoXP. Acesse o link abaixo em até 30 minutos:\n\n${resetUrl}\n\nSe você não solicitou a alteração, ignore esta mensagem.`,
      html: `<p>Olá, ${escapeHtml(name || "cliente")}.</p><p>Recebemos uma solicitação para redefinir sua senha do RicoXP.</p><p><a href="${resetUrl}">Cadastrar nova senha</a></p><p>Este link expira em 30 minutos. Se você não solicitou a alteração, ignore esta mensagem.</p>`,
    });
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
