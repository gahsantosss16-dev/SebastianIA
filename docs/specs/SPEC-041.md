# SPEC-041 - Tarefas Pessoais Persistentes via Linguagem Natural

## 1. Contexto

A SPEC-040 entregou a primeira ação real e perceptível do Sebastian (leitura de filesystem via `fs.listDirectory`/`fs.readFile`), fechando a cadeia `Core → Memory hydration → Capability → Agent → Tool` com um efeito real sobre o mundo. Até ali, porém, a única forma de persistência acionável pelo usuário continuava sendo `remember`/`recall` (SPEC-038) e sua generalização via `converse` (SPEC-039): uma lista plana de fatos em texto livre, sem qualquer noção de estado (pendente/concluído).

O Sebastian já entende (SPEC-039) e já age (SPEC-040), mas não organiza. Não há como pedir para adicionar uma pendência, listar o que falta fazer, ou marcar algo como concluído - a lacuna mais perceptível entre "responde perguntas sobre o que eu disse" e "me ajuda a gerenciar coisas".

## 2. Objetivo

Permitir que o usuário, em linguagem natural via CLI, adicione tarefas, liste as pendentes e as marque como concluídas, com persistência real entre processos separados, reaproveitando integralmente a infraestrutura de Memory já homologada (SPEC-034/035), sem nova Tool, sem escrita em filesystem e sem qualquer custo de API, rede ou credencial.

## 3. Escopo

Entregue como vertical slice único:

- dois novos discriminadores estruturais de registro (`sebastian.memory.task.created`, `sebastian.memory.task.completed`), no mesmo padrão de `MEMORY_FACT_RECORD_KIND` (SPEC-039);
- extensão do `FileCommandContextHydrator` para derivar `pendingTasks` do histórico append-only, preservando integralmente a reconstrução de `rememberedFacts` já existente;
- extensão mínima do `ModelProviderContract`/`DevelopmentModelProvider` com três reconhecimentos determinísticos: adicionar, listar e concluir tarefa;
- extensão do `InMemorySpecializedAgent` para traduzir as novas decisões (`addTask`, `completeTask`) em `finalResult`, pelo mesmo mecanismo genérico já homologado na SPEC-039;
- regra de identificação de tarefa para conclusão por correspondência exata normalizada, com tratamento explícito de ambiguidade e de "não encontrada";
- testes unitários, de integração e por subprocessos reais.

## 4. Fora do Escopo

- prazo, prioridade, categoria, recorrência, lembrete ou notificação;
- edição ou exclusão de tarefas;
- fuzzy matching ou qualquer heurística de correspondência além de igualdade normalizada;
- nova Tool, escrita em filesystem, shell, rede, API paga;
- comandos de histórico/tarefas concluídas (a listagem padrão mostra somente pendentes);
- qualquer alteração de comportamento de `greeting`, `remember`, `recall`, `converse` (fatos), `fs.listDirectory` ou `fs.readFile`.

## 5. Responsabilidade Funcional Única

Fazer o Sebastian organizar pendências do usuário como dados estruturados e persistentes - não apenas lembrar texto solto -, usando exclusivamente a infraestrutura de Memory já homologada, sem introduzir um sistema de persistência paralelo, sem que o Core, a CLI ou a capability `converse` conheçam qualquer regra do domínio de tarefas.

## 6. Modelo de Dados: Tarefas como Registros Estruturados, Append-Only

Uma tarefa nunca é representada como fato textual genérico. Ela é reconstruída a partir de dois tipos de evento persistidos na mesma `command-results` namespace já usada por `remember`/`recall`/`converse`:

- **Criação** (`memoryRecordKind: 'sebastian.memory.task.created'`): `{ content: string }`. A identidade estável da tarefa é o `executionId` do próprio registro de write-back que a criou (`${commandType}:${generatedAt}`) - nunca o texto, e nunca um identificador gerado à parte. O momento de criação é o `resultGeneratedAt` desse mesmo registro.
- **Conclusão** (`memoryRecordKind: 'sebastian.memory.task.completed'`): `{ taskId: string }`, referenciando o `executionId` da criação.

Nenhum registro é reescrito ou apagado para concluir uma tarefa. O estado "pendente" é sempre derivado, nunca armazenado: uma tarefa é pendente se e somente se existe um registro de criação para seu id e não existe nenhum registro de conclusão referenciando esse mesmo id. Isso reutiliza exatamente o mesmo mecanismo que já torna `remember`/`recall` persistente e append-only por construção (cada execução grava um registro nunca sobrescrito, desde que `executionId` seja único por invocação).

## 7. Arquitetura

