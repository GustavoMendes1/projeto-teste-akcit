'use strict';

// Serviço de Envios: recebe um pedido de mensagem proativa, confere o
// consentimento no Serviço de Consentimento e repassa ao Provedor de mensagens.
//
//   POST /envios   (cabeçalho Idempotency-Key obrigatório)
//     corpo: { telefone, canal, mensagem }
//     202 { id, status: 'ACEITO', idMensagemProvedor }
//     400 { erro: 'IDEMPOTENCY_KEY_AUSENTE' | 'PAYLOAD_INVALIDO' | 'JSON_INVALIDO', detalhes? }
//     409 { erro: 'IDEMPOTENCY_KEY_CONFLITO' }
//     422 { erro: 'CONSENTIMENTO_AUSENTE' }
//     502 { erro: 'PROVEDOR_INDISPONIVEL' | 'PROVEDOR_REJEITOU' }
//     503 { erro: 'DEPENDENCIA_INDISPONIVEL', dependencia } | { erro: 'PROVEDOR_LIMITADO' } + Retry-After
//
// Regras de negócio (ordem de prioridade: consentimento > entrega > rastreabilidade):
//   R1. Sem consentimento confirmado, nada é enviado (fail-closed): se o Serviço de
//       Consentimento falhar, responder 503 e NÃO chamar o provedor.
//   R2. A mesma Idempotency-Key com o mesmo corpo devolve a mesma resposta sem novo
//       envio; com corpo diferente, 409. Falhas transitórias (5xx/503) não são memorizadas.
//   R3. Falha transitória do provedor (5xx, timeout) é repetida até `tentativasProvedor`
//       vezes, sempre com o mesmo X-Request-Id, para o provedor deduplicar.
//   R4. 429 do provedor não é repetido: responde 503 e repassa o Retry-After.
//   R5. 4xx do provedor (exceto 429) é erro definitivo: 502 PROVEDOR_REJEITOU, sem repetir.

const http = require('node:http');
const crypto = require('node:crypto');
const { lerJson, responder, requisitarJson } = require('../http');
const { validarPedidoDeEnvio } = require('../validacao');

class RespostaHttp {
  constructor(status, corpo, cabecalhos = {}) {
    this.status = status;
    this.corpo = corpo;
    this.cabecalhos = cabecalhos;
  }
}

function hashDoCorpo(corpo) {
  const normalizado = JSON.stringify({ telefone: corpo.telefone, canal: corpo.canal, mensagem: corpo.mensagem });
  return crypto.createHash('sha256').update(normalizado).digest('hex');
}

