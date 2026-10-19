'use strict';

const { criarServicoConsentimento } = require('./servico');
const { escutar } = require('../http');

const porta = Number(process.env.PORTA ?? 3001);
const servico = criarServicoConsentimento({
  registros: [
    { telefone: '+5562999990001', canal: 'whatsapp', consentido: true },
    { telefone: '+5562999990002', canal: 'whatsapp', consentido: false },
  ],
});

escutar(servico, porta).then((url) => console.log(`Serviço de Consentimento em ${url}`));
