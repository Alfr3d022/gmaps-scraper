import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const IGNORE_PATTERNS = [
  /\.(png|jpg|jpeg|gif|svg|webp)$/i,
  /^example@/i,
  /sentry\.io$/i,
  /wixpress\.com$/i,
];

function isLikelyValidEmail(email) {
  return !IGNORE_PATTERNS.some((pattern) => pattern.test(email));
}

async function fetchHtml(url, timeoutMs = 8000) {
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
  if (!html) {
    return { best: null, source: null, all: [] };
  }

  const mailtoMatches = [...html.matchAll(/href=["']mailto:([^"'?]+)/gi)].map((m) => m[1]);
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

function pickBestEmailResult(homeResult, fallbackResults) {
  if (homeResult.best) return homeResult;

  for (const found of fallbackResults) {
    if (found.best) return found;
  }

  return homeResult;
}

/** Visita a home e páginas de contato comuns em paralelo. */
export async function extractEmailFromWebsite(websiteUrl) {
  try {
    const url = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
    const base = new URL(url);

    const [homeHtml, ...fallbackHtmls] = await Promise.all([
      fetchHtml(url),
      ...config.emailFallbackPaths.map((path) => fetchHtml(`${base.origin}${path}`, 5000)),
    ]);

    const homeResult = extractEmailsFromHtml(homeHtml);
    const fallbackResults = fallbackHtmls.map(extractEmailsFromHtml);
    const result = pickBestEmailResult(homeResult, fallbackResults);

    return result.best ? { email: result.best, source: result.source, allFound: result.all } : null;
  } catch (err) {
    logger.debug({ err: err.message, websiteUrl }, 'Falha ao extrair email do site');
    return null;
  }
}
