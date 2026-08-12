# SPEC-045 - Memória Inteligente, Construção de Contexto e Decisão Contextual

## 1. Contexto

Até a SPEC-044, o Sebastian já possuía memória persistente local (fatos e tarefas), hidratação de memória por comando, conversação natural determinística, um Agent com `handoff` assíncrono e um executor de desenvolvimento orquestrado - mas cada capacidade era acionada por correspondência literal de frase, e o `respond` de uma pergunta sempre devolvia o fato mais recentemente lembrado, sem relação com o que foi de fato perguntado. Não havia nenhum registro do que havia sido dito ou feito em turnos anteriores da conversa: cada processo CLI é, por design, um processo novo (SPEC-034/039), então "o que conversamos" nunca sobrevivia entre invocações - só fatos e tarefas explicitamente nomeados sobreviviam.

Este bloco dá ao Sebastian a primeira fase do seu "cérebro real": recuperar sozinho a memória relevante para o pedido atual (sem o usuário chamar `recall`), diferenciar o tipo de solicitação, montar um contexto explícito antes de decidir, e manter o fio de uma conversa através de referências curtas ("então continua") e de retomadas nomeadas ("vamos continuar meu projeto de ontem") - inclusive entre processos separados, já que memória só sobrevive através do arquivo de memória já homologado.

## 2. Objetivo

Sem LLM pago, sem rede, sem infraestrutura nova: dado um pedido em linguagem natural, o Sebastian deve (a) reconhecer minimamente se é uma pergunta, uma referência a algo anterior, uma retomada de projeto/tarefa, ou uma continuação curta; (b) recuperar automaticamente a memória (fatos e/ou turnos de conversa recentes) que tem relação real com o pedido atual, nunca despejando tudo o que está guardado; (c) usar essa memória para efetivamente compor a resposta ou decisão seguinte; e (d) manter continuidade entre mensagens curtas e entre processos separados, sempre através da mesma memória persistente já homologada.

## 3. Escopo

Entregue como vertical slice único:

- uma nova categoria de memória, mínima e necessária: `recentExchanges` (turnos recentes de conversa), reconstruída pelo hidratador já homologado a partir do mesmo arquivo de memória - sem store novo;
- um segundo seam de write-back em `SebastianCore`, `memoryExtras`, irmão de `finalResult`: o que é persistido pode agora diferir do que é devolvido ao usuário, sem quebrar nenhum contrato de resposta já homologado;
- `ConversationContextComposer`: um componente novo e pequeno em `core/model/` que classifica a intenção da mensagem (`question`/`continuationReference`/`resumptionReference`/`plain`) e seleciona, por sobreposição real de palavras-chave, a memória (fato ou turno recente) genuinamente relevante ao pedido atual - nunca a memória inteira;
- extensão do `DevelopmentModelProvider` para consumir esse contexto composto como uma camada de fallback contextual, sempre depois dos reconhecimentos determinísticos já homologados (SPEC-038 a SPEC-044), preservando-os sem alteração;
- testes unitários, de integração e por subprocessos reais comprovando comportamento observável, não apenas estrutura.

## 4. Fora do Escopo

Provider de IA real, API paga, LLM pago, internet, voz, nova interface gráfica, embeddings, banco vetorial, automações externas, infraestrutura cloud, ferramentas novas sem necessidade direta deste bloco. Nenhuma alteração de comportamento das capacidades já homologadas quando o pedido já é reconhecido por um marcador determinístico existente (fatos, tarefas, filesystem, Git, validações, executor de desenvolvimento orquestrado).

## 5. Responsabilidade Funcional Única

Dar ao Sebastian a capacidade de recuperar e usar sozinho a memória relevante ao pedido atual, e de manter o fio de uma conversa através de referências curtas - sem introduzir um banco de dados novo, sem embeddings, sem quebrar a separação já estabelecida entre Core, Capability, Agent, ModelProvider e Tool, e sem que Core ou a capability `converse` precisem conhecer qualquer regra de relevância ou de continuidade.

## 6. Modelo de Memória: a Única Categoria Genuinamente Nova

