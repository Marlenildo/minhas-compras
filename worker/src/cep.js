// CEP → cidade/estado → localização que o Google Shopping (SerpApi) entende.
// A SerpApi só conhece cidades maiores; quando a cidade não está lá, usa o estado.

const ESTADOS = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapa', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceara', DF: 'Federal District',
  ES: 'Espirito Santo', GO: 'Goias', MA: 'Maranhao', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Para', PB: 'Paraiba', PR: 'Parana', PE: 'Pernambuco', PI: 'Piaui', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondonia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'Sao Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

export const limparCep = (cep) => String(cep || '').replace(/\D/g, '').slice(0, 8);

/** Cidade e UF de um CEP (ViaCEP; se falhar, BrasilAPI). Devolve null se o CEP não existir. */
export async function cidadeDoCep(cep, fetcher = fetch) {
  const c = limparCep(cep);
  if (c.length !== 8) return null;
  try {
    const r = await fetcher(`https://viacep.com.br/ws/${c}/json/`, { headers: { accept: 'application/json' } });
    if (r.ok) {
      const j = await r.json();
      if (j && !j.erro && j.localidade && j.uf) return { cidade: j.localidade, uf: j.uf };
      if (j && j.erro) return null;
    }
  } catch (_) {
    /* tenta a outra fonte */
  }
  try {
    const r = await fetcher(`https://brasilapi.com.br/api/cep/v1/${c}`, { headers: { accept: 'application/json' } });
    if (r.ok) {
      const j = await r.json();
      if (j && j.city && j.state) return { cidade: j.city, uf: j.state };
    }
  } catch (_) {
    /* sem cidade */
  }
  return null;
}

async function procurarLocal(q, fetcher) {
  try {
    const r = await fetcher(`https://serpapi.com/locations.json?${new URLSearchParams({ q, limit: '10' })}`, {
      headers: { accept: 'application/json' },
    });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j.filter((l) => l.country_code === 'BR') : [];
  } catch (_) {
    return [];
  }
}

/** Nome da localização para a SerpApi: a cidade, se ela conhecer; senão o estado; senão "Brazil". */
export async function localizacaoGoogle({ cidade, uf }, fetcher = fetch) {
  const estado = ESTADOS[uf];
  const cidadeSA = semAcento(cidade).toLowerCase();
  const daCidade = (await procurarLocal(semAcento(cidade), fetcher)).find(
    (l) => semAcento(l.name).toLowerCase() === cidadeSA && (!estado || semAcento(l.canonical_name).includes(estado))
  );
  if (daCidade) return { location: daCidade.canonical_name, nivel: 'cidade' };
  if (estado) {
    const doEstado = (await procurarLocal(estado, fetcher)).find((l) => /state|region|district/i.test(l.target_type || '') && semAcento(l.name) === estado);
    if (doEstado) return { location: doEstado.canonical_name, nivel: 'estado' };
  }
  return { location: 'Brazil', nivel: 'pais' };
}

/** CEP → { cep, cidade, uf, location, nivel }, guardado por 30 dias no KV. */
export async function localDoCep(cep, { env, fetcher = fetch } = {}) {
  const c = limparCep(cep);
  if (c.length !== 8) return null;
  const chave = `cep:${c}`;
  if (env.TOKENS) {
    const salvo = await env.TOKENS.get(chave, 'json').catch(() => null);
    if (salvo) return salvo;
  }
  const lugar = await cidadeDoCep(c, fetcher);
  if (!lugar) return null;
  const local = { cep: c, ...lugar, ...(await localizacaoGoogle(lugar, fetcher)) };
  if (env.TOKENS) await env.TOKENS.put(chave, JSON.stringify(local), { expirationTtl: 30 * 24 * 3600 }).catch(() => {});
  return local;
}
