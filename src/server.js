import express from 'express';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { scrapeGoogleMapsBatch } from './scraper/mapsScraper.js';

const app = express();
app.use(express.json());

function checkApiKey(req, res, next) {
  if (!config.apiKey) return next(); // sem chave configurada = sem checagem (uso local)
  const provided = req.header('x-api-key');
  if (provided !== config.apiKey) {
    return res.status(401).json({ error: 'API key inválida ou ausente (header x-api-key)' });
  }
  next();
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

function normalizeQueries(query) {
  if (typeof query === 'string') {
    const trimmed = query.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(query)) {
    return query
      .filter((item) => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * POST /scrape
 * Body: { "query": "restaurante japonês", "location": "Barretos, SP", "maxResults": 40 }
 * Body (várias buscas): { "query": ["pizzaria", "farmacia"], "location": "Barretos, SP", "maxResults": 10 }
 */
app.post('/scrape', checkApiKey, async (req, res) => {
  const { query, location, maxResults } = req.body || {};
  const queries = normalizeQueries(query);

  if (queries.length === 0) {
    return res.status(400).json({
      error: 'Campo "query" é obrigatório (string ou array de strings, ex: "pizzaria" ou ["pizzaria", "farmacia"])',
    });
  }

  logger.info({ queries, location, maxResults }, 'Iniciando scraping');

  try {
    const batches = await scrapeGoogleMapsBatch({ queries, location, maxResults });

    if (queries.length === 1) {
      const results = batches[0].results;
      return res.json({
        query: queries[0],
        location: location || null,
        count: results.length,
        results,
      });
    }

    res.json({
      location: location || null,
      count: batches.reduce((sum, batch) => sum + batch.results.length, 0),
      queries: batches.map(({ query: term, results }) => ({
        query: term,
        count: results.length,
        results,
      })),
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Erro no scraping');
    res.status(500).json({ error: 'Falha ao executar scraping', details: err.message });
  }
});

app.listen(config.port, () => {
  logger.info(`gmaps-scraper rodando na porta ${config.port}`);
});
