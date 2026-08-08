import { config } from '../config.js';

/** Espera um tempo aleatório dentro do intervalo configurado. Nunca usar delay fixo — padrão previsível é o que gatilha detecção de bot. */
export function randomDelay(minMs = config.delay.minMs, maxMs = config.delay.maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Delay curto (ações dentro da mesma página, tipo scroll) */
export function microDelay() {
  return randomDelay(300, 900);
}
