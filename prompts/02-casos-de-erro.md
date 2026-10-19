# Prompt 2 — Casos de erro e falhas de dependência

**Tipo:** prompt guiado por técnica (matriz *dependência × modo de falha*) + instrução de não inventar comportamento.
**Objetivo:** cobrir o que acontece quando o Consentimento ou o Provedor falham, demoram ou respondem fora do contrato.
**Modelo:** Claude Opus 5.5 (via Claude Code), 18/10/2026.
**Testes resultantes:** [`test/integracao/erros.test.js`](../test/integracao/erros.test.js) — catálogo em [`docs/casos-gerados.md`](../docs/casos-gerados.md#prompt-2--falhas-de-dependência).

---

## v1 — prompt ingênuo

```text
Liste casos de erro para testar essa API.
<contexto comum colado>
```

### O que voltou (resumo)

15 casos, mas **11 eram erros de entrada** (telefone sem `+`, canal `sms`, mensagem vazia, JSON quebrado, mensagem com 1001 caracteres…). Só 4 falavam de dependências, e de forma vaga ("o serviço de consentimento está fora do ar → deve retornar erro").

"Erro" foi interpretado como "erro do cliente". O contexto estava lá, mas a pergunta não apontava para as fronteiras.

---

## v2 — matriz de falhas

```text
Você é um engenheiro de confiabilidade testando a resiliência de uma integração.

<contexto comum colado>

## Tarefa
Monte uma matriz DEPENDÊNCIA × MODO DE FALHA para o Serviço de Envios.

Dependências: Consentimento, Provedor.
Modos de falha (aplique todos a cada dependência):
  1. fora do ar (conexão recusada)
  2. lento (responde depois do timeout de 300 ms)
  3. 5xx
  4. 4xx de negócio
  5. 429 com Retry-After
  6. 200 com corpo fora do contrato (não-JSON, campo ausente, tipo errado)
  7. conexão derrubada no meio da resposta
  8. falha seguida de sucesso (transitória)

Para cada célula: resultado esperado no SUT, quantas chamadas a dependência deve
receber e qual regra (R1–R5) justifica. Ignore erros de validação de entrada.

Formato: tabela ID | Dependência | Modo | Resultado no SUT | Nº de chamadas | Regra
```

### O que voltou (resumo)

16 células. A cobertura de fronteira ficou muito melhor — surgiram os casos de **contrato violado** (ER-04 corpo HTML de proxy, ER-05 `consentido: "true"` como string) e de **conexão derrubada** (ER-13), que não apareciam de jeito nenhum na v1.

**Problema novo:** para as células que as regras não cobriam, a LLM **inventou comportamento com confiança**:

- "Consentimento lento → repetir a consulta 3 vezes e então 504" — não há regra de retry para o Consentimento, e 504 não existe na API.
- "Consentimento 429 → aguardar Retry-After e repetir" — idem.
- "Provedor 202 sem `idMensagem` → aceitar e registrar `idMensagemProvedor: null`" — contradiz rastreabilidade.

Esses casos *pareciam* corretos e teriam virado testes que codificam um requisito que ninguém definiu.

---

## v3 — explicitar o que fazer quando a especificação é omissa

Acrescentado ao final do prompt v2:

```text
## Quando as regras não definem o comportamento
NÃO invente o resultado esperado. Em vez disso, coloque a célula numa seção separada
"Perguntas para o time", com:
  - a pergunta,
  - 2 opções de comportamento,
  - qual regra de prioridade (consentimento > entrega > rastreabilidade) favorece cada opção.
Células com comportamento definido pelas regras continuam na tabela principal.
```

### O que voltou (resumo)

Tabela principal com 9 casos sustentados pelas regras, mais **4 perguntas para o time**. As respostas viraram decisões e, depois, mais 5 testes (14 no total):

| Pergunta levantada pela LLM | Decisão tomada | Teste |
| --- | --- | --- |
| Repetir a consulta ao Consentimento em timeout? | Não. Falha rápida com 503 + `Retry-After`; quem repete é o cliente (R1 prevalece sobre latência) | ER-02 |
| 200 com `consentido` não booleano: tratar como `false` (422) ou como dependência quebrada (503)? | 503. Um 422 diria ao cliente "sem consentimento", que é uma afirmação falsa sobre o titular | ER-04, ER-05 |
| Resultado 422 deve ser memorizado pela Idempotency-Key? | Sim, é definitivo para aquela chave; se o titular der opt-in depois, o cliente usa uma chave nova | ER-12 |
| Provedor 202 sem `idMensagem`? | 502. Sem id do provedor não há rastreabilidade, então não reportamos `ACEITO` | ER-14 |

---

## Ajustes que fizeram diferença

1. **Nomear a técnica** (matriz dependência × modo de falha) em vez de pedir "casos de erro". A LLM passou a varrer o espaço de forma sistemática em vez de listar o que vem à cabeça.
2. **Excluir validação de entrada explicitamente** — o termo "erro" puxa para o óbvio.
3. **Proibir a invenção de comportamento e pedir perguntas** (v3). Foi o ajuste mais importante deste prompt: transformou alucinação em lista de pendências de requisito.
4. **Pedir o número de chamadas esperado na dependência** — é o que diferencia "repetiu 2x" de "repetiu 3x" (ER-07) e "não repetiu 429" (ER-09).
