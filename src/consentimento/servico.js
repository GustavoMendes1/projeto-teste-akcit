'use strict';

// Serviço de Consentimento: responde se um telefone autorizou receber
// mensagens proativas em um canal. É a fonte da verdade para LGPD/opt-in.
//
//   GET /consentimentos/{telefone}?canal=whatsapp|rcs
//     200 { telefone, canal, consentido, atualizadoEm }
//     400 { erro: 'PARAMETRO_INVALIDO', detalhes }
//     404 { erro: 'CONSENTIMENTO_NAO_ENCONTRADO' }
//   GET /saude -> 200 { status: 'ok' }

const http = require('node:http');
const { responder } = require('../http');
const { telefoneValido, canalValido, CANAIS } = require('../validacao');

function chave(telefone, canal) {
  return `${telefone}|${canal}`;
}

function criarServicoConsentimento({ registros = [] } = {}) {
  const base = new Map();
  for (const r of registros) {
    base.set(chave(r.telefone, r.canal), {
      telefone: r.telefone,
      canal: r.canal,
      consentido: r.consentido,
      atualizadoEm: r.atualizadoEm ?? new Date().toISOString(),
    });
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local');

    if (req.method === 'GET' && url.pathname === '/saude') {
      return responder(res, 200, { status: 'ok' });
    }

    const rota = url.pathname.match(/^\/consentimentos\/([^/]+)$/);
    if (req.method === 'GET' && rota) {
      let telefone;
      try {
        telefone = decodeURIComponent(rota[1]);
      } catch {
        return responder(res, 400, { erro: 'PARAMETRO_INVALIDO', detalhes: ['telefone mal codificado'] });
      }
      const canal = url.searchParams.get('canal');
      const detalhes = [];
      if (!telefoneValido(telefone)) detalhes.push('telefone deve estar no formato E.164');
      if (!canalValido(canal)) detalhes.push(`canal deve ser um de: ${CANAIS.join(', ')}`);
      if (detalhes.length) return responder(res, 400, { erro: 'PARAMETRO_INVALIDO', detalhes });

      const registro = base.get(chave(telefone, canal));
      if (!registro) return responder(res, 404, { erro: 'CONSENTIMENTO_NAO_ENCONTRADO' });
      return responder(res, 200, registro);
    }

    return responder(res, 404, { erro: 'ROTA_NAO_ENCONTRADA' });
  });
}

module.exports = { criarServicoConsentimento };
