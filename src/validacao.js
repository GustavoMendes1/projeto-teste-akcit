'use strict';

const CANAIS = ['whatsapp', 'rcs'];
const TELEFONE_E164 = /^\+[1-9]\d{9,14}$/;
const TAMANHO_MAXIMO_MENSAGEM = 1000;

function telefoneValido(telefone) {
  return typeof telefone === 'string' && TELEFONE_E164.test(telefone);
}

function canalValido(canal) {
  return CANAIS.includes(canal);
}

function validarPedidoDeEnvio(corpo) {
  const erros = [];
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return ['corpo deve ser um objeto JSON'];
  }
  if (!telefoneValido(corpo.telefone)) erros.push('telefone deve estar no formato E.164 (ex.: +5562999990000)');
  if (!canalValido(corpo.canal)) erros.push(`canal deve ser um de: ${CANAIS.join(', ')}`);
  if (typeof corpo.mensagem !== 'string' || corpo.mensagem.trim() === '') {
    erros.push('mensagem é obrigatória');
  } else if (corpo.mensagem.length > TAMANHO_MAXIMO_MENSAGEM) {
    erros.push(`mensagem deve ter no máximo ${TAMANHO_MAXIMO_MENSAGEM} caracteres`);
  }
  return erros;
}

module.exports = { CANAIS, TAMANHO_MAXIMO_MENSAGEM, telefoneValido, canalValido, validarPedidoDeEnvio };
