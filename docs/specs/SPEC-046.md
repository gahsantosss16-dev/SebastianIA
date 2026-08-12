# SPEC-046 - Execução Orientada a Objetivo (Ciclo Cognitivo)

## 1. Contexto

Até a SPEC-045, o Sebastian já compunha contexto, recuperava memória relevante sozinho e mantinha o fio de uma conversa - mas cada capacidade ainda era acionada isoladamente: uma frase reconhecida produzia, no máximo, uma sequência já fixa de ações (o `developTask` da SPEC-044 sempre executa editar→validar→status→diff, nessa ordem, sem se importar com o que cada passo observa). Não havia nenhum fluxo capaz de: começar de um objetivo aberto ("descubra por que os testes estão falhando"), decidir sozinho a próxima ação a partir do que a anterior observou, e mudar de rumo quando uma hipótese se mostrasse errada.

Este bloco entrega a segunda fase do cérebro do Sebastian: um ciclo cognitivo curto e determinístico - objetivo → plano → ação → observação → decisão → verificação → conclusão - que reaproveita integralmente as capacidades já homologadas (Tools, memória, contexto) para investigar e, quando explicitamente autorizado, corrigir.

## 2. Objetivo

Permitir que, a partir de um pedido em linguagem natural, o Sebastian: entenda o objetivo; recupere memória/contexto quando necessário (reaproveitando a SPEC-045 sem reimplementá-la); decida quais capacidades já existentes usar; execute o próximo passo permitido; observe o resultado real; ajuste o próximo passo com base nessa observação; pare de forma determinística dentro de um limite de passos; e só declare sucesso quando houver evidência real de que o objetivo foi atingido - nunca apenas porque uma ação foi executada.

## 3. Escopo

Entregue como vertical slice único:

- `GoalExecutionOrchestrator` (`core/development/`): motor adaptativo que decide cada próxima ação em tempo de execução, a partir do que a ação anterior observou - ao contrário do `DevelopmentTaskOrchestrator` (SPEC-044), que executa um plano já inteiramente montado;
- `GoalDefinition`: um objetivo estruturado mínimo (`objective`, `authorization`, `validationToolId`, `fix?`) - não um plano fixo;
- uma nova decisão do `ModelProvider` (`pursueGoal`), consumida pelo `InMemorySpecializedAgent` através do novo orquestrador, seguindo exatamente o mesmo padrão já usado para `developTask`;
- três reconhecimentos determinísticos no `DevelopmentModelProvider`: investigação somente-leitura, correção com edição concreta já autorizada, correção vaga (autorizada mas sem edição concreta), mais a integração de uma retomada de memória (SPEC-045) como objetivo perseguível;
- testes unitários, de integração e por subprocessos reais comprovando comportamento, não apenas estrutura.

## 4. Fora do Escopo

Internet, APIs pagas, LLM pago, serviços cloud, voz, interface gráfica nova, embeddings, banco vetorial, automação de browser, integrações externas, sistema genérico de plugins, arquitetura distribuída, autonomia irrestrita, Git mutável (commit/push/tag/checkout/reset), deploy, `npm install`, exclusões destrutivas. Nenhuma nova Tool foi criada - o ciclo só invoca `git.status`, `git.diff`, `validation.*` e `fs.replaceText`, todas já homologadas.

## 5. Responsabilidade Funcional Única

Transformar as capacidades já existentes em um fluxo de trabalho orientado a objetivo - sem redesenhar nenhuma delas, sem uma segunda arquitetura paralela, e sem que Core, Capability ou a `converse` conheçam qualquer regra de planejamento, autorização ou verificação.

## 6. Ciclo Cognitivo: OBJECTIVE → PLAN → ACT → OBSERVE → DECIDE → VERIFY → COMPLETE

```
GoalDefinition { objective, authorization, validationToolId, fix? }
  → GoalExecutionOrchestrator.execute(goal, context)

  1. ACT:     git.status (inspecionar estado relevante)
     OBSERVE: branch/limpo ou não

  2a. Sem fix concreto (investigar):
      ACT:     validation.<alvo>
      OBSERVE: passou ou falhou
      DECIDE:  se passou → hipótese de falha contestada → CONCLUDE
                (adapta o plano: nunca busca mais evidência à toa)
               se falhou → aprofundar
      ACT:     git.diff (evidência adicional, só quando necessário)
      VERIFY:  (implícito - a própria validação já é a verificação da hipótese)
      COMPLETE: relatório com o que foi encontrado

  2b. Com fix concreto e authorization=writeAuthorized (corrigir):
      ACT:     fs.replaceText(path, searchText, replaceText)
      OBSERVE: aplicado ou recusado (ex.: arquivo já sujo)
      DECIDE:  se recusado → CONCLUDE blocked, nada verificado
               se aplicado → verificar
      ACT:     validation.<alvo>          [VERIFY]
      OBSERVE: passou ou ainda falha
      ACT:     git.diff (evidência final)
      DECIDE:  passou → COMPLETE completed
               ainda falha → COMPLETE failed (ação executada ≠ objetivo concluído)
```

