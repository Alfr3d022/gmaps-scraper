import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),

  // Delays entre ações, em ms. Sempre aleatório dentro do intervalo — nunca fixo.
  delay: {
    minMs: parseInt(process.env.DELAY_MIN_MS || '2500', 10),
    maxMs: parseInt(process.env.DELAY_MAX_MS || '6000', 10),
  },

  // Proxy residencial (recomendado para volume alto). Formato: http://user:pass@host:port
  proxy: process.env.PROXY_URL || null,

  // Limite de resultados por busca antes do Maps parar de carregar mais no scroll
  maxResultsPerQuery: parseInt(process.env.MAX_RESULTS_PER_QUERY || '120', 10),

  // Abas simultâneas ao visitar páginas individuais de cada lugar
  placeConcurrency: Math.min(5, Math.max(1, parseInt(process.env.PLACE_CONCURRENCY || '3', 10))),

  // Timeout de navegação, em ms
  navigationTimeoutMs: parseInt(process.env.NAVIGATION_TIMEOUT_MS || '30000', 10),

  // Rodar navegador visível (útil para debug local) ou headless (produção)
  headless: process.env.HEADLESS !== 'false',

  // Tentar visitar o site de cada lugar para extrair email
  enrichEmail: process.env.ENRICH_EMAIL !== 'false',

  // Caminhos extras do site a tentar além da home, na busca por email
  emailFallbackPaths: ['/contato', '/contact', '/fale-conosco', '/sobre', '/about'],

  // Chave simples de API para proteger o endpoint HTTP (o n8n envia via header)
  apiKey: process.env.API_KEY || null,
};
