import { createHmac } from "node:crypto";

export function normalizeIdentifier(value, cpfPepper) {
  const identifier = String(value || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    const email = identifier.toLowerCase();
    return { type: "email", lookup: email, email, label: email };
  }

  const cpf = identifier.replace(/\D/g, "");
  if (!isValidCpf(cpf)) throw new Error("Informe um e-mail ou CPF válido.");
  const lookup = createHmac("sha256", cpfPepper).update(cpf).digest("hex");
  return { type: "cpf", lookup, cpfHash: lookup, label: `***.***.***-${cpf.slice(-2)}` };
}

export function isValidCpf(value) {
  const cpf = String(value || "").replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length) => {
    let total = 0;
    for (let index = 0; index < length; index += 1) total += Number(cpf[index]) * (length + 1 - index);
    const remainder = (total * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}
