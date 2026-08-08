// Números que o próprio Google Maps às vezes injeta como "telefone" de forma incorreta
// (números de suporte do Google, placeholders, etc). Ajuste essa lista conforme for
// encontrando novos falsos positivos no seu dataset.
const BLOCKLIST = new Set([
  '0800XXXXXXX', // exemplo — substitua pelos números reais que você já mapeou
]);

/**
 * Recebe um telefone em qualquer formato solto do texto do Maps e retorna:
 * { raw, digitsOnly, ddd, type: 'celular' | 'fixo' | 'invalido', formatted, blocked }
 */
export function normalizeBrazilianPhone(raw) {
  if (!raw) return null;

  const digitsOnly = raw.replace(/\D/g, '');

  // Remove código do país se vier com 55 na frente (ex: 5511999998888)
  const withoutCountryCode = digitsOnly.startsWith('55') && digitsOnly.length > 11
    ? digitsOnly.slice(2)
    : digitsOnly;

  if (BLOCKLIST.has(withoutCountryCode)) {
    return { raw, digitsOnly: withoutCountryCode, blocked: true };
  }

  // DDD válido: 2 dígitos, número: 8 (fixo) ou 9 (celular) dígitos
  const match = withoutCountryCode.match(/^(\d{2})(\d{8,9})$/);
  if (!match) {
    return { raw, digitsOnly: withoutCountryCode, ddd: null, type: 'invalido', formatted: null, blocked: false };
  }

  const [, ddd, number] = match;
  const isCelular = number.length === 9 && number.startsWith('9');
  const type = number.length === 9 ? (isCelular ? 'celular' : 'invalido') : 'fixo';

  const formatted = number.length === 9
    ? `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`
    : `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;

  return { raw, digitsOnly: withoutCountryCode, ddd, type, formatted, blocked: false };
}

/** Retorna o link direto do WhatsApp para um telefone brasileiro válido. */
export function buildWhatsAppUrl(phone) {
  if (!phone || phone.blocked || phone.type === 'invalido' || !phone.digitsOnly) {
    return null;
  }

  return `https://wa.me/55${phone.digitsOnly}`;
}
