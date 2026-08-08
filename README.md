# gmaps-scraper

Scraper de leads do Google Maps (nome, endereço, telefone normalizado, site e email)
usando Playwright, exposto como API HTTP para consumo direto do n8n.

⚠️ **Aviso importante**: isso faz scraping direto do Google Maps, o que está fora dos
Termos de Serviço do Google. Funciona, mas carrega o risco de bloqueio de IP e não tem
garantia de estabilidade a longo prazo — o Google muda o HTML periodicamente. Para volume
baixo/moderado e dentro dos Termos, considere a Places API oficial como alternativa.

## Como funciona

1. Abre uma sessão de navegador real (Chromium via Playwright), não requisição HTTP crua
2. Busca o termo + localização no Maps e rola o painel de resultados coletando links
3. Visita cada lugar individualmente extraindo nome, endereço, telefone e site
4. Se houver site, visita a home (e páginas de contato comuns) procurando email
5. Telefone é normalizado (celular/fixo, DDD) e filtrado contra uma blocklist de falsos
   positivos que o próprio Maps às vezes injeta

Seletores usam múltiplas estratégias em cascata (`src/scraper/selectors.js`) — quando o
Google muda uma classe CSS, o scraper tenta a próxima estratégia antes de falhar.

## Rodando localmente

```bash
cp .env.example .env
npm install
npx playwright install --with-deps chromium
npm start
```

Testar direto sem subir o servidor:

```bash
node src/cli.js "restaurante japonês" "Barretos, SP" 30
```

## Rodando com Docker

```bash
docker compose up --build
```

## Deploy no RKE2

A imagem já está pronta pra virar um Deployment no seu cluster. Pontos de atenção:

- Defina `API_KEY` como Secret, não como env var em texto puro no manifest
- Se for rodar em volume alto, configure `PROXY_URL` com um proxy residencial — sem isso
  o IP do pod vai ser bloqueado rápido em uso intenso
- `HEADLESS=true` é obrigatório em produção (não tem display no cluster)
- Playwright/Chromium consome bastante memória — reserve pelo menos 1 GB de limite por pod

## Endpoint HTTP (para o n8n)

**POST** `/scrape`

Headers:
```
Content-Type: application/json
x-api-key: <sua API_KEY, se configurada>
```

Body (uma busca):
```json
{
  "query": "restaurante japonês",
  "location": "Barretos, SP",
  "maxResults": 40
}
```

Body (várias buscas — `maxResults` vale por termo):
```json
{
  "query": ["pizzaria", "farmacia", "mercado", "loja"],
  "location": "Barretos, SP",
  "maxResults": 10
}
```

Resposta (uma busca):
```json
{
  "query": "restaurante japonês",
  "location": "Barretos, SP",
  "count": 2,
  "results": [
    {
      "name": "Sushi da Esquina",
      "address": "Rua Exemplo, 123 - Barretos, SP",
      "phone": {
        "raw": "(17) 99999-8888",
        "digitsOnly": "17999998888",
        "ddd": "17",
        "type": "celular",
        "formatted": "(17) 99999-8888",
        "blocked": false
      },
      "website": "https://sushidaesquina.com.br",
      "email": {
        "email": "contato@sushidaesquina.com.br",
        "source": "mailto",
        "allFound": ["contato@sushidaesquina.com.br"]
      },
      "mapsUrl": "https://www.google.com/maps/place/..."
    }
  ]
}
```

Resposta (várias buscas):
```json
{
  "location": "Barretos, SP",
  "count": 25,
  "queries": [
    {
      "query": "pizzaria",
      "count": 10,
      "results": [ "...mesmo formato de cada lugar..." ]
    },
    {
      "query": "farmacia",
      "count": 8,
      "results": [ "...mesmo formato de cada lugar..." ]
    }
  ]
}
```

## No n8n

Node **HTTP Request**:
- Method: `POST`
- URL: `http://<host-do-servico>:3000/scrape`
- Headers: `x-api-key: <sua chave>`
- Body (JSON): `{{ { query: $json.termo, location: $json.regiao, maxResults: 40 } }}`

O resultado já vem em JSON estruturado, pronto pra alimentar seu node de deduplicação
e salvar no Google Sheets, no mesmo formato que você já usa.

## Ajustando quando o Maps mudar o layout

Se o scraping parar de encontrar resultados do nada, o primeiro lugar a olhar é
`src/scraper/selectors.js`. Abra o Maps manualmente, inspecione o elemento que parou de
ser encontrado, e adicione um novo seletor no topo da lista correspondente — as
estratégias antigas continuam como fallback.

## Limitações conhecidas

- Sem proxy residencial, volume alto (centenas de buscas seguidas) vai resultar em
  CAPTCHA ou bloqueio temporário do IP
- Email só é encontrado quando o estabelecimento tem site E o email está visível no
  HTML (não funciona para contato só por WhatsApp/Instagram)
- O Maps limita resultados visíveis por busca (~120) — para cobrir uma cidade inteira,
  rode buscas separadas por bairro/região em vez de uma busca ampla só
