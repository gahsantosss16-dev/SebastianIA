# SPEC-044 - Agente de Desenvolvimento Orquestrado

## 1. Contexto

A SPEC-043 deu ao Sebastian um primeiro executor de desenvolvimento controlado: editar um trecho exato de um arquivo (`fs.replaceText`), inspecionar Git somente-leitura (`git.status`/`git.diff`) e rodar uma validação pré-autorizada (`validation.*`) - mas cada capacidade só podia ser acionada individualmente, uma Tool por vez, exigindo que o usuário conduzisse manualmente a sequência "edite, depois valide, depois confira o Git". Este bloco fecha esse ciclo: dado um único objetivo de desenvolvimento em linguagem natural, o Sebastian agora entende o pedido, monta um plano curto e estruturado, executa uma sequência limitada dessas mesmas Tools já homologadas, observa o resultado de cada etapa e produz um relatório final - tudo em uma única invocação, sem shell arbitrário, sem Git mutável, sem provider de IA real.

## 2. Objetivo

Permitir que, dentro do workspace autorizado, o usuário peça em linguagem natural para realizar uma tarefa de desenvolvimento composta - "no arquivo X, substitua Y por Z e execute os testes/o build/o typecheck" - e receba, em uma única resposta, o resultado real de toda a sequência: edição cirúrgica, validação autorizada, estado e diff do Git, e um relatório final com o desfecho (`completed`, `failed` ou `blocked`), sem que nenhuma etapa extrapole os limites de segurança já homologados.

## 3. Escopo

Entregue como vertical slice único:

- contrato mínimo de tarefa de desenvolvimento (`DevelopmentTaskPlan`, `DevelopmentTaskStep`, `DevelopmentTaskResult`) em `core/development/`;
- `DevelopmentTaskOrchestrator`: executor bounded (máximo de 10 passos) de um plano linear de chamadas às Tools já existentes, com classificação de resultado por família de Tool (edição, validação, Git) e três desfechos possíveis (`completed`/`failed`/`blocked`);
- uma nova decisão do `ModelProvider` (`developTask`), consumida pelo `InMemorySpecializedAgent` através do orquestrador;
- um reconhecimento determinístico adicional no `DevelopmentModelProvider` capaz de montar o plano completo (editar → validar → status → diff) a partir de uma única frase;
- testes unitários, de integração e por subprocessos reais, em repositórios/workspaces Git temporários e isolados.

## 4. Fora do Escopo

Provider real de IA, API externa, múltiplos agentes (planner/coder/reviewer/tester/supervisor), shell arbitrário, `git add`/`commit`/`push`/`pull`/`checkout`/`reset`/`restore`/`clean`/`merge`/`rebase`/`stash`, criação de branch, rollback automático, deploy, `npm install`, edição multi-arquivo irrestrita, DAG, scheduler, filas, banco novo, autocorreção ilimitada, execução em background, interface gráfica. Nenhuma alteração de comportamento de `greeting`, `remember`, `recall`, `converse` (fatos e tarefas), workspace, leitura/escrita de arquivos, `git.status`/`git.diff` e `validation.*` isolados (SPEC-040 a SPEC-043).

## 5. Responsabilidade Funcional Única

Dar ao Sebastian a capacidade de conduzir, dentro de limites rígidos e já homologados, uma sequência curta de ações de desenvolvimento a partir de um único objetivo em linguagem natural - sem que o Core, a CLI ou a capability `converse` conheçam o conceito de "tarefa de desenvolvimento", e sem introduzir uma segunda arquitetura de agente paralela à já existente.

## 6. Arquitetura

```
sebastiania 'No arquivo exemplo.ts, substitua "const x = 1;" por "const x = 2;" e execute os testes.'
  → converse → Agent → DevelopmentModelProvider.interpret()
    → decisão { intent: 'developTask', plan }
  → Agent.handleDevelopTask → DevelopmentTaskOrchestrator.execute(plan, context)
    1. fs.replaceText  → LocalToolDispatcher → LocalFilesystemInspectionTool
       (exige 1 ocorrência; recusa se já houver alterações não commitadas)
    2. validation.test → LocalToolDispatcher → LocalAuthorizedCommandTool
    3. git.status       → LocalToolDispatcher → LocalGitInspectionTool
    4. git.diff          → LocalToolDispatcher → LocalGitInspectionTool
  → DevelopmentTaskResult { status: 'completed'|'failed'|'blocked', steps, filesChanged, message }
  → finalResult = { message, developmentTask: result }
```

