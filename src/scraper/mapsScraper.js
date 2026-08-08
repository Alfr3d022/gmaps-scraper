import { chromium } from 'playwright';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { randomDelay, microDelay } from '../utils/delay.js';
import { normalizeBrazilianPhone } from '../utils/phoneNormalizer.js';
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

  // Remove o sinal mais óbvio de automação (navigator.webdriver)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  context.setDefaultTimeout(config.navigationTimeoutMs);
  return context;
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

async function scrapePlacePage(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await randomDelay(1200, 2500);

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

    let email = null;
    if (website && config.enrichEmail) {
      email = await extractEmailFromWebsite(website);
    }

    return { name, address, phone, website, email, mapsUrl: url };
  } catch (err) {
    logger.warn({ err: err.message, url }, 'Falha ao processar página do lugar');
    return { name: null, address: null, phone: null, website: null, email: null, mapsUrl: url, error: err.message };
  } finally {
    await page.close();
  }
}

/**
 * Busca lugares no Google Maps por termo + localização e retorna nome, endereço,
 * telefone normalizado, site e email (quando o site tiver).
 */
export async function scrapeGoogleMaps({ query, location, maxResults = config.maxResultsPerQuery }) {
  const browser = await launchBrowser();
  const context = await newStealthContext(browser);
  const results = [];

  try {
    const page = await context.newPage();
    const searchTerm = location ? `${query} ${location}` : query;

    await page.goto('https://www.google.com/maps', { waitUntil: 'domcontentloaded' });
    await randomDelay();

    const searchBox = await findSearchBox(page);
    if (!searchBox) throw new Error('Caixa de busca do Maps não encontrada — possível bloqueio ou mudança de layout.');

    await searchBox.click();
    await searchBox.type(searchTerm, { delay: 60 + Math.random() * 80 });
    await page.keyboard.press('Enter');
    await randomDelay(2000, 4000);

    const links = await collectResultLinks(page, maxResults);
    logger.info({ count: links.length, searchTerm }, 'Links coletados');
    await page.close();

    for (const link of links) {
      const absoluteUrl = link.startsWith('http') ? link : `https://www.google.com${link}`;
      const result = await scrapePlacePage(context, absoluteUrl);
      results.push(result);
      await randomDelay();
    }

    return results;
  } finally {
    await context.close();
    await browser.close();
  }
}