Cada iteração sabe, e cada teste consegue comprovar: o objetivo atual (`goal.objective`), o passo em execução e sua fase cognitiva (`GoalExecutionStepRecord.phase`: `inspect`/`act`/`verify`/`evidence`), a capacidade escolhida (`toolId`), o resultado observado (`outcome`/`summary`), as decisões tomadas entre passos (`GoalExecutionDecisionRecord`), se o objetivo foi concluído (`status`), e se a execução deve parar (limite de passos ou autorização insuficiente).

## 7. `GoalDefinition`: Objetivo, Não Plano Fixo

Ao contrário do `DevelopmentTaskPlan` (SPEC-044), que já chega pronto e linear, um `GoalDefinition` não descreve passos - descreve **o que** alcançar e **o que está autorizado**. A sequência de ações é decidida em tempo de execução pelo orquestrador, o que é exatamente o que permite o comportamento de adaptação exigido: se a validação já passa, o ciclo termina sem gerar passos desnecessários; se falha, ele aprofunda antes de concluir.

## 8. Política de Autorização

- **Leitura (`readOnly`)**: `git.status`, `git.diff`, `validation.*` podem sempre ser usados quando o objetivo precisa - nunca alteram nada.
- **Alteração local controlada (`writeAuthorized` + `fix`)**: só existe quando o próprio pedido do usuário já nomeou a edição concreta (ex.: "corrija o arquivo X substituindo Y por Z"). `fs.replaceText` só é invocado nessas condições - o orquestrador recusa internamente qualquer tentativa de usá-lo fora delas, mesmo que uma `GoalDefinition` mal formada o solicitasse (defesa em profundidade, mesmo padrão já usado pelo `DevelopmentTaskOrchestrator`).
- **Autorização vaga (`writeAuthorized` sem `fix`)**: "corrija esse problema" autoriza a *intenção* de corrigir, mas sem uma edição concreta nomeada o ciclo nunca fabrica uma - ele investiga e relata honestamente que não foi possível determinar uma correção segura automaticamente.
- **Ações sensíveis/destrutivas/externas**: nunca presumidas - estruturalmente impossíveis, já que o orquestrador só conhece `git.status`, `git.diff`, `validation.*` e `fs.replaceText`.
- **Git e fechamento**: expressões genéricas ("continua", "resolve", "pode seguir") nunca produzem uma `GoalDefinition` por si sós - os reconhecimentos exigem um verbo de investigação (`descubra`/`investigue`) ou de correção (`corrija`/`conserte`) combinado com um alvo (`teste`/`build`/`typecheck`/`problema`). Commit, push e tags continuam inteiramente fora do alcance de qualquer decisão natural, sem exceção.

## 9. Limite Contra Loops

`MAX_GOAL_EXECUTION_STEPS = 6`, centralizado como constante exportada (mesmo padrão já usado por `MAX_DEVELOPMENT_TASK_STEPS` na SPEC-044), verificado antes de cada ação. Ao atingir o limite, a execução para com `status: 'incomplete'`, preserva todos os passos e decisões já reunidos no relatório, e informa objetivamente que não conseguiu concluir dentro do limite - nunca continua silenciosamente. Testado diretamente construindo o orquestrador com um `maxSteps` baixo (mesma técnica de teste já usada e homologada na SPEC-044), provando o mecanismo de parada de forma determinística.

## 10. Verificação Antes de Sucesso

`status: 'completed'` para uma correção só é reportado depois que a mesma validação do objetivo é executada de novo, após a edição, e realmente passa. Uma edição aplicada com sucesso cujo teste ainda falha é reportada como `failed` (motivo `verificationFailed`), com o arquivo preservado para revisão - nunca revertido automaticamente (fora de escopo, como já documentado na SPEC-044). Esse princípio (**ação executada ≠ objetivo concluído**) está tanto no código (o `status` só vira `completed` depois do passo de verificação) quanto em testes dedicados que aplicam uma edição real e comprovam que uma verificação que ainda falha nunca é relatada como sucesso.

## 11. Reuso da Memória/Contexto (SPEC-045)

