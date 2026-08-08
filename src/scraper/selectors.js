/**
 * O Google muda o HTML do Maps com frequência (classes ofuscadas, sem padrão fixo).
 * Em vez de confiar em UM seletor, cada função tenta várias estratégias em ordem
 * e usa a primeira que encontrar algo. Quando o Maps mudar de novo, normalmente
 * uma das estratégias alternativas ainda funciona — e dá pra adicionar mais sem
 * reescrever a lógica de scraping.
 */

/** Tenta cada seletor da lista até encontrar um elemento visível. Retorna o locator ou null. */
async function firstMatch(page, selectors, { timeout = 4000 } = {}) {
  for (const sel of selectors) {
    try {
      const locator = page.locator(sel).first();
      await locator.waitFor({ state: 'visible', timeout });
      return locator;
    } catch {
      // tenta o próximo
    }
  }
  return null;
}

export async function findSearchBox(page) {
  return firstMatch(page, [
    'input#searchboxinput',                 // id conhecido, mais estável
    'input[aria-label="Search Google Maps"]',
    'input[aria-label="Pesquisar no Google Maps"]',
    'input[name="q"]',
    'form#searchbox input',
  ]);
}

export async function findResultsFeed(page) {
  return firstMatch(page, [
    'div[role="feed"]',
    'div[aria-label^="Results for"]',
    'div[aria-label^="Resultados para"]',
  ], { timeout: 8000 });
}

export function resultCardSelectors() {
  return [
    'div[role="feed"] > div > div[role="article"]',
    'a.hfpxzc',                // classe observada, pode mudar — mantida como fallback
    'div[role="feed"] a[href*="/maps/place/"]',
  ];
}

export async function findPlaceName(page) {
  const locator = await firstMatch(page, [
    'h1.DUwDvf',
    'h1[class*="fontHeadline"]',
    'div[role="main"] h1',
  ]);
  return locator ? (await locator.textContent())?.trim() ?? null : null;
}

export async function findPhoneButton(page) {
  return firstMatch(page, [
    'button[data-item-id^="phone:"]',
    'button[aria-label*="Phone" i]',
    'button[aria-label*="Telefone" i]',
  ]);
}

export async function findWebsiteLink(page) {
  return firstMatch(page, [
    'a[data-item-id="authority"]',
    'a[aria-label*="Website" i]',
    'a[aria-label*="Site" i]',
  ]);
}

export async function findAddress(page) {
  const locator = await firstMatch(page, [
    'button[data-item-id="address"]',
    'button[aria-label*="Address" i]',
    'button[aria-label*="Endereço" i]',
  ]);
  return locator ? (await locator.getAttribute('aria-label'))?.trim() ?? null : null;
}