function criarServicoEnvios({
  urlConsentimento,
  urlProvedor,
  timeoutMs = 500,
  tentativasProvedor = 2,
} = {}) {
  // Idempotency-Key -> { hash, promessa<RespostaHttp> }. A promessa é guardada
  // antes de terminar para que requisições concorrentes com a mesma chave
  // aguardem o mesmo resultado em vez de disparar um segundo envio.
  const idempotencia = new Map();

  async function consultarConsentimento(telefone, canal) {
    const url = `${urlConsentimento}/consentimentos/${encodeURIComponent(telefone)}?canal=${encodeURIComponent(canal)}`;
    let resposta;
    try {
      resposta = await requisitarJson(url, { timeoutMs });
    } catch {
      return { indisponivel: true };
    }
    if (resposta.status === 404) return { consentido: false };
    if (resposta.status !== 200) return { indisponivel: true };
    // Contrato: só confiamos em `consentido` booleano. Qualquer outra coisa é
    // tratada como dependência quebrada (fail-closed), nunca como "sim".
    if (!resposta.jsonValido || typeof resposta.corpo?.consentido !== 'boolean') return { indisponivel: true };
    return { consentido: resposta.corpo.consentido };
  }

  async function enviarAoProvedor(pedido, chave) {
    let ultimaFalha = null;
    for (let tentativa = 1; tentativa <= tentativasProvedor; tentativa++) {
      let resposta;
      try {
        resposta = await requisitarJson(`${urlProvedor}/mensagens`, {
          metodo: 'POST',
          corpo: { destino: pedido.telefone, canal: pedido.canal, texto: pedido.mensagem },
          cabecalhos: { 'x-request-id': chave },
          timeoutMs,
        });
      } catch (erro) {
        ultimaFalha = erro.tipo;
        continue;
      }

      if (resposta.status >= 200 && resposta.status < 300) {
        if (typeof resposta.corpo?.idMensagem !== 'string') {
          return new RespostaHttp(502, { erro: 'PROVEDOR_INDISPONIVEL', motivo: 'resposta fora do contrato' });
        }
        return new RespostaHttp(202, {
          id: crypto.randomUUID(),
          status: 'ACEITO',
          idMensagemProvedor: resposta.corpo.idMensagem,
        });
      }
      if (resposta.status === 429) {
        const retryAfter = resposta.cabecalhos.get('retry-after') ?? '30';
        return new RespostaHttp(503, { erro: 'PROVEDOR_LIMITADO' }, { 'retry-after': retryAfter });
      }
      if (resposta.status >= 400 && resposta.status < 500) {
        return new RespostaHttp(502, { erro: 'PROVEDOR_REJEITOU', statusProvedor: resposta.status });
      }
      ultimaFalha = `HTTP_${resposta.status}`;
    }
    return new RespostaHttp(502, { erro: 'PROVEDOR_INDISPONIVEL', motivo: ultimaFalha });
  }

  async function processar(pedido, chave) {
    const consentimento = await consultarConsentimento(pedido.telefone, pedido.canal);
    if (consentimento.indisponivel) {
      return new RespostaHttp(503, { erro: 'DEPENDENCIA_INDISPONIVEL', dependencia: 'consentimento' }, { 'retry-after': '5' });
    }
    if (!consentimento.consentido) {
      return new RespostaHttp(422, { erro: 'CONSENTIMENTO_AUSENTE' });
    }
    return enviarAoProvedor(pedido, chave);
  }

  function ehTransitoria(resposta) {
    return resposta.status === 503 || resposta.status === 502 && resposta.corpo?.erro === 'PROVEDOR_INDISPONIVEL';
  }

  async function tratarEnvio(req, res) {
    const chave = req.headers['idempotency-key'];
    if (!chave || typeof chave !== 'string' || chave.length > 128) {
      return responder(res, 400, { erro: 'IDEMPOTENCY_KEY_AUSENTE' });
    }

    let corpo;
    try {
      corpo = await lerJson(req);
    } catch (erro) {
      return responder(res, 400, { erro: erro.codigo ?? 'JSON_INVALIDO' });
    }
    const detalhes = validarPedidoDeEnvio(corpo);
    if (detalhes.length) return responder(res, 400, { erro: 'PAYLOAD_INVALIDO', detalhes });

    const hash = hashDoCorpo(corpo);
    const existente = idempotencia.get(chave);
    if (existente && existente.hash !== hash) {
      return responder(res, 409, { erro: 'IDEMPOTENCY_KEY_CONFLITO' });
    }

    let promessa;
    if (existente) {
      promessa = existente.promessa;
    } else {
      promessa = processar(corpo, chave);
      idempotencia.set(chave, { hash, promessa });
      promessa.then((resultado) => {
        if (ehTransitoria(resultado)) idempotencia.delete(chave);
      }, () => idempotencia.delete(chave));
    }

    const resultado = await promessa;
    const cabecalhos = { ...resultado.cabecalhos };
    if (existente) cabecalhos['idempotent-replayed'] = 'true';
    return responder(res, resultado.status, resultado.corpo, cabecalhos);
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    if (req.method === 'GET' && url.pathname === '/saude') return responder(res, 200, { status: 'ok' });
    if (req.method === 'POST' && url.pathname === '/envios') {
      return tratarEnvio(req, res).catch(() => responder(res, 500, { erro: 'ERRO_INTERNO' }));
    }
    return responder(res, 404, { erro: 'ROTA_NAO_ENCONTRADA' });
  });
}

module.exports = { criarServicoEnvios };
