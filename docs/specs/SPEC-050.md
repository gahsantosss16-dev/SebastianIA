# SPEC-050 — Remote Cognitive Provider and Conversational Fallback

## 1. Status

Implementada, aguardando homologação.

## 2. Objetivo

Permitir que o perfil online consulte o Gemini por HTTPS somente quando o fluxo conversacional determinístico sinalizar estruturalmente que não reconheceu a mensagem. Toda decisão conhecida permanece local. Toda falha remota preserva o fallback determinístico anterior.

## 3. Extensão cognitiva retrocompatível

`CognitiveModelProvider` mantém `decide(request)` e recebe o método opcional `respond(request)`. A requisição conversacional contém somente `text` e `requestedAt`. O resultado é uma união fechada: `responded`, `unavailable`, `timeout` ou `invalidResponse`.

`OllamaCognitiveModelProvider` permanece inalterado e não precisa implementar `respond()`.

## 4. Seleção do fallback

`DevelopmentModelProvider` marca somente sua resposta final de entrada não reconhecida com `cognitiveFallbackEligible: true`. O Agent nunca compara texto para descobrir o fallback e nunca consulta cognição remota para decisões determinísticas conhecidas.

Uma resposta remota aceita torna-se exclusivamente `{ intent: "respond", answer }`. Ela não pode se converter em Tool, plano, objetivo ou autorização.

## 5. Gemini

`GeminiCognitiveModelProvider` usa `fetch` nativo contra o endpoint HTTPS oficial `generateContent`, autenticado pelo header `x-goog-api-key`. Não há SDK ou dependência de runtime nova.

O request de conversa envia apenas uma instrução de resposta segura e `{ text, requestedAt }`. Structured output solicita JSON segundo o schema `{ answer: string }`, que é novamente validado localmente. Envelope, conteúdo e resposta possuem limites próprios.

O método `decide()` continua disponível para o contrato da SPEC-048, mas sua projeção remota exclui memória, arquivos, observações e descrições de Tools. Decisões continuam passando pelo `GoalExecutionOrchestrator`, pelo schema cognitivo e pelas políticas determinísticas existentes.

## 6. Falhas e timeout

O timeout padrão é 8 segundos, sempre inferior ao limite HTTP de 15 segundos, e aborta o `fetch` por `AbortController`. Não há retry automático.

DNS, TLS, rejeição do fetch, HTTP 401/403/429/5xx, envelope inválido, JSON inválido, schema inválido, conteúdo vazio ou excessivo viram resultados fechados. Nenhuma dessas falhas derruba `/api/converse`; o Agent retorna a resposta determinística original.

## 7. Configuração

- `SEBASTIAN_COGNITIVE_PROVIDER=gemini`
- `SEBASTIAN_COGNITIVE_API_KEY`
- `SEBASTIAN_COGNITIVE_MODEL`
- `SEBASTIAN_COGNITIVE_TIMEOUT_MS` (opcional; padrão `8000`, sempre menor que `15000`)

Sem configuração, ou com provider explicitamente `disabled`/`none`, o comportamento permanece determinístico. Configuração parcial ou desconhecida falha no startup com mensagem genérica, sem expor valores.

## 8. Segurança

- API key vive somente no adapter e somente no header remoto;
- `SEBASTIAN_API_TOKEN`, headers HTTP e `process.env` nunca entram no request cognitivo;
- prompt completo, mensagem completa e body bruto não são logados;
- nenhuma memória, arquivo, Git, comando ou implementação/descrição de Tool é enviada ao Gemini;
- `RestrictedOnlineTool` permanece a fronteira online e rejeita todas as Tools;
- CLI não cria nem injeta provider remoto;
- nenhuma resposta conversacional remota carrega autoridade.

## 9. Fora do escopo

Memória externa, interface, SDK Gemini, retry, streaming, billing, chamada real durante testes, habilitação de Tools, mudança do contrato HTTP, deploy e qualquer alteração do CLI.

## 10. Homologação

- fluxo determinístico conhecido não consulta Gemini;
- fluxo desconhecido consulta `respond()` e aceita `{ answer }` válido;
- indisponibilidade, timeout e resposta inválida preservam o fallback anterior;
- segredo fica fora de body, log, resposta e contexto;
- pedidos sensíveis continuam contidos pela composição online;
- suíte inteira, typecheck, build e diff-check permanecem verdes;
- nenhum teste usa internet ou consome API real.
