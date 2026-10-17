'use strict';

/** Cache da configuração de execução dos endpoints. Invalidado sempre que o painel altera algo. */
class MetadataService {
  constructor(endpointRepo) {
    this.repo = endpointRepo;
    this.cache = new Map();
  }

  get(slug) {
    const key = String(slug).toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key);
    const ep = this.repo.loadRuntime(key);
    this.cache.set(key, ep);
    return ep;
  }

  invalidate() {
    this.cache.clear();
  }
}

module.exports = { MetadataService };
