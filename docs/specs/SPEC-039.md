# SPEC-039 - Conversação Natural com Agent Inteligente e ModelProvider Substituível

## 1. Contexto

A SPEC-038 entregou a primeira capacidade persistente real do Sebastian IA (`remember`/`recall`), reaproveitando os contratos de memória homologados nas SPEC-034/035. Até ali, toda interação continuava presa a comandos rígidos (`greeting`, `remember`, `recall`), cada um mapeado estaticamente a exatamente uma capability, sem qualquer interpretação de linguagem natural.

A VISION do projeto exige que o Sebastian "conversе naturalmente" e "lembre informações importantes" sem depender de sintaxe fixa. O pipeline homologado (Core → Memory hydration → Capability → Agent → Tool → Memory write-back) já previa, desde a SPEC-036, que o Agent seria o responsável por decidir e delegar responsabilidades - mas sua implementação concreta (`InMemorySpecializedAgent`) permanecia um pass-through puro, e o `Core.executeCommand()` descartava integralmente o output do handoff do Agent (o método correspondente tinha retorno `void`), o que impedia qualquer decisão do Agent de influenciar a resposta final ou a memória persistida.

Esta SPEC entrega, como uma única unidade funcional, a infraestrutura necessária para conversação natural: um contrato substituível de `ModelProvider`, uma implementação determinística de desenvolvimento (`DevelopmentModelProvider`, zero custo, zero rede), a capacidade do Agent de efetivamente influenciar o resultado retornado e persistido, a evolução mínima de assincronismo necessária para isso, uma nova capability `converse` deliberadamente sem inteligência própria, e a generalização cirúrgica do reconhecimento de fatos de memória para aceitar registros produzidos fora do comando rígido `remember`.

---

## 2. Objetivo

Permitir que o usuário interaja em linguagem natural via CLI (`sebastiania "Sebastian, lembra que prefiro reuniões de manhã"`) e receba, em uma execução posterior separada, uma resposta coerente baseada na memória persistida (`sebastiania "Qual horário eu prefiro para reuniões?"`), com a interpretação de intenção feita pelo Agent através de um `ModelProvider` substituível, sem qualquer custo de API nesta fase.

---

## 3. Escopo

Entregue como bloco único, sem divisão em micro-SPECs:

- contrato `ModelProvider` (Promise-based, dependência do Agent, nunca do Core);
- `DevelopmentModelProvider`: implementação local, determinística, zero custo;
- evolução Promise-based da fronteira `SpecializedAgent.handoff()` e do `Core.executeCommand()`, estritamente limitada à cadeia que efetivamente precisa dela;
- propagação opt-in e validada do resultado efetivo do Agent (`finalResult`) para a resposta ao usuário e para o write-back;
- capability `cap.converse` (commandType `converse`), deliberadamente sem interpretação própria;
- entrada de texto livre pela CLI (fallback de roteamento);
- generalização cirúrgica do `FileCommandContextHydrator` com regra estrutural explícita para reconhecer fatos de memória produzidos fora do comando `remember`;
- composição/wiring necessário em `CorePipelineBootstrap` e `SebastianApplication`;
- testes unitários, de integração e por subprocessos reais.

---

## 4. Fora do Escopo

- LLM real, Claude API, OpenAI API ou qualquer provider pago;
- API key real, rede, assinatura, cobrança por token;
- RAG, embeddings, banco vetorial, memória semântica ou classificação inteligente;
- Supabase, sincronização em nuvem, UI, web;
- Gmail, calendário, acesso ao PC, shell, Git;
- Tools externas reais ou execução de comandos do sistema;
- múltiplos agentes, autonomia, automações;
- conversão para assíncrono de Capability, Memory ou Tool sem necessidade objetiva (permanecem síncronos nesta entrega);
- alteração de comportamento de `greeting`, `remember` ou `recall`.

---

## 5. Responsabilidade Funcional Única

