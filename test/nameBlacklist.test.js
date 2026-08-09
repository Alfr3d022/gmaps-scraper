import test from 'node:test';
import assert from 'node:assert/strict';
import { createNameBlacklist, isNameBlacklisted } from '../src/utils/nameBlacklist.js';

test('compara nomes ignorando caixa, acentos e espaços repetidos', () => {
  const blacklist = createNameBlacklist(['  Pizzaría São João  ']);

  assert.equal(isNameBlacklisted('pizzaria  sao joao', blacklist), true);
});

test('não bloqueia nomes apenas parcialmente semelhantes', () => {
  const blacklist = createNameBlacklist(['Bar']);

  assert.equal(isNameBlacklisted('Barretos Pizzaria', blacklist), false);
});

test('aceita blacklist vazia e nome ausente', () => {
  const blacklist = createNameBlacklist();

  assert.equal(isNameBlacklisted(null, blacklist), false);
});
