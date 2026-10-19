'use strict';

const { criarServicoEnvios } = require('./servico');
const { escutar } = require('../http');

const porta = Number(process.env.PORTA ?? 3000);
const servico = criarServicoEnvios({
  urlConsentimento: process.env.URL_CONSENTIMENTO ?? 'http://127.0.0.1:3001',
  urlProvedor: process.env.URL_PROVEDOR ?? 'http://127.0.0.1:3002',
});

escutar(servico, porta).then((url) => console.log(`Serviço de Envios em ${url}`));