Fatos/preferências, projetos e decisões continuam unificados no mecanismo de fatos já homologado desde a SPEC-038 - reuso deliberado, exatamente como já decidido na SPEC-042 ("Sebastian, lembra que..." continua sendo o único caminho de fato persistente, sem discriminador novo por domínio). Pendências continuam inteiramente no mecanismo de tarefas já homologado na SPEC-041. Nenhum desses dois foi alterado.

A única categoria genuinamente nova é `recentExchanges`: um pequeno e limitado histórico de turnos de conversa (texto do pedido + resumo curto do que aconteceu), necessário porque, antes deste bloco, não existia nenhum registro do que havia sido dito ou feito - apenas fatos e tarefas explicitamente nomeados sobreviviam entre processos. Sem essa categoria, uma referência curta como "então continua" não teria a que se referir depois que o processo que respondeu à pergunta original já tivesse terminado.

## 7. O Seam `memoryExtras`: Persistir Mais do que se Mostra ao Usuário

`SebastianCore` já tinha, desde a SPEC-039, um seam opcional (`finalResult`) pelo qual a saída do Agent se torna, ao mesmo tempo, a resposta ao chamador e o valor persistido em Memory. Registrar um turno de conversa a cada mensagem exigia persistir um pouco mais do que o `finalResult` de cada decisão já continha (ex.: o texto original do pedido) - mas sem poluir a resposta que o usuário vê com esse detalhe interno, e sem alterar a forma de nenhum `finalResult` já homologado.

A solução foi um segundo seam, irmão do primeiro e igualmente genérico (Core nunca interpreta o que `memoryExtras` contém):

```
SpecializedAgentHandoffSuccess.output = {
  finalResult: {...}      // vira a resposta E, por padrão, o write-back (comportamento inalterado)
  memoryExtras?: {...}    // opcional: mesclado SOMENTE no write-back, nunca na resposta
}
```

`SebastianCore.handoffToSpecializedAgent` agora resolve os dois separadamente: `resolveEffectiveResult` continua produzindo a resposta exatamente como antes (nenhum teste de resposta pré-existente foi alterado); `extractMemoryExtras` lê `memoryExtras` de forma tolerante (um valor inválido é simplesmente ignorado, já que nunca chega ao usuário) e `writeBackCommandResult` mescla suas chaves no `output` persistido. Quando `memoryExtras` está ausente, o comportamento é idêntico ao anterior a este bloco.

## 8. `InMemorySpecializedAgent`: Registrando o Turno

A cada decisão de `converse` concluída com sucesso, o Agent monta `memoryExtras: { conversationTurn: { requestText, summary, kind } }`, onde `summary` é sempre derivado de campos já estruturados da própria decisão (a resposta, o conteúdo lembrado, a mensagem da Tool) - nunca um campo bruto e potencialmente grande.

Deliberadamente **não** registrado para decisões `remember`/`addTask`/`completeTask`: esses conteúdos já têm categoria de memória própria (fato/tarefa), e registrá-los também como um turno de conversa apenas duplicaria o mesmo conteúdo sob duas formas - o que, na prática, fazia dois itens quase idênticos competirem pela mesma pergunta durante a seleção de relevância (ver seção 14). Registrado para `respond`, `useTool` e `developTask`, que não têm nenhuma outra categoria de memória dedicada.

## 9. `ConversationContextComposer`

Novo, pequeno e puro (`core/model/ConversationContextComposer.ts`), com uma única responsabilidade: dado o texto atual mais os fatos/turnos já hidratados, produzir:

- `intent`: `resumptionReference` (nomeia um projeto/tarefa e pede para continuar - ex.: "vamos continuar meu projeto de ontem"), `continuationReference` (referência curta e genérica - "continua", "e agora?", "como ficou aquilo?", "onde paramos?"), `question` (contém "?" ou começa com uma palavra interrogativa), ou `plain`;
- `relevantMemories`: até 3 fatos/turnos cuja sobreposição real de palavras-chave (após um filtro pequeno de palavras vazias) com o texto atual é maior que zero, ordenados por pontuação e, em empate, por recência - nunca a memória inteira;
- `mostRecentFact`/`mostRecentExchange`: convenientes apenas por recência, usados como degradação graciosa quando não há sobreposição de palavras-chave nenhuma.

