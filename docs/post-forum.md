# Rascunho do post para o fórum

> Texto para colar no fórum da Unidade III. Não faz parte da documentação técnica.

---

**Repositório:** https://github.com/GustavoMendes1/projeto-teste-akcit

**Cenário:** integração REST entre três serviços — um Serviço de Envios de mensagens (WhatsApp/RCS), um Serviço de Consentimento (LGPD/opt-in) e um provedor externo de mensagens. A regra central é *fail-closed*: sem consentimento confirmado, nada é enviado, mesmo que o Consentimento esteja fora do ar. Envios e Consentimento sobem de verdade nos testes; só o provedor externo é um dublê. São 32 testes, todos passando, em Node puro sem dependências.

**Tipos de prompt que usei**

1. **Geração de cenários de integração** (papel + contexto + formato de saída): fluxos ponta a ponta com oráculo na dependência.
2. **Casos de erro guiados por técnica**: uma matriz *dependência × modo de falha* (fora do ar, timeout, 5xx, 429, corpo fora do contrato, conexão derrubada…).
3. (extra) **Contrato dirigido pelo consumidor**: a LLM recebe o código do consumidor e deriva só o que ele realmente lê.

**Como cada tipo influenciou qualidade e diversidade**

- O de **cenários** trouxe amplitude de fluxo (opt-out, consentimento por canal, idempotência, concorrência). Na v1 a "diversidade" era falsa: 12 casos, mas 5 eram validação de campo e 3 testavam endpoints que não existem.
- A **matriz de falhas** trouxe profundidade nas fronteiras. Por ser sistemática, achou casos que eu não teria listado — o Consentimento responder 200 com HTML de proxy, ou `consentido: "true"` como string. Mas foi o tipo que mais alucinou: nas células que as regras não cobriam, a LLM inventou comportamento com toda a confiança ("repetir 3× e devolver 504").
- O de **contrato** trouxe precisão em vez de quantidade: de um OpenAPI completo e frágil para um contrato com um único campo obrigatório (`consentido: boolean`).

Para checar se os testes servem para alguma coisa, injetei 6 defeitos típicos de integração no código (fail-open, corrida na idempotência, `X-Request-Id` diferente no retry, `+` do telefone sem codificação…). **Todos os 6 foram pegos; dos casos da v1, só um pegaria algum deles.** Os dois defeitos mais graves (enviar sem consentimento e enviar em duplicidade) foram pegos, cada um, por um único teste que só apareceu depois de ajustar o prompt.

**Ajustes que mais fizeram diferença**

1. **Colar o contrato real da API** num bloco de contexto comum. Sem isso, a LLM testa uma API imaginária (JWT, paginação, DELETE…).
2. **Definir o que conta como integração e exigir oráculo na dependência**: "o provedor foi chamado 0 vezes" em vez de "retorna 422".
3. **Nomear a técnica** (matriz de falhas, *consumer-driven contract*) em vez de pedir "casos de erro".
4. **Proibir a invenção de comportamento e pedir perguntas para o time.** Foi o ajuste mais valioso: transformou alucinação em 4 perguntas de requisito, que viraram decisões explícitas e 5 testes.
5. **Pedir rastreabilidade por regra de negócio**, o que deixa as lacunas de cobertura visíveis na hora.

**Reflexão sobre a GenAI como copiloto:** o papel que funcionou melhor não foi "escrever os testes", e sim varrer o espaço de casos e levantar perguntas. As partes de maior valor — definir as regras, decidir os casos ambíguos e escolher o oráculo — continuaram humanas. A LLM também foi inconsistente entre prompts (num, apontou que o `+` precisa ser `%2B`; no outro, escreveu o caminho com `+` cru), então a revisão continua obrigatória. Um bom prompt de teste de integração acaba parecendo mais uma especificação do que um pedido.

Os prompts (todas as versões), o catálogo de casos com a origem de cada um e a análise completa estão no repositório.
