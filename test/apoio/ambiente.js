'use strict';

// Sobe o ambiente de integração: Serviço de Consentimento real, Serviço de
// Envios real e um Provedor falso programável (o provedor é externo e pago, então
// é o único componente substituído por dublê).

const http = require('node:http');
const { escutar, fechar, lerJson } = require('../../src/http');
const { criarServicoConsentimento } = require('../../src/consentimento/servico');
const { criarServicoEnvios } = require('../../src/envios/servico');

const REGISTROS_PADRAO = [
  { telefone: '+5562999990001', canal: 'whatsapp', consentido: true },
  { telefone: '+5562999990001', canal: 'rcs', consentido: false },
  { telefone: '+5562999990002', canal: 'whatsapp', consentido: false },
];

// Servidor falso genérico: responde de acordo com uma fila de respostas
// programadas e registra todas as chamadas recebidas.
async function criarServidorFalso({ respostaPadrao = { status: 202, corpo: { idMensagem: 'msg-padrao' } } } = {}) {
  const fila = [];
  const chamadas = [];
  const temporizadores = new Set();

  const servidor = http.createServer(async (req, res) => {
    let corpo = null;
    try {
      corpo = await lerJson(req);
    } catch {
      corpo = '<<inválido>>';
    }
    chamadas.push({ metodo: req.method, url: req.url, cabecalhos: req.headers, corpo });

    const r = fila.length ? fila.shift() : respostaPadrao;
    const enviar = () => {
      if (res.destroyed) return;
      if (r.destruirConexao) return res.socket.destroy();
      res.writeHead(r.status, { 'content-type': 'application/json', ...(r.cabecalhos ?? {}) });
      res.end(r.textoBruto ?? (r.corpo === undefined ? '' : JSON.stringify(r.corpo)));
    };
    if (r.atrasoMs) {
      const t = setTimeout(() => {
        temporizadores.delete(t);
        enviar();
      }, r.atrasoMs);
      temporizadores.add(t);
    } else {
      enviar();
    }
  });

  const url = await escutar(servidor);
  return {
    url,
    chamadas,
    programar(...respostas) {
      fila.push(...respostas);
    },
    async fechar() {
      for (const t of temporizadores) clearTimeout(t);
      await fechar(servidor);
    },
  };
}

async function criarAmbiente({
  registros = REGISTROS_PADRAO,
  urlConsentimento,
  timeoutMs = 300,
  tentativasProvedor = 2,
} = {}) {
  const fechamentos = [];

  let consentimentoUrl = urlConsentimento;
  if (!consentimentoUrl) {
    const consentimento = criarServicoConsentimento({ registros });
    consentimentoUrl = await escutar(consentimento);
    fechamentos.push(() => fechar(consentimento));
  }

  const provedor = await criarServidorFalso();
  fechamentos.push(() => provedor.fechar());

  const envios = criarServicoEnvios({
    urlConsentimento: consentimentoUrl,
    urlProvedor: provedor.url,
    timeoutMs,
    tentativasProvedor,
  });
  const enviosUrl = await escutar(envios);
  fechamentos.push(() => fechar(envios));

  let sequencia = 0;
  async function enviar(corpo, { chave = `chave-${Date.now()}-${++sequencia}`, cabecalhos = {}, textoBruto } = {}) {
    const resposta = await fetch(`${enviosUrl}/envios`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(chave === null ? {} : { 'idempotency-key': chave }), ...cabecalhos },
      body: textoBruto ?? JSON.stringify(corpo),
    });
    const texto = await resposta.text();
    return { status: resposta.status, cabecalhos: resposta.headers, corpo: texto ? JSON.parse(texto) : null };
  }

  return {
    enviosUrl,
    consentimentoUrl,
    provedor,
    enviar,
    async encerrar() {
      for (const f of fechamentos.reverse()) await f();
    },
  };
}

// Uma porta onde não há ninguém escutando: sobe e derruba um servidor.
async function urlSemServico() {
  const servidor = http.createServer();
  const url = await escutar(servidor);
  await fechar(servidor);
  return url;
}

const PEDIDO_VALIDO = Object.freeze({
  telefone: '+5562999990001',
  canal: 'whatsapp',
  mensagem: 'Sua fatura de outubro está disponível.',
});

module.exports = { criarAmbiente, criarServidorFalso, urlSemServico, PEDIDO_VALIDO, REGISTROS_PADRAO };
