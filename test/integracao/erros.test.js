'use strict';

// Casos gerados pelo Prompt 2 (falhas de dependência), versão v3.
// Catálogo e rastreabilidade: docs/casos-gerados.md

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { criarAmbiente, criarServidorFalso, urlSemServico, PEDIDO_VALIDO } = require('../apoio/ambiente');

const TIMEOUT_MS = 300;

describe('Prompt 2 — falhas do Serviço de Consentimento (regra R1: fail-closed)', () => {
  test('ER-01 consentimento fora do ar: 503 DEPENDENCIA_INDISPONIVEL e nada é enviado', async () => {
    const amb = await criarAmbiente({ urlConsentimento: await urlSemServico() });
    try {
      const r = await amb.enviar(PEDIDO_VALIDO);
      assert.equal(r.status, 503);
      assert.deepEqual(r.corpo, { erro: 'DEPENDENCIA_INDISPONIVEL', dependencia: 'consentimento' });
      assert.ok(r.cabecalhos.get('retry-after'));
      assert.equal(amb.provedor.chamadas.length, 0);
    } finally {
      await amb.encerrar();
    }
  });

  describe('com um Consentimento falso programável', () => {
    let consentimento;
    let amb;
    before(async () => {
      consentimento = await criarServidorFalso({
        respostaPadrao: { status: 200, corpo: { telefone: '+5562999990001', canal: 'whatsapp', consentido: true } },
      });
      amb = await criarAmbiente({ urlConsentimento: consentimento.url, timeoutMs: TIMEOUT_MS });
    });
    after(async () => {
      await amb.encerrar();
      await consentimento.fechar();
    });
    beforeEach(() => { amb.provedor.chamadas.length = 0; });

    test('ER-02 consentimento mais lento que o timeout: 503 em tempo limitado, sem envio', async () => {
      consentimento.programar({ status: 200, corpo: { consentido: true }, atrasoMs: TIMEOUT_MS * 4 });
      const inicio = Date.now();
      const r = await amb.enviar(PEDIDO_VALIDO);
      const duracao = Date.now() - inicio;

      assert.equal(r.status, 503);
      assert.equal(r.corpo.dependencia, 'consentimento');
      assert.ok(duracao < TIMEOUT_MS * 3, `respondeu em ${duracao}ms; deveria respeitar o timeout`);
      assert.equal(amb.provedor.chamadas.length, 0);
    });

    test('ER-03 consentimento responde 500: 503, sem envio', async () => {
      consentimento.programar({ status: 500, corpo: { erro: 'boom' } });
      const r = await amb.enviar(PEDIDO_VALIDO);
      assert.equal(r.status, 503);
      assert.equal(amb.provedor.chamadas.length, 0);
    });

    test('ER-04 consentimento responde 200 com corpo que não é JSON: 503, sem envio', async () => {
      consentimento.programar({ status: 200, textoBruto: '<html>proxy error</html>' });
      const r = await amb.enviar(PEDIDO_VALIDO);
      assert.equal(r.status, 503);
      assert.equal(amb.provedor.chamadas.length, 0);
    });

    test('ER-05 consentimento responde consentido="true" (string): quebra de contrato não vira "sim"', async () => {
      consentimento.programar({ status: 200, corpo: { telefone: '+5562999990001', canal: 'whatsapp', consentido: 'true' } });
      const r = await amb.enviar(PEDIDO_VALIDO);
      assert.equal(r.status, 503);
      assert.equal(amb.provedor.chamadas.length, 0);
    });

    test('ER-12 resultado definitivo (422) é memorizado pela chave: consentimento consultado uma única vez', async () => {
      consentimento.programar({ status: 200, corpo: { consentido: false } });
      const antes = consentimento.chamadas.length;
      const primeira = await amb.enviar(PEDIDO_VALIDO, { chave: 'er-12' });
      const segunda = await amb.enviar(PEDIDO_VALIDO, { chave: 'er-12' });

      assert.equal(primeira.status, 422);
      assert.equal(segunda.status, 422);
      assert.equal(segunda.cabecalhos.get('idempotent-replayed'), 'true');
      assert.equal(consentimento.chamadas.length - antes, 1);
    });
  });
});