Fazer o Agent já homologado (SPEC-036) cumprir sua responsabilidade real de decisão para a responsabilidade de conversação, usando um `ModelProvider` substituível e determinístico nesta fase, com o resultado dessa decisão efetivamente alcançando o usuário e a memória persistida - sem criar um pipeline paralelo e sem que o Core conheça o fornecedor de IA, a intenção conversacional específica ou qualquer vocabulário de linguagem natural.

---

## 6. Por que o Agent não influenciava o resultado (achado arquitetural)

`Core.executeCommand()` calculava o `CapabilityResult` a partir da capability **antes** de chamar `specializedAgent.handoff()`, e o método correspondente (`handoffToSpecializedAgent`) tinha retorno `void` - apenas validava o status do handoff, nunca devolvia nada que pudesse substituir o resultado já calculado. Essa era uma limitação de fato, não uma interpretação equivocada: o Agent existia estruturalmente, mas sua decisão nunca alcançava a resposta ao usuário nem o write-back.

---

## 7. Evolução Promise-based (menor cadeia necessária)

Convertidos para `Promise`, e apenas estes:

- `core/agent/SpecializedAgentHandoffContract.ts` — `SpecializedAgent.handoff()`;
- `core/agent/InMemorySpecializedAgent.ts` — implementação;
- `core/core.ts` — `SebastianCore.executeCommand()` e o `handoffToSpecializedAgent` interno;
- `application/LocalCommandInvocation.ts` — `LocalCommandInvocationAdapter.execute()` / `runLocalCommand()`;
- `application/cli.ts` — aguarda o resultado antes de definir `process.exitCode`.

`CommandProcessor`, todo `core/capability/*` (incluindo o tipo `CapabilityHandler` e todos os handlers, inclusive `converse`), `core/memory/*` (SPEC-034/035) e `core/tool/*` (SPEC-037) permanecem inteiramente síncronos - o `ModelProvider` é consultado exclusivamente dentro do Agent, depois da execução da capability, então nada abaixo dela precisa saber de Promises.

---

## 8. Propagação opt-in do resultado do Agent

`Core` passa a reconhecer, de forma genérica e estrutural - nunca acoplada a um `commandType` específico -, uma chave reservada `finalResult` no output de sucesso do handoff do Agent:

- ausente: comportamento idêntico ao anterior à SPEC-039 (resultado da capability é o efetivo);
- presente e um objeto plano válido: substitui o `output` do resultado efetivo, usado tanto na resposta ao chamador quanto no write-back;
- presente e estruturalmente inválido (`null`, array, tipo primitivo): rejeitado com erro tipado (`CoreSpecializedAgentFinalResultInvalidError`), impedindo que um valor corrompido contamine o pipeline.

---

## 9. Regra estrutural para fatos de memória

`FileCommandContextHydrator` passa a reconhecer um fato de memória por dois caminhos explícitos, nunca por inferência frágil de forma:

1. **Caminho legado (preservado integralmente)**: `commandType === 'remember'` com `output.fact` string - comportamento idêntico, byte a byte, ao da SPEC-038.
2. **Caminho marcado (novo)**: `output.memoryRecordKind === 'sebastian.memory.fact'` com `output.content` string, independentemente do `commandType` que produziu o registro.

Um registro nunca é tratado como memória apenas por conter uma propriedade parecida com `fact`; o discriminador precisa casar exatamente. Isso permite que `converse` participe da mesma memória sem migrar, apagar ou duplicar `memory.json`, e sem criar um segundo sistema de memória.

---

## 10. Agent: responsabilidade de conversação

`InMemorySpecializedAgent` recebe uma dependência opcional de `ModelProvider`. Quando a responsabilidade recebida é `converse` (identificada pelo `commandType`, já presente no contrato de handoff) e um `ModelProvider` foi injetado, o Agent:

- extrai o texto livre e os fatos já hidratados do payload de handoff;
- consulta `modelProvider.interpret(...)`;
- traduz a decisão em `finalResult` (`{memoryRecordKind, content}` para memorizar, `{message}` para responder);
- **não invoca o Tool** - não há efeito externo a delegar, e a SPEC-037 é interpretada nesta entrega como "no máximo uma invocação quando necessária", não "obrigatoriamente uma invocação".

