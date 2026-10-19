# Bloco de contexto comum

Todos os prompts **ajustados** (v2 em diante) começam colando este bloco. Ele foi a mudança que mais melhorou os resultados: sem ele a LLM inventa endpoints, autenticação e campos que não existem.

```text
## Sistema sob teste
Três componentes se comunicam por HTTP/JSON:

1. Serviço de Envios (SUT — é ele que estamos testando)
   POST /envios
     Cabeçalho obrigatório: Idempotency-Key (string até 128 caracteres)
     Corpo: { "telefone": "+5562999990001", "canal": "whatsapp" | "rcs", "mensagem": "texto (1..1000)" }
     Respostas:
       202 { id, status: "ACEITO", idMensagemProvedor }
       400 IDEMPOTENCY_KEY_AUSENTE | PAYLOAD_INVALIDO | JSON_INVALIDO
       409 IDEMPOTENCY_KEY_CONFLITO
       422 CONSENTIMENTO_AUSENTE
       502 PROVEDOR_INDISPONIVEL | PROVEDOR_REJEITOU
       503 DEPENDENCIA_INDISPONIVEL (dependencia: "consentimento") | PROVEDOR_LIMITADO (+ Retry-After)

2. Serviço de Consentimento (real, interno)
   GET /consentimentos/{telefone codificado}?canal=whatsapp|rcs
     200 { telefone, canal, consentido: boolean, atualizadoEm }
     404 { erro: "CONSENTIMENTO_NAO_ENCONTRADO" }

3. Provedor de mensagens (externo, pago — nos testes é um dublê programável)
   POST /mensagens  { destino, canal, texto }  cabeçalho X-Request-Id
     202 { idMensagem }

## Regras de negócio (prioridade: consentimento > entrega > rastreabilidade)
R1. Sem consentimento confirmado nada é enviado. Falha do Consentimento => 503, provedor NÃO é chamado (fail-closed).
R2. Mesma Idempotency-Key + mesmo corpo => mesma resposta, sem novo envio. Corpo diferente => 409.
    Falhas transitórias (502 PROVEDOR_INDISPONIVEL, 503) não são memorizadas.
R3. Falha transitória do provedor (5xx, timeout, conexão caída) é repetida até 2 vezes com o MESMO X-Request-Id.
R4. 429 do provedor não é repetido: 503 PROVEDOR_LIMITADO repassando Retry-After.
R5. 4xx do provedor (exceto 429) é definitivo: 502 PROVEDOR_REJEITOU, sem repetir.

## Ambiente de teste
- Consentimento e Envios sobem de verdade em portas efêmeras.
- O provedor é um servidor falso que aceita uma fila de respostas programadas
  ({status, corpo, cabecalhos, atrasoMs, destruirConexao}) e registra cada chamada recebida.
- Timeout de chamadas a dependências: 300 ms.
```

**Por que um bloco separado:** o mesmo contexto alimenta os três tipos de prompt, então fica versionado uma vez só e qualquer mudança na API (ex.: novo código de erro) é feita aqui e reaproveitada.