describe('Prompt 2 — falhas do Provedor (regras R3, R4, R5)', () => {
  let amb;
  before(async () => { amb = await criarAmbiente({ timeoutMs: TIMEOUT_MS, tentativasProvedor: 2 }); });
  after(async () => { await amb.encerrar(); });
  beforeEach(() => { amb.provedor.chamadas.length = 0; });

  test('ER-06 provedor falha com 500 e depois aceita: 202 após 2 tentativas com o mesmo X-Request-Id', async () => {
    amb.provedor.programar({ status: 500 }, { status: 202, corpo: { idMensagem: 'msg-er-06' } });
    const r = await amb.enviar(PEDIDO_VALIDO, { chave: 'er-06' });

    assert.equal(r.status, 202);
    assert.equal(r.corpo.idMensagemProvedor, 'msg-er-06');
    assert.equal(amb.provedor.chamadas.length, 2);
    assert.deepEqual(amb.provedor.chamadas.map((c) => c.cabecalhos['x-request-id']), ['er-06', 'er-06']);
  });

  test('ER-07 provedor falha sempre com 503: 502 PROVEDOR_INDISPONIVEL após exatamente 2 tentativas', async () => {
    amb.provedor.programar({ status: 503 }, { status: 503 });
    const r = await amb.enviar(PEDIDO_VALIDO);

    assert.equal(r.status, 502);
    assert.equal(r.corpo.erro, 'PROVEDOR_INDISPONIVEL');
    assert.equal(amb.provedor.chamadas.length, 2);
  });

  test('ER-08 provedor estoura o timeout e depois aceita: repete com o mesmo X-Request-Id (dedupe no provedor)', async () => {
    amb.provedor.programar(
      { status: 202, corpo: { idMensagem: 'tarde-demais' }, atrasoMs: TIMEOUT_MS * 3 },
      { status: 202, corpo: { idMensagem: 'msg-er-08' } },
    );
    const r = await amb.enviar(PEDIDO_VALIDO, { chave: 'er-08' });

    assert.equal(r.status, 202);
    assert.equal(r.corpo.idMensagemProvedor, 'msg-er-08');
    assert.equal(amb.provedor.chamadas.length, 2);
    assert.equal(amb.provedor.chamadas[0].cabecalhos['x-request-id'], amb.provedor.chamadas[1].cabecalhos['x-request-id']);
  });

  test('ER-09 provedor limita (429 + Retry-After): 503 PROVEDOR_LIMITADO, repassa Retry-After e não repete', async () => {
    amb.provedor.programar({ status: 429, cabecalhos: { 'retry-after': '60' }, corpo: { erro: 'rate limit' } });
    const r = await amb.enviar(PEDIDO_VALIDO);

    assert.equal(r.status, 503);
    assert.equal(r.corpo.erro, 'PROVEDOR_LIMITADO');
    assert.equal(r.cabecalhos.get('retry-after'), '60');
    assert.equal(amb.provedor.chamadas.length, 1);
  });

  test('ER-10 provedor rejeita (400): 502 PROVEDOR_REJEITOU, sem repetir', async () => {
    amb.provedor.programar({ status: 400, corpo: { erro: 'template não aprovado' } });
    const r = await amb.enviar(PEDIDO_VALIDO);

    assert.equal(r.status, 502);
    assert.equal(r.corpo.erro, 'PROVEDOR_REJEITOU');
    assert.equal(r.corpo.statusProvedor, 400);
    assert.equal(amb.provedor.chamadas.length, 1);
  });

  test('ER-11 falha transitória não é memorizada: a mesma chave pode ser reenviada e dar certo', async () => {
    amb.provedor.programar({ status: 500 }, { status: 500 });
    const falha = await amb.enviar(PEDIDO_VALIDO, { chave: 'er-11' });
    assert.equal(falha.status, 502);

    amb.provedor.programar({ status: 202, corpo: { idMensagem: 'msg-er-11' } });
    const sucesso = await amb.enviar(PEDIDO_VALIDO, { chave: 'er-11' });
    assert.equal(sucesso.status, 202);
    assert.equal(sucesso.corpo.idMensagemProvedor, 'msg-er-11');
    assert.equal(sucesso.cabecalhos.get('idempotent-replayed'), null);
    assert.equal(amb.provedor.chamadas.length, 3);
  });

  test('ER-13 provedor derruba a conexão sem responder: trata como transitório e repete', async () => {
    amb.provedor.programar({ destruirConexao: true }, { status: 202, corpo: { idMensagem: 'msg-er-13' } });
    const r = await amb.enviar(PEDIDO_VALIDO);

    assert.equal(r.status, 202);
    assert.equal(r.corpo.idMensagemProvedor, 'msg-er-13');
    assert.equal(amb.provedor.chamadas.length, 2);
  });

  test('ER-14 provedor responde 202 sem idMensagem: 502, não reporta ACEITO sem rastreabilidade', async () => {
    amb.provedor.programar({ status: 202, corpo: { ok: true } });
    const r = await amb.enviar(PEDIDO_VALIDO);

    assert.equal(r.status, 502);
    assert.equal(r.corpo.erro, 'PROVEDOR_INDISPONIVEL');
  });
});
