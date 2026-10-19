'use strict';

// Casos gerados pelo Prompt 3 (contrato dirigido pelo consumidor), versão v2.
// O mesmo arquivo de contrato é verificado dos dois lados:
//   - Provedor: o Serviço de Consentimento real, no estado pedido, responde o que o contrato promete?
//   - Consumidor: o Serviço de Envios, recebendo o exemplo do contrato, se comporta como esperado?

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const contrato = require('../../contratos/envios-consentimento.json');
const { escutar, fechar } = require('../../src/http');
const { criarServicoConsentimento } = require('../../src/consentimento/servico');
const { criarAmbiente, criarServidorFalso } = require('../apoio/ambiente');

function tipoDe(valor) {
  if (valor === null) return 'null';
  if (Array.isArray(valor)) return 'array';
  return typeof valor;
}

function urlDaInteracao(base, { caminho, query }) {
  const qs = new URLSearchParams(query).toString();
  return `${base}${caminho}${qs ? `?${qs}` : ''}`;
}

describe('Prompt 3 — contrato Envios → Consentimento (verificação no provedor)', () => {
  for (const i of contrato.interacoes) {
    test(`${i.id} provedor cumpre: ${i.descricao}`, async () => {
      const servico = criarServicoConsentimento({ registros: i.estado });
      const base = await escutar(servico);
      try {
        const resposta = await fetch(urlDaInteracao(base, i.requisicao), { method: i.requisicao.metodo });
        const corpo = await resposta.json();

        assert.equal(resposta.status, i.resposta.status);
        for (const [campo, tipo] of Object.entries(i.resposta.campos)) {
          assert.ok(campo in corpo, `campo obrigatório ausente: ${campo}`);
          assert.equal(tipoDe(corpo[campo]), tipo, `tipo de ${campo}`);
          assert.equal(corpo[campo], i.resposta.exemplo[campo], `valor de ${campo} para o estado dado`);
        }
      } finally {
        await fechar(servico);
      }
    });
  }
});

describe('Prompt 3 — contrato Envios → Consentimento (verificação no consumidor)', () => {
  for (const i of contrato.interacoes) {
    test(`${i.id} consumidor reage: ${i.descricao} → ${i.efeitoNoConsumidor.status}`, async () => {
      const consentimento = await criarServidorFalso({
        respostaPadrao: { status: i.resposta.status, corpo: i.resposta.exemplo },
      });
      const amb = await criarAmbiente({ urlConsentimento: consentimento.url });
      try {
        const telefone = decodeURIComponent(i.requisicao.caminho.split('/').pop());
        const r = await amb.enviar({ telefone, canal: i.requisicao.query.canal, mensagem: 'teste de contrato' });

        // O consumidor pediu exatamente o que o contrato descreve.
        assert.equal(consentimento.chamadas.length, 1);
        assert.equal(consentimento.chamadas[0].url, urlDaInteracao('', i.requisicao));

        assert.equal(r.status, i.efeitoNoConsumidor.status);
        if (i.efeitoNoConsumidor.erro) assert.equal(r.corpo.erro, i.efeitoNoConsumidor.erro);
      } finally {
        await amb.encerrar();
        await consentimento.fechar();
      }
    });
  }

  test('CT-05 campos extras na resposta do provedor não quebram o consumidor (tolerant reader)', async () => {
    const consentimento = await criarServidorFalso({
      respostaPadrao: {
        status: 200,
        corpo: { consentido: true, origem: 'app', versaoTermo: 7, atualizadoEm: '2026-10-01T10:00:00Z', novoCampo: { x: 1 } },
      },
    });
    const amb = await criarAmbiente({ urlConsentimento: consentimento.url });
    try {
      const r = await amb.enviar({ telefone: '+5562999990001', canal: 'whatsapp', mensagem: 'oi' });
      assert.equal(r.status, 202);
    } finally {
      await amb.encerrar();
      await consentimento.fechar();
    }
  });
});
