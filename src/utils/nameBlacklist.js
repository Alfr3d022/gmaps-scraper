function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR');
}

export function createNameBlacklist(names = []) {
  return new Set(names.map(normalizeName).filter(Boolean));
}

export function isNameBlacklisted(name, blacklist) {
  if (!name || blacklist.size === 0) return false;
  return blacklist.has(normalizeName(name));
}
