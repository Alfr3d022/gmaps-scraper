# Imagem oficial do Playwright já vem com Chromium, dependências do sistema
# e fontes corretas — evita o inferno de libs faltando em imagens genéricas do Node.
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV HEADLESS=true

EXPOSE 3000

CMD ["node", "src/server.js"]
