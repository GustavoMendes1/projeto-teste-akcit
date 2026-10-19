# Reflexão: o que cada tipo de prompt trouxe

## Números

| | Prompt 1 — cenários | Prompt 2 — falhas | Prompt 3 — contrato |
| --- | --- | --- | --- |
| Casos sugeridos na v1 | 12 | 15 | 1 OpenAPI completo |
| Aproveitados da v1 | 2 | ~4 (vagos) | 0 (sobre-especificado) |
| Casos na versão final | 9 | 14 (9 + 5 vindos de perguntas) | 4 interações + 1 teste extra |
| Versões até ficar útil | 2 | 3 | 2 |

Suíte final: **32 testes, todos passando** (`npm test`, ~1 s).

## Os testes pegam defeitos reais?

Para não confiar só no "passou", injetei 6 defeitos típicos de integração no Serviço de Envios e rodei a suíte contra cada um (`npm run test:mutacao`):

| Defeito injetado | Pego por | Origem do caso que pegou |
| --- | --- | --- |
| M1 aceitar `consentido` não booleano | ER-05 | P2 v2 + pergunta da v3 |
| M2 *fail-open*: erro de rede vira "consentido" | ER-01, ER-02 | P2 v2 |
| M3 memorizar a chave só depois de terminar (corrida) | **só** CI-07 | P1 v2 |
| M4 `X-Request-Id` diferente a cada tentativa | CI-01, ER-06, ER-08 | P1 v2 / P2 v2 |
| M5 não codificar o `+` do telefone | CI-05, CT-01…CT-04 | P1 v2 / P3 v2 |
| M6 repetir também em 429 | ER-09 | P2 v2 |

**Dos 6 defeitos, só M2 seria pego por um caso da v1** (o vago "consentimento fora do ar → deve retornar erro", do P2 v1). Os casos da v1 verificavam apenas o status HTTP do caminho feliz e de validações; os outros 5 defeitos devolvem exatamente esse status. M1 e M3 são os mais graves (enviar mensagem sem consentimento; enviar em duplicidade) e cada um foi pego por um único teste, que só apareceu depois do ajuste do prompt.

## Como cada tipo de prompt influenciou qualidade e diversidade

**Cenários (P1)** trouxe *amplitude de fluxo*: caminho feliz, opt-out, ausência de registro, canal, idempotência. A diversidade só ficou útil quando eu defini o que conta como integração e exigi um oráculo na dependência — antes disso a diversidade era "falsa" (12 casos, 5 deles unitários e 3 sobre endpoints inexistentes).

**Matriz de falhas (P2)** trouxe *profundidade nas fronteiras*. Por ser sistemática (dependência × modo), achou casos que eu não teria listado — corpo HTML de proxy com 200, conexão derrubada, `"true"` como string. Em compensação, foi o tipo que **mais alucinou comportamento**, porque a matriz tem células que as regras não cobrem e a LLM preenche o vazio com confiança.

**Contrato (P3)** trouxe *precisão*: em vez de mais casos, menos e mais exatos. Foi o único em que dar **código** em vez de descrição mudou a saída de forma radical — de um OpenAPI completo para um contrato com um único campo obrigatório.

Os três se complementam: só P1 pegou a corrida (M3), só P2 pegou o *fail-open* (M2) e o tipo errado (M1), e P3 é o que protege a integração contra mudanças no *outro* time.

## Ajustes de prompt que mais pesaram

1. **Contrato real no contexto** (bloco comum versionado em [`prompts/00-contexto-comum.md`](../prompts/00-contexto-comum.md)). Sem ele, a LLM testa uma API imaginária.
2. **Exigir oráculo na dependência.** "O provedor foi chamado N vezes com X" é o que torna o teste de integração diferente de um teste de API isolada.
3. **Nomear a técnica** (matriz de falhas, *consumer-driven contract*) em vez de pedir "casos de erro" ou "um contrato".
4. **Proibir a invenção de comportamento e pedir perguntas.** Converteu alucinação em pendências de requisito — 4 perguntas que viraram decisões explícitas e 5 testes.
5. **Rastreabilidade por regra (R1–R5).** Torna lacunas visíveis: deu para ver de imediato que faltava R2 com corpo diferente.

## Limites e cuidados

- A LLM foi **inconsistente entre prompts**: P1 apontou que o `+` precisa ser `%2B` (CI-05) e P3 escreveu o caminho com `+` cru. Revisão humana continua obrigatória.
- Os casos gerados codificam uma interpretação dos requisitos. As decisões das "perguntas para o time" (ex.: memorizar o 422) foram tomadas por mim neste exercício; num time real seriam do PO/arquitetura.
- A checagem de mutação é manual e pequena (6 mutantes); serve como evidência, não como medida de cobertura.
- O provedor é um dublê. O teste contra o provedor real (sandbox) fica para um estágio posterior do pipeline.

## GenAI como copiloto

O papel que funcionou melhor não foi "gerar os testes", e sim **varrer o espaço de casos e levantar perguntas**. A parte de alto valor humano continuou sendo: definir as regras, decidir os comportamentos ambíguos e escolher o oráculo. Um bom prompt de teste de integração se parece mais com uma especificação do que com um pedido.