```
sebastiania "Adiciona uma tarefa: comprar leite"
  → CLI fallback → commandType "converse"
  → Core hidrata contexto (rememberedFacts + pendingTasks)
  → capability "converse" repassa {text}, sem interpretar
  → Agent → DevelopmentModelProvider.interpret() → intent=addTask, content="comprar leite"
  → Agent → finalResult={memoryRecordKind:'sebastian.memory.task.created', content:'comprar leite'}
  → Core adota finalResult → write-back persiste sob commandType="converse"

sebastiania "Quais são minhas tarefas?"
  → novo processo, mesmo roteamento
  → Core hidrata: FileCommandContextHydrator deriva pendingTasks do histórico
  → Agent → DevelopmentModelProvider compõe a resposta a partir de pendingTasks já hidratadas
  → finalResult={message:'Suas tarefas pendentes: comprar leite.'}

sebastiania "Marca 'comprar leite' como feita"
  → novo processo
  → Agent → DevelopmentModelProvider resolve correspondência exata normalizada contra pendingTasks
  → intent=completeTask, taskId=<id da criação>
  → finalResult={memoryRecordKind:'sebastian.memory.task.completed', taskId:<id>}
  → Core adota finalResult → write-back persiste a conclusão (novo registro, criação intocada)

sebastiania "Quais são minhas tarefas?" (novo processo)
  → pendingTasks já não inclui "comprar leite" → {message:'Você não tem nenhuma tarefa pendente.'}
```

Nenhuma Tool é envolvida. Core, CLI e a capability `converse` permanecem inteiramente agnósticos ao domínio de tarefas - a decisão de adicionar, listar ou concluir pertence exclusivamente ao Agent, através do `ModelProvider`.

## 8. `ModelProviderContract`: novas decisões e requisição

```ts
interface ModelInterpretationAddTaskDecision {
  readonly intent: 'addTask';
  readonly content: string;
}

interface ModelInterpretationCompleteTaskDecision {
  readonly intent: 'completeTask';
  readonly taskId: string;
}
```

`ModelInterpretationRequest` ganha `pendingTasks?: readonly PendingTaskRecord[]` (opcional, default vazio), no mesmo espírito de `rememberedFacts`, mas opcional para preservar a compilação e o comportamento de todo chamador pré-existente que não conhece tarefas.

A resolução de "qual tarefa" concluir acontece inteiramente dentro do `ModelProvider` (que já recebe `pendingTasks`): o Agent nunca decide correspondência, apenas executa a decisão já resolvida (`completeTask` com um `taskId` concreto) ou repassa uma resposta amigável (`respond`) para os casos de ambiguidade/não encontrada - reaproveitando a decisão `respond` já homologada, sem introduzir tipos novos para esses casos.

## 9. `DevelopmentModelProvider`: reconhecimento mínimo

Três marcadores determinísticos adicionais:

- `"adiciona uma tarefa"` (+ conteúdo após `:` opcional) → `addTask`; conteúdo vazio cai no fallback genérico, como já ocorre com `"lembra que"`; conteúdo acima de 500 caracteres retorna `respond` com mensagem explícita, nunca cria a tarefa;
- `"marca ... como feita"` (regex simples, sem NLU) → extrai o texto-alvo e resolve contra `pendingTasks` por **igualdade exata após normalização** (trim + case-insensitive, nada além disso): exatamente 1 correspondência → `completeTask`; 0 correspondências → `respond` informando que não encontrou; mais de 1 → `respond` informando ambiguidade, sem concluir nada;
- `"minhas tarefas"` → `respond` com a listagem das pendentes (ou mensagem clara de "nenhuma tarefa pendente"), composta diretamente a partir de `pendingTasks` já hidratadas, limitada a 500 itens exibidos (com nota explícita se houver mais, nunca corte silencioso).

Isso permanece adapter de desenvolvimento, não NLU: um provider real produzirá as mesmas decisões estruturadas (`addTask`, `completeTask`, ou `respond` com a listagem) sem qualquer mudança em Core, Memory, Capability ou Agent.

## 10. `FileCommandContextHydrator`: derivação de `pendingTasks`

Estendido para, na mesma varredura de registros bem-sucedidos já usada para `rememberedFacts`, também coletar registros marcados com `TASK_CREATED_RECORD_KIND`/`TASK_COMPLETED_RECORD_KIND` e derivar a lista de pendentes (criações menos as referenciadas por uma conclusão), ordenada cronologicamente. O formato de `memory.json` não muda: tarefas são apenas mais um discriminador dentro dos mesmos registros de `command-results` já usados por fatos. Hidratação retorna `absent` apenas quando não há nenhum fato **e** nenhuma tarefa; caso contrário, `temporary.values` carrega `rememberedFacts` e `pendingTasks` lado a lado.

## 11. `InMemorySpecializedAgent`: novas traduções de decisão