Este é o passo explícito de "construção de contexto" pedido para este bloco: testável de forma isolada (`tests/model/ConversationContextComposer.test.ts`), sem estar embutido na lógica de reconhecimento de marcadores do `DevelopmentModelProvider`.

## 10. Onde a Camada Contextual Entra no `DevelopmentModelProvider`

Todo reconhecimento determinístico já homologado (SPEC-038 a SPEC-044: lembrar, tarefas, filesystem, workspace, Git, validações, executor de desenvolvimento orquestrado) continua rodando **primeiro**, exatamente como antes - nenhuma dessas verificações foi tocada. Só quando nenhuma delas reconhece o texto é que o `ConversationContextComposer` é consultado, substituindo o antigo bloco final (que só reagia a `"?"` e sempre devolvia o fato mais recente):

```
resumptionReference → responde retomando com a memória mais relevante encontrada
continuationReference → responde continuando a partir do turno mais recente
question             → responde com a memória mais relevante encontrada
plain                 → resposta padrão de "não sei responder", como antes
```

Isso preserva 100% dos reconhecimentos e das strings de resposta já homologadas em cenários com no máximo uma memória disponível, e só muda o comportamento observável exatamente onde havia mais de uma memória em jogo - agora respondendo com a genuinamente relevante, não com a mais recente por acidente de ordem.

## 11. Seleção de Memória Relevante (Não é um Banco Vetorial)

Sobreposição de palavras-chave, sem qualquer modelo estatístico ou embutimento: o texto atual e cada fato/turno são reduzidos a um conjunto de palavras significativas (≥3 caracteres, fora uma lista curta de conectores comuns em português), e a pontuação é a contagem de palavras em comum. O melhor resultado (maior pontuação, desempate por recência) é o único usado para compor a resposta - nunca uma lista de "também relacionado", que se mostrou instável (uma única palavra em comum bastava para produzir respostas compostas e confusas) e foi deliberadamente descartada em favor de uma resposta única e clara.

Quando nada tem sobreposição alguma (pergunta vaga, sem palavra-chave própria), a resposta degrada graciosamente para o fato mais recente - exatamente o comportamento já homologado antes deste bloco -, em vez de recusar-se a responder.

## 12. Continuidade Através de Processos Separados

Como cada invocação do Sebastian é um processo novo, a continuidade só é possível através do mesmo arquivo de memória já homologado (`FileMemoryStore`/`FileCommandContextHydrator`). O exemplo do pedido:

```
processo 1: "Sebastian, lembra que o projeto Sebastian IA está na fase de memória
             inteligente, SPEC-044 foi homologada"
             → grava um fato, como já acontecia

processo 2: "Sebastian, vamos continuar meu projeto de ontem"
             → resumptionReference → busca por relevância → encontra o fato acima
             → 'Retomando de onde paramos: você registrou "...".'
             → esta própria resposta também é gravada como um turno de conversa

processo 3: "Então continua"
             → continuationReference → usa o turno mais recente (o do processo 2)
             → 'Continuando de onde paramos: Retomando de onde paramos: ...'
```

Nenhum estado em memória de processo é compartilhado entre os três - tudo passa pelo arquivo de memória, pelo mesmo hidratador, pela mesma janela limitada (`MAX_HYDRATED_RECENT_EXCHANGES = 8`) já usada para fatos e tarefas.

## 13. Diferenciação de Intenção

Cobertura mínima e determinística, sem NLU completo: pergunta (`"?"` ou início interrogativo), continuação curta e genérica, retomada nomeada de projeto/tarefa, e solicitação de ação (inteiramente coberta pelos reconhecimentos já existentes de fatos/tarefas/filesystem/Git/validações/executor, que continuam tendo prioridade). "Retomada" e "continuação" são deliberadamente distintas: a primeira nomeia um assunto ("projeto", "tarefa", "trabalho") e é resolvida por relevância; a segunda não nomeia nada e é resolvida pelo turno mais recente, o que só faz sentido tratá-las como categorias separadas.

## 14. Limites e Segurança

