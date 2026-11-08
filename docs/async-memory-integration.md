# Integração assíncrona da memória — driver file

Base: `008889d`, branch `codex/sebastian-persistent-memory`.

## Consumidores auditados

| Consumidor | Integração concluída |
| --- | --- |
| `FileCommandContextHydrator` | `AsyncMemoryStore`; hidratação e histórico aguardam leituras |
| `FileCommandResultMemoryWriter` | `AsyncMemoryStore`; `recorded` somente após a escrita; rejeições viram falha tipada |
| `ConversationRegistry` | criação, consultas, atividade, título e registro do histórico legado aguardados |
| `ProjectConversationContext` | seleção, regras e auditoria aguardadas; erros de persistência propagados |
| `ProjectTaskOrchestrator` | consulta e transições persistidas antes de retornar cada resposta |
| `KnowledgeStore`, ingestão e busca | fontes, chunks, deduplicação e resultados assíncronos |
| `KnowledgeSearchTool` e sondagem cognitiva | relevância aguardada; loops sequenciais preservam seleção e ambiguidade |
| Agente e handlers HTTP | aguardam projetos, tarefas, registro e histórico antes de responder |
| Bootstrap, configuração e entrada HTTP | composição explícita com `AsyncFileMemoryStore` |
| `SebastianCore` | já aguardava as duas fronteiras em `008889d`; comportamento validado de ponta a ponta |

Nenhum consumidor de persistência file permanece pendente. `FileMemoryStore` continua sendo a implementação síncrona interna do adaptador assíncrono, preservando formato JSON, namespaces, reabertura e escrita por arquivo temporário/rename. Os adaptadores puramente em memória permanecem compatíveis com os contratos existentes; `MemoryManager` já era assíncrono.

## Verificação e limites

- `npm run typecheck` e `npm run build` aprovados.
- Suíte completa final (`npm test`): 1.004 testes aprovados, zero falhas, zero cancelados e zero ignorados (135,5 s).
- Execução direcionada de memória, conhecimento e contexto de projetos: 61 testes aprovados, zero falhas.
- Regressões adicionais usam o driver file real: escrita suspensa por uma barreira de agendamento, reabertura independente, falha real de disco, corrupção e respostas HTTP de erro. A barreira não substitui a persistência.
- Helpers de teste aguardam as operações antes de remover diretórios temporários; verificações funcionais preservadas, com `assert.rejects` para contratos agora assíncronos.
- O conector Supabase, exclusivamente na conta SebastianIA, retornou `ACTIVE_HEALTHY` para `smtyixukyexezjumouvw` (PostgreSQL 17.11). Consulta somente de metadados; nenhum dado, credencial ou migration acessado.
- Conexão PostgreSQL e composição operacional desse driver ficam para a próxima etapa. Nenhuma migração de memória executada. Esta integração local não depende de `SEBASTIAN_SUPABASE_DATABASE_URL`.
- Nenhuma mudança em main, Hostinger, Video AI ou EDIT IA PRO.

## Arquivos desta alteração

- `application/OnlineSebastianApplication.ts`
- `application/ProjectConfiguration.ts`
- `application/SebastianHttpServer.ts`
- `application/http.ts`
- `core/CorePipelineBootstrap.ts`
- `core/agent/InMemorySpecializedAgent.ts`
- `core/cognition/CognitiveOperationalOrchestrator.ts`
- `core/knowledge/KnowledgeIngestion.ts`
- `core/knowledge/KnowledgeRetrieval.ts`
- `core/knowledge/KnowledgeSearchTool.ts`
- `core/knowledge/KnowledgeStore.ts`
- `core/memory/ConversationRegistry.ts`
- `core/memory/FileCommandContextHydrator.ts`
- `core/memory/FileCommandResultMemoryWriter.ts`
- `core/project/ProjectConversationContext.ts`
- `core/project/ProjectTaskOrchestrator.ts`
- `docs/async-memory-integration.md`
- `tests/agent/InMemorySpecializedAgentProjectPipeline.test.ts`
- `tests/application/KnowledgeCognitive.integration.test.ts`
- `tests/application/SebastianHttpServer.test.ts`
- `tests/cognition/CognitiveOperationalOrchestratorBroadCapability.test.ts`
- `tests/core/CorePipelineBootstrap.test.ts`
- `tests/knowledge/KnowledgeIngestion.test.ts`
- `tests/knowledge/KnowledgeRetrieval.test.ts`
- `tests/knowledge/KnowledgeSearchTool.test.ts`
- `tests/memory/AsyncMemoryIntegration.test.ts`
- `tests/memory/ConversationRegistry.test.ts`
- `tests/memory/FileCommandContextHydrator.test.ts`
- `tests/memory/FileCommandResultMemoryWriter.test.ts`
- `tests/project/ProjectConversationContext.test.ts`
- `tests/project/ProjectTaskOrchestrator.test.ts`
