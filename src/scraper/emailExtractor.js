import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Domínios/padrões que geram falsos positivos comuns (imagens, exemplos, tracking pixels)
const IGNORE_PATTERNS = [
  /\.(png|jpg|jpeg|gif|svg|webp)$/i,
  /^example@/i,
  /sentry\.io$/i,
  /wixpress\.com$/i,
];

function isLikelyValidEmail(email) {
  return !IGNORE_PATTERNS.some((pattern) => pattern.test(email));
}

async function fetchHtml(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadBot/1.0)' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractEmailsFromHtml(html) {
  if (!html) return [];

  // mailto: é o sinal mais confiável — quem coloca isso quer receber email ali
  const mailtoMatches = [...html.matchAll(/href=["']mailto:([^"'?]+)/gi)].map((m) => m[1]);

  // regex solto no texto é fallback, mais sujeito a falso positivo
  const textMatches = html.match(EMAIL_REGEX) || [];

  const all = [...mailtoMatches, ...textMatches]
    .map((e) => e.trim().toLowerCase())
    .filter(isLikelyValidEmail);

  return {
    best: mailtoMatches[0]?.toLowerCase() ?? textMatches[0]?.toLowerCase() ?? null,
    source: mailtoMatches.length ? 'mailto' : (textMatches.length ? 'regex' : null),
    all: [...new Set(all)],
  };
}

/** Visita a home do site e, se não achar nada, tenta páginas de contato comuns. */
export async function extractEmailFromWebsite(websiteUrl) {
  try {
    const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
    const homeHtml = await fetchHtml(url);
    let result = extractEmailsFromHtml(homeHtml);

    if (!result.best) {
      const base = new URL(url);
      for (const path of config.emailFallbackPaths) {
        const candidateUrl = `${base.origin}${path}`;
        const html = await fetchHtml(candidateUrl, 6000);
        const found = extractEmailsFromHtml(html);
        if (found.best) {
          result = found;
          break;
        }
      }
    }

    return result.best ? { email: result.best, source: result.source, allFound: result.all } : null;
  } catch (err) {
    logger.debug({ err: err.message, websiteUrl }, 'Falha ao extrair email do site');
    return null;
  }
}
