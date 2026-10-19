# Prompt 3 — Contrato de API dirigido pelo consumidor

**Tipo:** prompt de extração a partir de código (*code-grounded*) — a LLM recebe o código do consumidor e deriva o contrato do que ele realmente usa.
**Objetivo:** gerar um contrato Envios → Consentimento que possa ser verificado dos dois lados, sem acoplar os serviços a detalhes que o consumidor não usa.
**Modelo:** Claude Opus 5.5 (via Claude Code), 18/10/2026.
**Saída:** [`contratos/envios-consentimento.json`](../contratos/envios-consentimento.json) — testes em [`test/integracao/contrato.test.js`](../test/integracao/contrato.test.js).

> Este é um terceiro tipo, além dos dois pedidos no fórum.

---

## v1 — "gere o contrato"

```text
Gere um contrato OpenAPI 3 para o Serviço de Consentimento.
<contexto comum colado>
```

### O que voltou (resumo)

Um OpenAPI completo e bem formatado — e **sobre-especificado**:

- todos os campos `required`, inclusive `telefone`, `canal` e `atualizadoEm`;
- `atualizadoEm` com `format: date-time` e `telefone` com `pattern` E.164;
- `additionalProperties: false`;
- endpoints extras sugeridos (`PUT /consentimentos/{telefone}`, `DELETE`).

Como contrato de **documentação** é bom. Como contrato de **teste de integração** é frágil: o Consentimento não poderia adicionar um campo (`additionalProperties: false`) nem mudar o formato de `atualizadoEm` sem quebrar o teste — mas o Envios nunca lê esses campos. O teste falharia por mudanças que não afetam ninguém.

---

## v2 — contrato dirigido pelo consumidor

```text
Abaixo está o código do Serviço de Envios (consumidor). Quero um contrato
CONSUMER-DRIVEN para a integração dele com o Serviço de Consentimento.

<cole src/envios/servico.js>
<contexto comum colado>

## Regras
- Liste somente os campos da resposta que o consumidor LÊ no código. Para cada um,
  cite a linha que o lê.
- Campos extras na resposta devem ser permitidos (tolerant reader).
- Cada interação precisa de:
    estado do provedor (quais registros existem),
    requisição exata (método, caminho já codificado, query),
    resposta mínima (status + campos e tipos) e um exemplo,
    efeito esperado no consumidor (status que o Envios devolve).
- Inclua as interações que levam o consumidor a decisões diferentes.

Formato: JSON com { consumidor, provedor, interacoes: [...] }.
```

### O que voltou (resumo)

- Um único campo obrigatório na resposta: `consentido: boolean`, com a citação da linha que o lê. `telefone`, `canal` e `atualizadoEm` ficaram de fora — o código não os usa.
- 4 interações (CT-01 a CT-04), uma para cada decisão do consumidor. A **CT-04** (consentimento existe em *outro* canal) não estava no meu pedido; a LLM a derivou da chave `telefone|canal` vista no código do Consentimento que também estava no contexto.
- Sugeriu o teste CT-05 (campos extras não quebram o consumidor) como consequência do *tolerant reader*.

**Ajuste manual:** a saída usava `"/consentimentos/+5562999990001"` no caminho. Corrigi para `%2B` — o mesmo problema de codificação que o Prompt 1 já tinha apontado (CI-05). Bom lembrete de que a LLM pode ser inconsistente entre prompts.

---

## Ajustes que fizeram diferença

1. **Dar o código do consumidor em vez de descrever a API.** Com o código, a LLM sabe o que é lido; com a descrição, ela especifica tudo.
2. **Pedir a citação da linha** que lê cada campo — força a justificativa e facilita revisar.
3. **Pedir "efeito no consumidor"** em cada interação — permitiu usar o mesmo arquivo para verificar os dois lados (provedor responde certo / consumidor reage certo).