O `LocalToolDispatcher`, o `SpecializedTool` de cada família e todas as proteções de segurança já homologadas (SPEC-040 a SPEC-043) são reaproveitados sem nenhuma alteração. O orquestrador é a única peça nova de execução, e ele próprio nunca fala diretamente com filesystem, Git ou processos - apenas invoca a mesma interface `SpecializedTool` que o Agent já usava para uma única `useTool`.

## 7. Contrato de Tarefa de Desenvolvimento

`core/development/DevelopmentTaskContract.ts` define o mínimo necessário para uma execução controlada local - deliberadamente não um framework de workflow:

- `DevelopmentTaskStep { stepId, description, toolId, toolInput }`: um único passo, sempre uma invocação de Tool, nunca um plano aninhado;
- `DevelopmentTaskPlan { objective, steps }`: o plano completo, já fechado antes da execução começar;
- `DevelopmentTaskStepReport { stepId, toolId, description, outcome, summary }`: resultado já resumido e limitado de um passo - `summary` é sempre derivado de campos estruturados da Tool (`succeeded`, `exitCode`, `outcome`, `reasonCode`), nunca a `message` bruta da Tool, que pode carregar até 64 KiB de stdout/diff;
- `DevelopmentTaskResult { objective, status, steps, filesChanged, reason?, message }`: o relatório final, no mesmo formato usado como resposta ao usuário e como valor persistido em Memory.

Não há DAG, scheduler, fila ou banco novo: o plano é um array linear e a execução é um laço `for` simples e limitado.

## 8. Plano Curto e Estruturado

Para o `DevelopmentModelProvider` determinístico, o plano é derivado deterministicamente de um único marcador: `"no arquivo X, substitua Y por Z e execute <os testes|o build|o typecheck>"`. O plano resultante tem sempre 4 passos fixos: `fs.replaceText` → `validation.<escolhida>` → `git.status` → `git.diff`. Não existe uma etapa separada de "verificar Git antes de editar": essa verificação já acontece atomicamente dentro do próprio `fs.replaceText` (SPEC-043 - `hasUncommittedChanges`, checada na mesma invocação que decide se escreve), então uma etapa extra de pré-checagem seria redundante e reintroduziria uma janela de corrida entre "checar" e "editar" que a implementação atual não tem. O plano dirige a execução de verdade - cada passo é uma chamada real à Tool correspondente, nunca texto decorativo. Um `ModelProvider` real futuro produz exatamente esta mesma forma (`{ intent: 'developTask', plan }`) para reaproveitar o mesmo orquestrador sem alterações.

## 9. Orquestração Multi-Step

`DevelopmentTaskOrchestrator.execute(plan, context)` percorre `plan.steps` em ordem, sempre dentro da mesma invocação síncrona de `handoff` do Agent (não há execução em background nem processo separado por passo). Cada passo é classificado pelo próprio `toolId`:

- **`fs.replaceText` (crítico)**: qualquer rejeição - arquivo já modificado, texto não encontrado, ambíguo, traversal, caminho absoluto, symlink escapando da raiz, arquivo grande/binário - interrompe a tarefa imediatamente como `blocked`, pulando inclusive a validação, já que nada foi alterado e não há o que validar;
- **`validation.*` (importante, não fatal ao plano)**: uma validação recusada (`notAuthorized`/`timedOut`) ou concluída com exit code diferente de zero marca a tarefa como `failed`, mas a execução continua até o fim, para que o relatório final ainda mostre o estado e o diff reais do Git;
- **`git.status`/`git.diff` (informativo)**: nunca alteram o status da tarefa, mesmo quando o workspace não é um repositório Git - esse caso é reportado normalmente, exatamente como já acontecia isoladamente na SPEC-043.

Uma falha inesperada de qualquer Tool (`status: 'failed'`) interrompe a tarefa imediatamente como `failed`.

## 10. Limite de Passos

