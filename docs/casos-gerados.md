# Catálogo de casos de teste gerados

Cada linha é um caso gerado pela LLM e implementado. **Origem** indica a versão do prompt em que o caso apareceu pela primeira vez — é o que permite comparar o que cada tipo e cada ajuste de prompt acrescentou.

Legenda de origem: `v1` já aparecia no prompt ingênuo · `v2`/`v3` só apareceu depois do ajuste · `pergunta` veio de uma "Pergunta para o time" (v3) e foi decidido por nós.

## Prompt 1 — Cenários de integração

Prompt: [`prompts/01-cenarios-integracao.md`](../prompts/01-cenarios-integracao.md) · Testes: [`test/integracao/cenarios.test.js`](../test/integracao/cenarios.test.js)

| ID | Regra | Pré-condição | Ação | Esperado no Envios | Oráculo na dependência | Origem |
| --- | --- | --- | --- | --- | --- | --- |
| CI-01 | — | telefone com opt-in no WhatsApp | POST válido | 202 `ACEITO` com `idMensagemProvedor` | Provedor recebe 1 chamada `{destino, canal, texto}` com `X-Request-Id` = chave | v1 (oráculo: v2) |
| CI-02 | R1 | `consentido=false` | POST válido | 422 `CONSENTIMENTO_AUSENTE` | Provedor: 0 chamadas | v1 (oráculo: v2) |
| CI-03 | R1 | telefone sem registro (404) | POST válido | 422 | Provedor: 0 chamadas | v2 |
| CI-04 | R1 | opt-in só no WhatsApp | POST WhatsApp e POST RCS | 202 e 422 | — | v2 |
| CI-05 | — | Consentimento falso registrando URLs | POST válido | — | Consentimento recebe `GET /consentimentos/%2B5562…?canal=whatsapp` | v2 |
| CI-06 | R2 | — | 2× mesma chave e corpo | Respostas idênticas, 2ª com `Idempotent-Replayed` | Provedor: 1 chamada | v2 |
| CI-07 | R2 | provedor com atraso de 50 ms | 5× em paralelo, mesma chave | Todas 202 com o mesmo `id` | Provedor: 1 chamada | v2 |
| CI-08 | R2 | chave já usada | mesma chave, corpo diferente | 409 | Provedor: nenhuma chamada nova | v2 (pedido de complemento) |
| CI-09 | — | — | 4 payloads inválidos, sem chave, JSON quebrado | 400 | Consentimento e Provedor: 0 chamadas | v1 (agrupado na v2) |

## Prompt 2 — Falhas de dependência

Prompt: [`prompts/02-casos-de-erro.md`](../prompts/02-casos-de-erro.md) · Testes: [`test/integracao/erros.test.js`](../test/integracao/erros.test.js)

| ID | Dependência | Modo de falha | Esperado no Envios | Chamadas na dependência | Regra | Origem |
| --- | --- | --- | --- | --- | --- | --- |
| ER-01 | Consentimento | fora do ar | 503 `DEPENDENCIA_INDISPONIVEL` + `Retry-After` | Provedor: 0 | R1 | v1 (vago) → v2 |
| ER-02 | Consentimento | lento (> timeout) | 503 em menos de 3× o timeout | Provedor: 0 | R1 | pergunta |
| ER-03 | Consentimento | 500 | 503 | Provedor: 0 | R1 | v2 |
| ER-04 | Consentimento | 200 com HTML no corpo | 503 | Provedor: 0 | R1 | v2 + pergunta |
| ER-05 | Consentimento | 200 com `consentido: "true"` | 503 (nunca vira "sim") | Provedor: 0 | R1 | v2 + pergunta |
| ER-06 | Provedor | 500 → 202 | 202 | 2, mesmo `X-Request-Id` | R3 | v2 |
| ER-07 | Provedor | 503 sempre | 502 `PROVEDOR_INDISPONIVEL` | exatamente 2 | R3 | v2 |
| ER-08 | Provedor | timeout → 202 | 202 | 2, mesmo `X-Request-Id` | R3 | v2 |
| ER-09 | Provedor | 429 + `Retry-After: 60` | 503 `PROVEDOR_LIMITADO`, `Retry-After: 60` | 1 (não repete) | R4 | v2 |
| ER-10 | Provedor | 400 | 502 `PROVEDOR_REJEITOU` | 1 (não repete) | R5 | v2 |
| ER-11 | Provedor | 500, 500 e depois 202 com a mesma chave | 502 e depois 202 (sem replay) | 3 | R2 | v2 |
| ER-12 | Consentimento | `consentido=false` 2× com a mesma chave | 422 e replay do 422 | Consentimento: 1 | R2 | pergunta |
| ER-13 | Provedor | conexão derrubada → 202 | 202 | 2 | R3 | v2 |
| ER-14 | Provedor | 202 sem `idMensagem` | 502 | — | rastreabilidade | pergunta |

## Prompt 3 — Contrato dirigido pelo consumidor

Prompt: [`prompts/03-contrato-api.md`](../prompts/03-contrato-api.md) · Contrato: [`contratos/envios-consentimento.json`](../contratos/envios-consentimento.json) · Testes: [`test/integracao/contrato.test.js`](../test/integracao/contrato.test.js)

Cada interação é verificada duas vezes: no **provedor** (o Consentimento real, no estado pedido, responde o prometido) e no **consumidor** (o Envios, recebendo o exemplo, reage como esperado).

| ID | Interação | Resposta mínima | Efeito no Envios | Origem |
| --- | --- | --- | --- | --- |
| CT-01 | opt-in no canal | 200 `consentido: true` | 202 | v2 |
| CT-02 | opt-out no canal | 200 `consentido: false` | 422 | v2 |
| CT-03 | sem registro | 404 | 422 | v2 |
| CT-04 | opt-in só em outro canal | 404 | 422 | v2 (inferido do código) |
| CT-05 | resposta com campos extras | 200 + campos desconhecidos | 202 (*tolerant reader*) | v2 |

## Descartados

| Caso sugerido | Prompt/versão | Por que foi descartado |
| --- | --- | --- |
| `GET /mensagens/{id}`, paginação, `DELETE` | P1 v1 | Endpoints inexistentes |
| 401 sem JWT | P1 v1 | Requisito inexistente |
| Teste de carga a 1000 req/s | P1 v1 | Teste de desempenho, não de integração |
| DDI estrangeiro deve ser rejeitado | P1 v2 | A própria LLM marcou como `SUPOSIÇÃO:`; a regra não existe |
| Repetir a consulta ao Consentimento 3× e devolver 504 | P2 v2 | Comportamento inventado; virou pergunta na v3 e foi decidido o oposto (ER-02) |
| Aguardar `Retry-After` do Consentimento e repetir | P2 v2 | Idem |
| 202 sem `idMensagem` → aceitar com `null` | P2 v2 | Contradiz rastreabilidade; virou pergunta e foi decidido 502 (ER-14) |
| `additionalProperties: false` e todos os campos `required` | P3 v1 | Contrato frágil: quebraria por mudanças que não afetam o consumidor |
