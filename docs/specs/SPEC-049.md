# SPEC-049 — Sebastian Online Foundation

## 1. Status

Implementada e homologada.

## 2. Objetivo

Adicionar uma camada HTTP privada e mínima ao Sebastian IA, sem substituir ou duplicar sua arquitetura existente. O transporte online encaminha mensagens à mesma `SebastianApplication`, ao mesmo `Agent` e ao mesmo fluxo determinístico já homologado.

```text
HTTP → transporte online → SebastianApplication → Core / Agent / arquitetura existente
```

## 3. Escopo entregue

- servidor persistente baseado exclusivamente em `node:http`;
- `GET /health` público e sem detalhes internos;
- `POST /api/converse` privado;
- autenticação Bearer por `SEBASTIAN_API_TOKEN`;
- porta por `process.env.PORT`, com fallback `3000`;
- uma única `SebastianApplication` por processo;
- composição online explicitamente restrita e fail-closed;
- limites de corpo, mensagem, tempo e concorrência;
- respostas públicas sanitizadas;
- shutdown gracioso em `SIGTERM` e `SIGINT`;
- testes do transporte, autenticação, lifecycle e fronteira de segurança.

## 4. Preservação da arquitetura homologada

O comportamento default de `createSebastianApplication()` permanece local e inalterado. O CLI continua usando `LocalCommandInvocationAdapter`, inclusive sua memória em arquivo e suas Tools locais homologadas.

A única seam acrescentada à composição é `specializedTool?`. Quando omitida, `CorePipelineBootstrap` constrói exatamente o mesmo `LocalToolDispatcher` anterior. A composição online fornece explicitamente `RestrictedOnlineTool`, que não conhece nem instancia adapters de filesystem, Git ou comandos.

`CognitiveModelProvider` permanece opcional. A composição online desta SPEC não configura provider cognitivo, não chama modelo, não depende de Ollama e não altera a SPEC-048.

## 5. Fronteira de segurança online

`RestrictedOnlineTool` é a fronteira fail-closed. Toda invocação de Tool termina em uma rejeição sem efeito local. Portanto, mesmo que o `DevelopmentModelProvider` interprete uma mensagem como `useTool`, `developTask`, `pursueGoal` ou `writeAuthorized`, o perfil online não possui um adapter capaz de:

- ler, criar, anexar ou editar arquivos;
- consultar status ou diff Git;
- executar testes, build ou typecheck;
- executar comandos;
- iniciar auto-correção com efeitos no workspace.

A segurança não depende de filtrar palavras da mensagem. A autenticação e a ausência estrutural de adapters sensíveis são barreiras independentes.

## 6. Contrato HTTP

### `GET /health`

Resposta `200`:

```json
{"status":"ok"}
```

Não retorna versão, paths, recursos do host, configuração, memória, Tools ou informações Git.

### `POST /api/converse`

Requer:

```http
Authorization: Bearer <SEBASTIAN_API_TOKEN>
Content-Type: application/json
```

Request:

```json
{"message":"Quais são minhas tarefas?"}
```

Resposta pública:

```json
{"ok":true,"message":"Você não tem nenhuma tarefa pendente.","requestId":"..."}
```

O transporte cria internamente um comando `converse` e chama `SebastianApplication.executeCommand()`. Somente `output.message` é projetado para HTTP; o `CapabilityResult` interno nunca é serializado integralmente.

Erros usam códigos HTTP adequados e o envelope:

```json
{"ok":false,"error":{"code":"INVALID_REQUEST","message":"Requisição inválida."},"requestId":"..."}
```

Stacks, mensagens internas, paths, headers, corpo e secrets não são incluídos.

## 7. Limites operacionais

- corpo máximo: 16 KiB;
- mensagem máxima: 4.000 caracteres;
- timeout de recebimento do corpo: 10 segundos;
- timeout de execução: 15 segundos;
- uma conversa em voo por processo;
- requisições concorrentes adicionais recebem `503` e não entram em fila ilimitada;
- keep-alive e headers possuem timeouts explícitos.

O timeout HTTP não cancela magicamente trabalho interno já iniciado. Nesta SPEC, esse risco é contido porque o perfil online não disponibiliza subprocessos nem operações locais sensíveis.

## 8. Lifecycle

O entrypoint `application/http.ts`:

1. valida `SEBASTIAN_API_TOKEN`;
2. resolve `PORT` ou usa `3000`;
3. cria uma única aplicação online;
4. inicia o servidor em `0.0.0.0`;
5. reutiliza a aplicação entre requisições;
6. em `SIGTERM`/`SIGINT`, para de aceitar conexões, fecha o servidor e chama `shutdown()` uma vez.

## 9. Memória e workspace

Esta SPEC não implementa memória externa. A composição online não promete continuidade após restart ou redeploy. O filesystem efêmero da hospedagem também não é tratado como workspace persistente.

Auto-correção online, workspace persistente e adapter externo de memória permanecem fora do escopo.

## 10. Fora do escopo

- interface web;
- login completo ou multiusuário;
- banco ou memória externa;
- LLM/provider remoto;
- execução de Ollama;
- RAG, embeddings, WebSocket, voz ou scheduler;
- deploy automático;
- nova integração GitHub;
- workspace persistente remoto;
- alteração do `hostinger-diagnostic`.

## 11. Homologação objetiva

- CLI e testes anteriores permanecem verdes;
- `/health` responde sem autenticação e sem detalhes internos;
- `/api/converse` rejeita credencial ausente ou inválida;
- uma credencial válida alcança a `SebastianApplication` real;
- conversa determinística existente produz a mesma resposta via HTTP;
- solicitações de criação/edição, validação, Git, diff e auto-correção não alteram arquivos nem alcançam adapters sensíveis;
- secret não aparece em resposta, log ou contexto;
- testes, typecheck e build passam sem dependência de runtime nova.