`MAX_DEVELOPMENT_TASK_STEPS = 10` (configurável apenas via o segundo parâmetro do construtor do orquestrador, nunca por texto do usuário). Um plano com mais passos que o limite é recusado antes de qualquer invocação, como `failed`/`stepLimitExceeded` - nunca uma tentativa parcial. Não existe re-planejamento, re-tentativa automática ou continuação após o limite: a tarefa termina com estado claro. O plano determinístico atual usa sempre 4 passos, bem abaixo do teto.

## 11. Reuso das Tools Existentes

Nenhuma Tool nova de execução foi criada. O orquestrador só reconhece um conjunto fixo de `toolId`s (`fs.replaceText`, `git.status`, `git.diff`, mais qualquer `toolId` com prefixo `validation.`) e invoca a mesma interface `SpecializedTool` já usada pelo Agent - por padrão, a própria instância de `LocalToolDispatcher` composta em `CorePipelineBootstrap`. Um passo que nomeasse um `toolId` fora dessa lista fixa é recusado como `failed`/`toolNotAuthorized` sem nenhuma invocação - defesa em profundidade contra um futuro `ModelProvider` produzir um plano indevido, já que o texto do usuário nunca chega a um `toolId` diretamente.

## 12. Proteção Pré-Execução

A allowed root, a whitelist de Tools e a whitelist de validações continuam sendo exatamente as já homologadas (SPEC-040/043) - nada foi duplicado. A proteção contra editar um arquivo já modificado no Git é a mesma checagem atômica de `fs.replaceText`, sem pré-checagem redundante (ver seção 8). Quando essa checagem recusa a edição, a tarefa termina como `blocked`, sem executar validação e sem qualquer escrita.

## 13. Validação Automática Controlada

Quando o plano inclui um passo `validation.*`, ele é executado exatamente como uma chamada isolada já seria (mesmo `LocalAuthorizedCommandTool`, mesma whitelist, mesmo `shell: false`, mesmo timeout, mesmo truncamento de 64 KiB). Nenhum comando livre do usuário ou do modelo pode virar processo - o `toolId` de validação usado no plano determinístico vem sempre das constantes já exportadas por `LocalAuthorizedCommandTool.ts` (`VALIDATION_TEST_TOOL_ID` etc.).

## 14. Comportamento `completed`/`failed`/`blocked`

- **`completed`**: todos os passos concluídos com sucesso (edição aplicada, validação com exit code 0, Git consultado);
- **`blocked`**: a edição foi recusada antes de qualquer alteração - nada foi escrito, nenhuma validação rodou;
- **`failed`**: uma validação não passou (ou foi recusada), uma Tool falhou inesperadamente, um passo usa uma Tool não autorizada, ou o plano excede o limite de passos.

Em nenhum desfecho o Sebastian declara sucesso quando algo falhou, nem tenta uma sequência ilimitada de correções: no máximo os passos já previstos no plano são executados, uma única vez cada. Não há rollback automático (`git restore`/`reset`/`checkout`/`stash`/`clean` continuam inteiramente fora de escopo) - uma alteração aplicada que depois falha na validação permanece no workspace, visível no relatório final e no `git diff` real.

## 15. Relatório Final e Memória

`DevelopmentTaskResult` é ao mesmo tempo a resposta ao usuário e o valor persistido em Memory (mesmo mecanismo de write-back da SPEC-039, via `finalResult`) - por isso ele nunca carrega conteúdo integral de arquivo, stdout bruto ou diff bruto. Cada `DevelopmentTaskStepReport.summary` é uma frase curta derivada de campos estruturados (`succeeded`, `exitCode`, `outcome`, `clean`, presença de mudanças) e não da `message` já truncada-mas-potencialmente-grande da Tool subjacente. Isso é uma limitação deliberada: para ver o diff completo ou o stdout completo de uma validação, o usuário continua podendo pedir `git.diff`/`validation.*` isoladamente, exatamente como na SPEC-043.

## 16. `DevelopmentModelProvider`

Um único padrão novo, determinístico: `"no arquivo X, substitua Y por Z e execute <os testes|o build|o typecheck>"` monta o `DevelopmentTaskPlan` completo. Nenhuma dezena de regex, nenhum NLU. Quando o padrão não reconhece um texto de busca válido, a extração simplesmente não produz um plano e o fluxo cai nos reconhecimentos já existentes (SPEC-043), incluindo a possibilidade de cair no marcador isolado de validação (`"execute os testes"`) quando a frase ainda o contém - comportamento seguro e coerente, não um erro.

