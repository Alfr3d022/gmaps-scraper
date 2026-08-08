import { scrapeGoogleMaps } from './scraper/mapsScraper.js';
import { logger } from './utils/logger.js';

// Uso: node src/cli.js "restaurante japonês" "Barretos, SP" 30
const [, , query, location, maxResultsArg] = process.argv;

if (!query) {
  console.error('Uso: node src/cli.js "<termo de busca>" "<localização>" [maxResults]');
  process.exit(1);
}

const maxResults = maxResultsArg ? parseInt(maxResultsArg, 10) : undefined;

const results = await scrapeGoogleMaps({ query, location, maxResults });
logger.info({ count: results.length }, 'Concluído');
console.log(JSON.stringify(results, null, 2));
