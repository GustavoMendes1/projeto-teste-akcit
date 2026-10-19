'use strict';

// Casos gerados pelo Prompt 1 (cenários de integração), versão v2.
// Catálogo e rastreabilidade: docs/casos-gerados.md

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { criarAmbiente, criarServidorFalso, PEDIDO_VALIDO } = require('../apoio/ambiente');

describe('Prompt 1 — cenários de integração Envios ↔ Consentimento ↔ Provedor', () => {
  let amb;
  before(async () => { amb = await criarAmbiente(); });
  after(async () => { await amb.encerrar(); });

  test('CI-01 caminho feliz: aceita o envio e repassa ao provedor exatamente uma vez, no formato do contrato', async () => {
    const antes = amb.provedor.chamadas.length;
    const r = await amb.enviar(PEDIDO_VALIDO, { chave: 'ci-01' });

    assert.equal(r.status, 202);
    assert.equal(r.corpo.status, 'ACEITO');
    assert.equal(r.corpo.idMensagemProvedor, 'msg-padrao');
    assert.match(r.corpo.id, /^[0-9a-f-]{36}$/);

    const chamadas = amb.provedor.chamadas.slice(antes);
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].metodo, 'POST');
    assert.equal(chamadas[0].url, '/mensagens');
    assert.deepEqual(chamadas[0].corpo, {
      destino: PEDIDO_VALIDO.telefone,
      canal: PEDIDO_VALIDO.canal,
      texto: PEDIDO_VALIDO.mensagem,
    });
    assert.equal(chamadas[0].cabecalhos['x-request-id'], 'ci-01');
  });

  test('CI-02 opt-out explícito (consentido=false): 422 e o provedor não é chamado', async () => {
    const antes = amb.provedor.chamadas.length;
    const r = await amb.enviar({ ...PEDIDO_VALIDO, telefone: '+5562999990002' });

    assert.equal(r.status, 422);
    assert.equal(r.corpo.erro, 'CONSENTIMENTO_AUSENTE');
    assert.equal(amb.provedor.chamadas.length, antes);
  });

  test('CI-03 telefone sem registro (404 no consentimento) é tratado como ausência de consentimento', async () => {
    const antes = amb.provedor.chamadas.length;
    const r = await amb.enviar({ ...PEDIDO_VALIDO, telefone: '+5511988887777' });

    assert.equal(r.status, 422);
    assert.equal(r.corpo.erro, 'CONSENTIMENTO_AUSENTE');
    assert.equal(amb.provedor.chamadas.length, antes);
  });

  test('CI-04 consentimento é por canal: o mesmo telefone pode no WhatsApp e não pode no RCS', async () => {
    const whatsapp = await amb.enviar({ ...PEDIDO_VALIDO, canal: 'whatsapp' });
    const rcs = await amb.enviar({ ...PEDIDO_VALIDO, canal: 'rcs' });

    assert.equal(whatsapp.status, 202);
    assert.equal(rcs.status, 422);
  });

  test('CI-06 idempotência sequencial: mesma chave e mesmo corpo devolvem a mesma resposta sem novo envio', async () => {
    const antes = amb.provedor.chamadas.length;
    const primeira = await amb.enviar(PEDIDO_VALIDO, { chave: 'ci-06' });
    const segunda = await amb.enviar(PEDIDO_VALIDO, { chave: 'ci-06' });

    assert.equal(primeira.status, 202);
    assert.equal(segunda.status, 202);
    assert.deepEqual(segunda.corpo, primeira.corpo);
    assert.equal(segunda.cabecalhos.get('idempotent-replayed'), 'true');
    assert.equal(amb.provedor.chamadas.length - antes, 1);
  });

  test('CI-07 idempotência concorrente: 5 requisições simultâneas com a mesma chave geram um único envio', async () => {
    const antes = amb.provedor.chamadas.length;
    amb.provedor.programar({ status: 202, corpo: { idMensagem: 'msg-ci-07' }, atrasoMs: 50 });

    const respostas = await Promise.all(
      Array.from({ length: 5 }, () => amb.enviar(PEDIDO_VALIDO, { chave: 'ci-07' })),
    );

    assert.equal(amb.provedor.chamadas.length - antes, 1);
    const ids = new Set(respostas.map((r) => r.corpo.id));
    assert.equal(ids.size, 1);
    for (const r of respostas) {
      assert.equal(r.status, 202);
      assert.equal(r.corpo.idMensagemProvedor, 'msg-ci-07');
    }
  });

  test('CI-08 mesma chave com corpo diferente: 409 e nenhum envio adicional', async () => {
    await amb.enviar(PEDIDO_VALIDO, { chave: 'ci-08' });
    const antes = amb.provedor.chamadas.length;
    const r = await amb.enviar({ ...PEDIDO_VALIDO, mensagem: 'outra mensagem' }, { chave: 'ci-08' });

    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro, 'IDEMPOTENCY_KEY_CONFLITO');
    assert.equal(amb.provedor.chamadas.length, antes);
  });
});

describe('Prompt 1 — cenários que observam a chamada ao Consentimento', () => {
  let consentimentoFalso;
  let amb;
  before(async () => {
    consentimentoFalso = await criarServidorFalso({
      respostaPadrao: { status: 200, corpo: { telefone: '+5562999990001', canal: 'whatsapp', consentido: true } },
    });
    amb = await criarAmbiente({ urlConsentimento: consentimentoFalso.url });
  });
  after(async () => {
    await amb.encerrar();
    await consentimentoFalso.fechar();
  });

  test('CI-05 o "+" do telefone E.164 chega codificado no path e o canal vai na query', async () => {
    consentimentoFalso.chamadas.length = 0;
    await amb.enviar(PEDIDO_VALIDO);

    assert.equal(consentimentoFalso.chamadas.length, 1);
    assert.equal(consentimentoFalso.chamadas[0].metodo, 'GET');
    assert.equal(consentimentoFalso.chamadas[0].url, '/consentimentos/%2B5562999990001?canal=whatsapp');
  });

  test('CI-09 pedido inválido é barrado no Envios: 400 sem chamar Consentimento nem Provedor', async () => {
    consentimentoFalso.chamadas.length = 0;
    const antesProvedor = amb.provedor.chamadas.length;

    const invalidos = [
      { ...PEDIDO_VALIDO, telefone: '62999990001' },
      { ...PEDIDO_VALIDO, canal: 'sms' },
      { ...PEDIDO_VALIDO, mensagem: '   ' },
      { ...PEDIDO_VALIDO, mensagem: 'x'.repeat(1001) },
    ];
    for (const corpo of invalidos) {
      const r = await amb.enviar(corpo);
      assert.equal(r.status, 400, JSON.stringify(corpo).slice(0, 80));
      assert.equal(r.corpo.erro, 'PAYLOAD_INVALIDO');
    }
    const semChave = await amb.enviar(PEDIDO_VALIDO, { chave: null });
    assert.equal(semChave.status, 400);
    assert.equal(semChave.corpo.erro, 'IDEMPOTENCY_KEY_AUSENTE');

    const jsonQuebrado = await amb.enviar(null, { textoBruto: '{"telefone": ' });
    assert.equal(jsonQuebrado.status, 400);
    assert.equal(jsonQuebrado.corpo.erro, 'JSON_INVALIDO');

    assert.equal(consentimentoFalso.chamadas.length, 0);
    assert.equal(amb.provedor.chamadas.length, antesProvedor);
  });
});
