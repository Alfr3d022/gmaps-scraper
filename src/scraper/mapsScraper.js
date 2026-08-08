import { chromium } from 'playwright';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { randomDelay, microDelay } from '../utils/delay.js';
import { buildWhatsAppUrl, normalizeBrazilianPhone } from '../utils/phoneNormalizer.js';
import {
  findSearchBox,
  findResultsFeed,
  resultCardSelectors,
  findPlaceName,
  findPhoneButton,
  findWebsiteLink,
  findAddress,
} from './selectors.js';
import { extractEmailFromWebsite } from './emailExtractor.js';

// User-Agents reais, alternados por sessão — reduz a chance de fingerprint fixo.
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
];

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function launchBrowser() {
  const launchOptions = {
    headless: config.headless,
    args: ['--disable-blink-features=AutomationControlled'],
  };

  if (config.proxy) {
    const url = new URL(config.proxy);
    launchOptions.proxy = {
      server: `${url.protocol}//${url.host}`,
      username: url.username || undefined,
      password: url.password || undefined,
    };
  }

  return chromium.launch(launchOptions);
}

async function newStealthContext(browser) {
  const context = await browser.newContext({
    userAgent: pickUserAgent(),
    locale: 'pt-BR',
    viewport: { width: 1366 + Math.floor(Math.random() * 200), height: 768 + Math.floor(Math.random() * 200) },
    timezoneId: 'America/Sao_Paulo',
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  context.setDefaultTimeout(config.navigationTimeoutMs);
  return context;
}

async function runInParallelBatches(items, concurrency, worker) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map(worker)));
    if (i + concurrency < items.length) {
      await microDelay();
    }
  }
  return results;
}

/** Rola o painel de resultados até coletar `maxResults` cards ou o Maps parar de carregar mais. */
async function collectResultLinks(page, maxResults) {
  const feed = await findResultsFeed(page);
  if (!feed) throw new Error('Painel de resultados não encontrado — o Maps pode ter mudado o layout ou bloqueou a sessão.');

  const links = new Set();
  let lastCount = 0;
  let stagnantRounds = 0;

  while (links.size < maxResults && stagnantRounds < 4) {
    for (const sel of resultCardSelectors()) {
      const hrefs = await page.locator(sel).evaluateAll(
        (els) => els.map((el) => el.getAttribute('href')).filter(Boolean),
      );
      hrefs.forEach((h) => links.add(h));
      if (links.size >= maxResults) break;
    }

    await feed.evaluate((el) => el.scrollBy(0, el.scrollHeight));
    await microDelay();

    if (links.size === lastCount) {
      stagnantRounds += 1;
    } else {
      stagnantRounds = 0;
    }
    lastCount = links.size;
  }

  return Array.from(links).slice(0, maxResults);
}

async function handleGoogleConsent(page) {
  if (!page.url().includes('consent.google.')) return;

  const button = page.getByRole('button', {
    name: /rejeitar tudo|reject all|recusar tudo|tout refuser|alles ablehnen/i,
  }).first();

  if (await button.isVisible().catch(() => false)) {
    await button.click();
    await page.waitForLoadState('domcontentloaded');
  }
}

async function runMapsSearch(page, { query, location, maxResults, isFirstSearch }) {
  const searchTerm = location ? `${query} ${location}` : query;

  if (isFirstSearch) {
    await page.goto('https://www.google.com/maps?hl=pt-BR&gl=br', { waitUntil: 'domcontentloaded' });
    await handleGoogleConsent(page);
    await randomDelay();
  } else {
    await microDelay();
  }

  const searchBox = await findSearchBox(page);
  if (!searchBox) throw new Error('Caixa de busca do Maps não encontrada — possível bloqueio ou mudança de layout.');

  await searchBox.click({ clickCount: 3 });
  await searchBox.fill(searchTerm);
  await page.keyboard.press('Enter');
  await randomDelay(1500, 3000);

  const links = await collectResultLinks(page, maxResults);
  logger.info({ count: links.length, searchTerm, concurrency: config.placeConcurrency }, 'Links coletados');
  return links;
}

async function scrapePlacePage(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await microDelay();

    const name = await findPlaceName(page);
    const address = await findAddress(page);

    let phoneRaw = null;
    const phoneBtn = await findPhoneButton(page);
    if (phoneBtn) {
      const ariaLabel = await phoneBtn.getAttribute('aria-label');
      const dataItemId = await phoneBtn.getAttribute('data-item-id');
      phoneRaw = ariaLabel?.replace(/[^\d+()\s-]/g, '').trim()
        || dataItemId?.replace('phone:tel:', '')
        || null;
    }

    let website = null;
    const websiteLink = await findWebsiteLink(page);
    if (websiteLink) {
      website = await websiteLink.getAttribute('href');
    }

    const phone = phoneRaw ? normalizeBrazilianPhone(phoneRaw) : null;
    const whatsappUrl = buildWhatsAppUrl(phone);

    return { name, address, phone, whatsappUrl, website, email: null, mapsUrl: url };
  } catch (err) {
    logger.warn({ err: err.message, url }, 'Falha ao processar página do lugar');
    return {
      name: null,
      address: null,
      phone: null,
      whatsappUrl: null,
      website: null,
      email: null,
      mapsUrl: url,
      error: err.message,
    };
  } finally {
    await page.close();
  }
}

async function scrapePlacesInParallel(context, links) {
  const absoluteUrls = links.map((link) => (
    link.startsWith('http') ? link : `https://www.google.com${link}`
  ));

  return runInParallelBatches(
    absoluteUrls,
    config.placeConcurrency,
    (url) => scrapePlacePage(context, url),
  );
}

async function enrichResultsWithEmail(results) {
  if (!config.enrichEmail) return results;

  return runInParallelBatches(
    results,
    config.placeConcurrency,
    async (result) => {
      if (!result.website) return result;
      const email = await extractEmailFromWebsite(result.website);
      return { ...result, email };
    },
  );
}

async function scrapeQueryInSession(context, searchPage, { query, location, maxResults, isFirstSearch }) {
  const links = await runMapsSearch(searchPage, { query, location, maxResults, isFirstSearch });
  const results = await scrapePlacesInParallel(context, links);
  return enrichResultsWithEmail(results);
}

/**
 * Busca lugares no Google Maps por termo + localização e retorna nome, endereço,
 * telefone normalizado, site e email (quando o site tiver).
 */
export async function scrapeGoogleMaps({
  query,
  location,
  maxResults = config.maxResultsPerQuery,
}) {
  const browser = await launchBrowser();
  const context = await newStealthContext(browser);
  const searchPage = await context.newPage();

  try {
    return await scrapeQueryInSession(context, searchPage, {
      query,
      location,
      maxResults,
      isFirstSearch: true,
    });
  } finally {
    await searchPage.close();
    await context.close();
    await browser.close();
  }
}

/** Executa várias buscas reutilizando um único browser/context e a mesma aba de busca. */
export async function scrapeGoogleMapsBatch({ queries, location, maxResults = config.maxResultsPerQuery }) {
  const browser = await launchBrowser();
  const context = await newStealthContext(browser);
  const searchPage = await context.newPage();

  try {
    const batches = [];

    for (let i = 0; i < queries.length; i += 1) {
      const query = queries[i];
      const results = await scrapeQueryInSession(context, searchPage, {
        query,
        location,
        maxResults,
        isFirstSearch: i === 0,
      });
      batches.push({ query, results });
    }

    return batches;
  } finally {
    await searchPage.close();
    await context.close();
    await browser.close();
  }
}