Para `greeting`, `remember` e `recall`, o Agent mantém exatamente o comportamento pass-through anterior (invoca o Tool, nunca popula `finalResult`) - nenhum deles passa a depender do `ModelProvider`.

---

## 11. Fluxo ponta a ponta

```
sebastiania "Sebastian, lembra que prefiro reuniões de manhã"
  → CLI: nenhum comando rígido casa → fallback roteia para commandType "converse"
  → Core hidrata contexto (rememberedFacts, se houver)
  → capability "converse" apenas repassa {text}, sem interpretar
  → Core → Agent.handoff() → ModelProvider.interpret() (DevelopmentModelProvider)
  → decisão: intent=remember → finalResult={memoryRecordKind:'sebastian.memory.fact', content:'...'}
  → Core adota finalResult como resultado efetivo → write-back persiste sob commandType="converse"
  → processo termina

sebastiania "Qual horário eu prefiro para reuniões?"
  → novo processo, mesmo roteamento para "converse"
  → Core hidrata: FileCommandContextHydrator reconhece o registro marcado do processo anterior
  → capability repassa {text}
  → Agent → ModelProvider.interpret() → intent=respond, resposta usando o fato hidratado
  → finalResult={message:'Sobre isso, você registrou: "prefiro reuniões de manhã".'}
  → Core adota, devolve ao usuário e persiste via write-back
```

---

## 12. Invariantes

- Core nunca importa nem referencia `ModelProvider`, fornecedor de IA ou vocabulário de linguagem natural;
- a adoção de `finalResult` é genérica, nunca condicionada a `commandType === 'converse'`;
- `greeting`, `remember` e `recall` continuam funcionando sem qualquer dependência de `ModelProvider`;
- nenhuma memória existente é migrada, apagada ou reescrita;
- nenhum contrato de Capability, Memory (SPEC-034/035) ou Tool (SPEC-037) é alterado em sua forma;
- zero dependência externa, zero chamada de rede, zero credencial de IA.

---

## 13. Critérios de Aceitação

- `sebastiania "Sebastian, lembra que ..."` persiste um fato reconhecível por uma execução separada;
- `sebastiania "Qual horário eu prefiro para reuniões?"`, em processo novo, produz resposta baseada na memória persistida;
- `greeting`, `remember` e `recall` continuam funcionando sem regressão de comportamento;
- `finalResult` ausente preserva o comportamento anterior à SPEC-039 em todos os fluxos existentes;
- `finalResult` estruturalmente inválido é rejeitado com erro tipado;
- todos os testes, build e typecheck permanecem verdes;
- zero custo de API, zero chamada de rede, zero credencial.

---

## 14. Estratégia de Testes

- unitários: `DevelopmentModelProvider` (extração de intenção, fallback, validação), `LocalConverseCapabilityProvider`, `FileCommandContextHydrator` (ambos os caminhos de reconhecimento, regressão do caminho legado), `InMemorySpecializedAgent` (caminho de conversação com e sem `ModelProvider`, pass-through preservado);
- integração: `Core.executeCommand()` adotando/rejeitando `finalResult`, composição via `CorePipelineBootstrap`/`SebastianApplication` com `converse` habilitado;
- ponta a ponta por subprocessos reais: dois processos `spawnSync` distintos e isolados (um memoriza, outro responde usando a memória), além de regressão dos comandos rígidos existentes pelo mesmo mecanismo.

---

## 15. Justificativa Arquitetural

Esta SPEC não introduz uma nova fronteira nem um pipeline paralelo. Ela corrige uma limitação objetiva e específica do `Core` (o descarte incondicional do output do Agent) através da menor mudança suficiente para que o contrato do Agent, já homologado na SPEC-036, cumpra a responsabilidade de decisão que sempre lhe foi atribuída. A evolução para Promise é restrita exatamente aos módulos que precisam dela. O `ModelProvider` é, desde o desenho do contrato, substituível por um provider real futuro sem exigir mudanças em Core, Memory, Capability ou Tool.

## Status

Implementada e homologada