No mesmo ramo de conversação já existente, duas novas traduções diretas, sem lógica de negócio adicional no Agent:

- `addTask` → `finalResult = { memoryRecordKind: TASK_CREATED_RECORD_KIND, content }`;
- `completeTask` → `finalResult = { memoryRecordKind: TASK_COMPLETED_RECORD_KIND, taskId }`.

O Agent também passa a extrair `pendingTasks` do payload hidratado (mesmo padrão de `extractRememberedFacts`) e a incluir no request ao `ModelProvider`. Nenhuma Tool é invocada para essas decisões, assim como já não é para `remember`/`respond`.

## 12. Limites

- texto da tarefa: máximo de 500 caracteres, rejeitado por inteiro (nunca truncado) com mensagem amigável;
- listagem de pendentes: exibe no máximo 500 itens, com nota explícita se houver mais (nunca corte silencioso);
- identificação de conclusão: apenas igualdade exata normalizada (trim + case-insensitive) contra tarefas pendentes - nunca aproximação silenciosa.

## 13. Erros Esperados

Todos resultam em resposta amigável ao usuário, nunca em crash ou exit code de erro:

- tarefa vazia (marcador sem conteúdo) → cai no fallback genérico de conversa não reconhecida;
- tarefa acima do limite de 500 caracteres → mensagem explícita, tarefa não criada;
- tarefa não encontrada ao concluir → mensagem explícita, nenhuma conclusão registrada;
- tarefa ambígua ao concluir → mensagem explícita, nenhuma conclusão registrada;
- nenhuma tarefa pendente ao listar → mensagem clara e distinta de erro.

## 14. Invariantes

- Core nunca importa nem referencia conceito de tarefa, discriminadores de registro ou vocabulário do domínio;
- a capability `converse` não decide nem interpreta - continua apenas repassando `{text}`;
- a CLI não conhece o domínio de tarefas;
- nenhum registro existente (fatos, `remember`, `recall`) é migrado, reescrito ou apagado;
- nenhum contrato de Capability, Tool ou do formato de `memory.json` é alterado em sua forma - apenas um novo discriminador reconhecido dentro da mesma estrutura já existente;
- conclusão nunca reescreve ou remove o registro de criação - é sempre um novo registro;
- zero dependência externa, zero chamada de rede, zero credencial.

## 15. Critérios de Aceitação

- `sebastiania "Adiciona uma tarefa: comprar leite"` cria uma tarefa real e persistente;
- `sebastiania "Quais são minhas tarefas?"`, em processo separado, lista somente pendentes;
- `sebastiania "Marca 'comprar leite' como feita"`, em processo separado, registra a conclusão;
- uma nova listagem, em processo separado, não inclui mais a tarefa concluída;
- tarefa inexistente ou ambígua ao concluir não altera o estado e responde de forma amigável;
- `greeting`, `remember`, `recall`, `converse` (fatos) e as Tools de filesystem (SPEC-040) continuam funcionando sem regressão;
- todos os testes, build e typecheck permanecem verdes;
- zero custo de API, zero chamada de rede, zero credencial.

## 16. Estratégia de Testes

- unitários: `FileCommandContextHydrator` (criação, conclusão, append-only preservado, ordenação cronológica, convivência com fatos); `DevelopmentModelProvider` (os três marcadores, limite de 500 caracteres, correspondência case-insensitive, não encontrada, ambígua, pendingTasks omitido); `InMemorySpecializedAgent` (traduções `addTask`/`completeTask`, propagação de `pendingTasks` ao `ModelProvider`);
- integração: `CorePipelineBootstrap`/`SebastianApplication` com ciclo completo adicionar → listar → concluir → listar entre instâncias `SebastianCore`/`SebastianApplication` separadas compartilhando o mesmo arquivo de memória, e regressão de convivência com fatos;
- ponta a ponta por subprocessos reais (`spawnSync`): ciclo completo em processos distintos e isolados, conclusão de tarefa inexistente sem crash, regressão de `greeting`/`remember`/`recall`/`converse`.

## 17. Justificativa Arquitetural

Esta SPEC não introduz um sistema de persistência paralelo nem uma nova fronteira arquitetural. Ela generaliza, pela segunda vez, o mesmo mecanismo de discriminador estrutural (`memoryRecordKind`) já usado desde a SPEC-039 para permitir que `converse` participe da memória de fatos sem migrar ou duplicar `memory.json`. Tarefas são apenas mais um discriminador dentro da mesma estrutura de registros append-only já homologada, com identidade derivada do próprio mecanismo de write-back (`executionId`) em vez de um gerador de ID novo. O `ModelProvider` continua sendo a única camada que conhece o domínio de tarefas, mantendo Core, Memory (em sua forma), Capability e Tool completamente agnósticos.

## Status

Implementada e homologada.
