# Rascunho do post para o fórum

> Texto para colar no fórum da Unidade III. Não faz parte da documentação técnica.

---

Repositório: https://github.com/GustavoMendes1/projeto-teste-akcit

Cenário: integração REST entre um Serviço de Envios de mensagens (WhatsApp/RCS), um Serviço de Consentimento (LGPD/opt-in) e um provedor externo de mensagens. Regra central: sem consentimento confirmado, nenhuma mensagem é enviada, mesmo que o Serviço de Consentimento esteja fora do ar.

1. Tipos de prompt utilizados

Prompt para geração de cenários de integração (papel + contexto + formato de saída): forneci o contrato dos três serviços e as regras de negócio e pedi cenários para o endpoint POST /envios. Cada cenário devia ter um resultado verificável no serviço vizinho, como "o provedor foi chamado uma vez com este corpo" ou "o provedor não foi chamado".

Prompt para geração de casos de erro (matriz dependência × modo de falha): pedi que a LLM aplicasse a cada dependência os modos fora do ar, timeout, 5xx, 4xx, 429, resposta fora do contrato e conexão derrubada. Para cada combinação, ela devia indicar o comportamento esperado e o número de chamadas à dependência. Como extra, usei um terceiro prompt para gerar um contrato dirigido pelo consumidor a partir do código do Serviço de Envios.

2. Casos de teste gerados

Caso	Resultado esperado
Envio com consentimento válido	HTTP 202 e provedor chamado uma única vez
Telefone sem consentimento (opt-out ou sem registro)	HTTP 422 e provedor não chamado
Mesma Idempotency-Key em 5 requisições simultâneas	Um único envio ao provedor
Mesma Idempotency-Key com corpo diferente	HTTP 409
Serviço de Consentimento fora do ar ou lento	HTTP 503 e nenhuma mensagem enviada
Consentimento responde "consentido": "true" (texto)	HTTP 503, sem tratar como autorizado
Provedor falha com 5xx e depois aceita	Nova tentativa com o mesmo X-Request-Id
Provedor responde 429	HTTP 503, repassa Retry-After, sem nova tentativa

Ao todo foram 32 testes automatizados, todos aprovados.

3. Análise dos resultados

O prompt de cenários ajudou a estruturar os fluxos principais da integração, como consentimento por canal e idempotência. O prompt de erros ampliou a diversidade nas fronteiras entre os serviços e trouxe casos que eu não teria listado, como uma resposta 200 com HTML de proxy no corpo.

Nas primeiras versões, sem contexto, a LLM inventou endpoints e autenticação que não existem e gerou testes que só verificavam o status HTTP. Foi necessário colar o contrato real da API, definir o que conta como teste de integração e exigir que cada caso verificasse a chamada à dependência. No prompt de erros, a LLM também inventou comportamentos que as regras não definiam, como "repetir 3 vezes e devolver 504". Por isso acrescentei uma instrução: quando a regra não define o comportamento, a LLM deve fazer uma pergunta em vez de supor. Saíram 4 perguntas, que se tornaram decisões explícitas e novos testes.

Para validar a utilidade dos testes, introduzi 6 defeitos de integração no código. A suíte final detectou todos, enquanto os casos da primeira versão detectariam apenas um.

Concluo que a GenAI funciona bem como copiloto para explorar cenários e levantar dúvidas sobre os requisitos. Definir as regras, decidir os casos ambíguos e revisar os testes gerados continua sendo trabalho humano.