- `recentExchanges` hidratado é sempre limitado a `MAX_HYDRATED_RECENT_EXCHANGES = 8` turnos, nunca o histórico inteiro;
- a seleção de memória relevante é sempre limitada a no máximo 3 candidatos, e a resposta final usa apenas 1;
- `memoryExtras` nunca é interpretado por `Core` além de "objeto simples, mesclar no write-back" - um valor inválido é ignorado silenciosamente, nunca propagado ao usuário nem ao processo;
- nenhum conteúdo de arquivo, stdout ou diff bruto passa a ser persistido por este bloco - `conversationTurn.summary` é sempre derivado de campos já estruturados e curtos;
- zero rede, zero credencial, zero dependência externa nova.

## 15. Critérios de Aceitação

- uma pergunta com mais de um fato disponível responde com o fato realmente relacionado à pergunta, não com o mais recente;
- "vamos continuar meu projeto de ontem" recupera e usa, sem o usuário chamar `recall`, o fato mais relacionado a esse projeto - em um processo separado do que gravou o fato;
- "então continua", em um terceiro processo separado, responde à luz do que o segundo processo acabou de responder;
- uma referência de continuação sem nenhum turno anterior disponível informa isso claramente, em vez de adivinhar;
- o `finalResult`/resposta ao usuário de toda capacidade já homologada permanece byte-a-byte igual a antes deste bloco;
- nenhum conteúdo bruto/grande (stdout, diff, arquivo inteiro) passa a ser persistido;
- todos os testes, build e typecheck permanecem verdes; zero custo de API, zero rede, zero credencial.

## 16. Estratégia de Testes

Unitários: `ConversationContextComposer` (classificação de intenção nos quatro casos, seleção por relevância vs. recência, teto de 3 candidatos, ausência de sobreposição, determinismo, validação de entrada); `SebastianCore` (o seam `memoryExtras` mesclado apenas no write-back, nunca na resposta; um `memoryExtras` inválido ignorado com segurança); `FileCommandContextHydrator` (reconstrução de `recentExchanges` a partir de `output.conversationTurn`, registros sem esse campo ignorados, campos malformados ignorados sem crash, ordenação cronológica, teto de janela, convivência com fatos/tarefas); `DevelopmentModelProvider` (seleção do fato relevante em vez do mais recente, retomada usando memória relevante, retomada sem memória disponível, continuação usando o turno mais recente, continuação sem turno disponível, degradação graciosa para pergunta vaga, ausência de regressão nos reconhecimentos determinísticos já homologados); `InMemorySpecializedAgent` (turno de conversa anexado como `memoryExtras` e nunca ao `finalResult`, resumo correto por tipo de decisão, ausência de turno para `remember`/`addTask`/`completeTask`, ausência de turno em handoff falho, encaminhamento de `recentExchanges` ao `ModelProvider`). Integração: o vertical slice completo de retomada→continuação entre instâncias `SebastianCore`/`SebastianApplication` separadas compartilhando `dataDir`, seleção de fato relevante, ausência de vazamento de `memoryExtras`/`conversationTurn` na resposta ao usuário. Ponta a ponta por subprocessos reais: o mesmo vertical slice de retomada→continuação e de seleção de memória relevante através de processos CLI realmente distintos, e regressão completa das capacidades já homologadas (greeting, remember/recall rígidos, tarefas, workspace, filesystem, Git, validações, executor de desenvolvimento orquestrado).

## 17. Justificativa Arquitetural

Este bloco não introduz um "motor de memória" separado, nem um segundo pipeline paralelo ao `Core → Memory hydration → Capability → Agent → ModelProvider → Tool` já homologado. Ele reaproveita integralmente o mecanismo de write-back/hydration existente (mesmo arquivo, mesmo `FileMemoryStore`, mesmo hidratador) para uma única categoria de memória genuinamente nova, e acrescenta um segundo seam de write-back (`memoryExtras`) seguindo exatamente o mesmo padrão estrutural do primeiro (`finalResult`), sem nunca dar a Core conhecimento de domínio. A "compreensão" e a "decisão contextual" continuam deterministicas e locais - um componente pequeno e testável isoladamente (`ConversationContextComposer`) que só entra em jogo depois que todo reconhecimento determinístico já homologado teve a chance de agir primeiro. Nenhuma abstração nova (DAG, fila, banco vetorial, framework de workflow) foi criada além do estritamente necessário para este comportamento.

## Status

Implementada e homologada.