Nenhuma lógica de memória foi reimplementada. `DevelopmentModelProvider` já computa o `ConversationContextComposer` (SPEC-045) uma única vez por interpretação; o novo reconhecimento de retomada ("Sebastian, veja onde paramos nesse projeto e continue o trabalho.") reaproveita exatamente esse mesmo resultado (`composed.relevantMemories`) para decidir se há algo concretamente perseguível (uma memória relevante que menciona um alvo de validação falhando) - transformando-o em um objetivo real (`GoalDefinition`) só quando há sinal suficiente; caso contrário, a frase continua caindo no comportamento de continuação já homologado da SPEC-045, sem duplicar nada.

## 12. Observabilidade Sem Vazamento

`GoalExecutionResult` (exposto em `finalResult.goalExecution`, seguindo o mesmo padrão já homologado do `developmentTask` da SPEC-044) contém passos, decisões e evidências resumidas - nunca stdout bruto, diff bruto ou conteúdo integral de arquivo. `GoalExecutionDecisionRecord` registra cada ponto de decisão (`observation`/`decision`) de forma estruturada e testável, mas sempre como frases curtas já compostas, nunca dados brutos. A resposta ao usuário (`finalResult.message`) é sempre uma frase natural.

## 13. Critérios de Aceitação

- "Descubra por que os testes estão falhando" investiga de verdade (Git + validação real), nunca altera nenhum arquivo, e relata evidência real;
- a mesma investigação, quando a validação na verdade passa, conclui reconhecendo que a hipótese de falha não se confirmou, sem gerar passos desnecessários;
- "Corrija o arquivo X substituindo Y por Z" aplica a edição e só relata sucesso depois de verificar a validação de fato passando;
- uma edição aplicada cuja validação continua falhando é relatada como falha, nunca como sucesso, com a alteração preservada;
- uma correção vaga ("corrija esse problema") nunca fabrica uma edição concreta;
- uma retomada de memória ("veja onde paramos... continue o trabalho") vira uma investigação real quando há memória relevante e concreta;
- nenhuma execução ultrapassa o limite de passos sem parar com segurança;
- todas as capacidades homologadas nas SPEC-034 a SPEC-045 continuam funcionando sem alteração de comportamento;
- todos os testes, build e typecheck permanecem verdes; zero custo de API, zero rede, zero credencial.

## 14. Estratégia de Testes

Unitários (`GoalExecutionOrchestrator`): investigação com hipótese contestada (adaptação, sem diff); investigação com falha real (evidência completa, nunca toca `fs.replaceText`); correção vaga sem edição fabricada; correção aplicada e verificada; correção aplicada mas não verificada (`failed`, não `completed`); correção recusada por arquivo sujo (`blocked`, sem verificar); objetivo somente-leitura que também carrega um `fix` nunca edita; tratamento informativo de "não é repositório Git"; `toolId` fora da whitelist recusado sem invocação; falha inesperada de Tool; limite de passos (com `maxSteps` customizado, prova determinística contra loop infinito); validação completa de `GoalDefinition`/contexto. `DevelopmentModelProvider`: reconhecimento de investigação, correção concreta, correção vaga, ausência de regressão nos reconhecimentos já homologados, prova de que palavras genéricas de continuação nunca autorizam um objetivo, retomada de memória convertendo-se em objetivo perseguível e degradando graciosamente quando não há memória concreta. `InMemorySpecializedAgent`: execução via orquestrador padrão, injeção de orquestrador alternativo, anexação de `conversationTurn`. Integração (`SebastianApplication`, repositório Git temporário real): os seis cenários acima fim-a-fim, incluindo um script de validação sensível ao conteúdo do arquivo para provar verificação real, e continuidade entre instâncias `Core` separadas após uma execução de objetivo. Ponta a ponta (subprocessos reais contra o executável compilado): investigação real sem tocar arquivos, e contraste explícito e no mesmo teste entre um pedido investigativo e um pedido de correção explicitamente autorizado.

## 15. Justificativa Arquitetural

Este bloco não introduz um planejador genérico, uma segunda arquitetura de agente, nem infraestrutura à espera de uso futuro. `GoalExecutionOrchestrator` segue exatamente o mesmo padrão estrutural já homologado pelo `DevelopmentTaskOrchestrator` (mesma interface `SpecializedTool`, mesmo estilo de contrato, mesmo padrão de defesa em profundidade, mesmo limite de passos centralizado) - a única diferença de fundo é que a sequência de ações é decidida em tempo de execução, e não pré-montada, porque isso é exatamente o que "adaptar quando uma hipótese está errada" exige. `pursueGoal` segue o mesmo padrão de decisão já usado por `developTask` no `ModelProvider` e no `Agent`. Memória e contexto (SPEC-045) são inteiramente reaproveitados, nunca reimplementados. O resultado é o menor incremento capaz de dar ao Sebastian um comportamento genuinamente orientado a objetivo, sem abrir mão de nenhuma garantia de segurança já conquistada.

## Status

Implementada - aguardando homologação.
