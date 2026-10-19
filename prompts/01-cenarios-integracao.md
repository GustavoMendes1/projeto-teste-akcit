# Prompt 1 — Geração de cenários de integração

**Tipo:** prompt de papel + contexto + formato de saída estruturado (*role + context + output schema*).
**Objetivo:** obter os fluxos ponta a ponta que atravessam Envios → Consentimento → Provedor, cada um com um oráculo verificável **no componente vizinho**, não só no status HTTP.
**Modelo:** Claude Opus 5.5 (via Claude Code), 18/10/2026.
**Testes resultantes:** [`test/integracao/cenarios.test.js`](../test/integracao/cenarios.test.js) — catálogo em [`docs/casos-gerados.md`](../docs/casos-gerados.md#prompt-1--cenários-de-integração).

---

## v1 — prompt ingênuo

```text
Gere casos de teste de integração para uma API REST de envio de mensagens por WhatsApp.
```

### O que voltou (resumo)

12 casos genéricos. Os problemas:

| Problema | Exemplo da saída |
| --- | --- |
| Endpoints inventados | `GET /mensagens/{id}`, `GET /mensagens?page=2`, `DELETE /mensagens/{id}` — nenhum existe |
| Requisitos inventados | "deve retornar 401 sem token JWT" — a API não tem autenticação nesse escopo |
| Na verdade são testes unitários | 5 dos 12 eram validação de campo (`telefone vazio → 400`), que não atravessam nenhuma integração |
| Oráculo fraco | Quase todos verificavam só o status (`deve retornar 201`). Nenhum verificava se o provedor foi ou não chamado |
| Fora de escopo | "teste de carga com 1000 requisições/s" |

**Aproveitado:** 2 de 12 (caminho feliz e "mensagem para número sem opt-in", que virou CI-02).

---

## v2 — prompt ajustado

```text
Você é um engenheiro de QA sênior especializado em testes de integração entre microsserviços.

<cole aqui o bloco de prompts/00-contexto-comum.md>

## Tarefa
Liste cenários de teste de INTEGRAÇÃO para o Serviço de Envios.

Um cenário só é de integração se o resultado depende da interação com o
Consentimento e/ou o Provedor. Validação de campo isolada NÃO conta — agrupe
todas as validações em um único cenário que verifique apenas que nenhuma
dependência foi chamada.

## Regras
- Use SOMENTE os endpoints, campos e códigos listados acima. Não invente autenticação,
  paginação ou endpoints.
- Cada cenário precisa de um oráculo observável em uma dependência, por exemplo:
  "o provedor recebeu exatamente 1 chamada com corpo {...}" ou "o provedor NÃO foi chamado".
- Cubra cada regra R1–R5 pelo menos uma vez e diga qual regra cada cenário cobre.
- Inclua pelo menos um cenário de concorrência e um sobre como dados atravessam a fronteira
  (codificação, nomes de campos diferentes entre os serviços).
- Se precisar assumir algo que não está no contexto, escreva "SUPOSIÇÃO:" no cenário.

## Formato
Tabela Markdown com as colunas:
ID | Regra | Pré-condição (estado das dependências) | Ação | Resultado esperado no SUT | Oráculo na dependência
```

### O que voltou (resumo)

10 cenários, todos usando apenas a API real. Ganhos em relação à v1:

- **Oráculo na dependência em 100% dos casos** — "provedor não foi chamado" passou a ser a asserção principal de CI-02, CI-03 e CI-09.
- **Concorrência (CI-07):** 5 requisições simultâneas com a mesma chave → 1 único envio. Esse caso pegou um defeito real de implementação na checagem de mutação (ver [`docs/reflexao.md`](../docs/reflexao.md)).
- **Mapeamento entre serviços (CI-01):** verificar que `telefone`/`mensagem` viram `destino`/`texto` no provedor — exatamente o tipo de erro que só aparece em integração.
- **Codificação na fronteira (CI-05):** o `+` do E.164 precisa chegar como `%2B` no path do Consentimento.
- **Consentimento por canal (CI-04)** — não estava no pedido, a LLM inferiu do formato `?canal=`.

**Descartado:** 1 cenário ("telefone com DDI de outro país deve ser rejeitado") — marcado como `SUPOSIÇÃO:` pela própria LLM, e a regra não existe. A marcação explícita tornou o descarte trivial.

---

## Ajustes que fizeram diferença

1. **Colar o contrato real** (bloco comum). Sozinho eliminou os endpoints e a autenticação inventados.
2. **Definir o que é "integração"** e mandar agrupar validações num caso só — reduziu ruído de 5 casos unitários para 1.
3. **Exigir oráculo na dependência** — mudou a natureza dos casos de "retorna 202" para "o provedor recebeu X".
4. **Pedir rastreabilidade por regra (R1–R5)** — expôs lacunas de cobertura na hora: a primeira saída da v2 não cobria R2 com corpo diferente; pedi complemento e veio o CI-08.
5. **`SUPOSIÇÃO:`** — a LLM continua inventando às vezes, mas agora avisa.