## 17. Limites e Segurança

- máximo de 10 chamadas de Tool por tarefa, aplicado antes de qualquer execução;
- filesystem restrito à allowed root (guard já homologado, sem alteração);
- edição textual ≤ 256 KiB, uma única ocorrência exigida (Tool já homologada, sem alteração);
- Git somente-leitura, dois subcomandos fixos (Tool já homologada, sem alteração);
- validações apenas pela whitelist pré-registrada, `shell: false`, timeout, stdout/stderr truncados a 64 KiB (Tool já homologada, sem alteração);
- `toolId` de cada passo do plano validado contra uma lista fixa antes de qualquer invocação;
- nenhuma rede, nenhuma credencial, nenhuma dependência externa nova.

## 18. Critérios de Aceitação

- uma única frase como `"No arquivo exemplo.ts, substitua "const x = 1;" por "const x = 2;" e execute os testes."` edita o arquivo, executa a validação, consulta status e diff do Git, e retorna um relatório `completed` com os arquivos alterados reais - tudo em uma única invocação;
- a mesma frase contra um arquivo já modificado no Git termina `blocked`, sem editar e sem validar;
- a mesma frase com uma validação que falha termina `failed`, preservando a edição já aplicada e mostrando o estado/diff reais do Git;
- um plano com `toolId` fora da whitelist fixa, ou acima do limite de passos, é recusado com segurança, sem nenhuma invocação;
- `greeting`, `remember`, `recall`, `converse` (fatos e tarefas), workspace, e as Tools isoladas de filesystem/Git/validação das SPEC-040 a SPEC-043 continuam funcionando sem regressão;
- todos os testes, build e typecheck permanecem verdes; zero custo de API, zero rede, zero credencial.

## 19. Estratégia de Testes

Repositórios/workspaces Git temporários e isolados em todos os níveis (nunca o projeto real do usuário para escrita). Unitários: `DevelopmentTaskOrchestrator` (plano completo bem-sucedido; bloqueio por arquivo já modificado e por qualquer outra rejeição de edição, sem rodar validação; falha de validação continuando até o fim; validação recusada como não autorizada; passos Git informativos mesmo fora de um repositório; falha inesperada de Tool interrompendo imediatamente; `toolId` fora da whitelist sem invocação; limite de passos excedido sem invocação, inclusive com um teto customizado; validação estrita do contrato do plano e do contexto de execução); `DevelopmentModelProvider` (reconhecimento do novo marcador com plano completo para testes/build/typecheck, fallback seguro sem texto de busca, convivência com o marcador de replaceText isolado já existente); `InMemorySpecializedAgent` (decisão `developTask` roteada para o orquestrador padrão construído a partir da própria Tool já injetada, ou para um orquestrador explicitamente injetado, provando a integração sem exigir alteração em `handleToolUse`). Integração: vertical slice completo de sucesso, bloqueio e falha através de `SebastianApplication`/`CorePipelineBootstrap`, comprovando que o relatório final nunca carrega diff/stdout brutos. Ponta a ponta por subprocessos reais contra o executável compilado, com um repositório-fixture Git isolado que define seus próprios scripts `test`/`build`/`typecheck` (nunca os scripts do projeto real do Sebastian), cobrindo sucesso, bloqueio e falha de validação.

## 20. Justificativa Arquitetural

Este bloco não introduz um segundo agente, nem um framework de orquestração genérico. Ele acrescenta uma única peça nova e propositalmente pequena - um laço linear e limitado sobre a mesma interface `SpecializedTool` que o Agent já usava para uma `useTool` isolada - e uma única decisão nova do `ModelProvider` que carrega um plano já fechado. Toda a superfície de segurança (allowed root, whitelist de Tools, whitelist de validações, ausência de shell, ausência de Git mutável) é herdada sem alteração das SPEC-040 a SPEC-043; a única superfície nova é a lista fixa de `toolId`s que o orquestrador aceita e o teto rígido de passos - ambos deliberadamente pequenos e auditáveis. Isso aproxima o Sebastian de um agente de desenvolvimento utilizável (um objetivo → uma sequência real de ações → um relatório) sem abrir mão de nenhuma garantia de segurança já conquistada.

## Status

Implementada e homologada.
