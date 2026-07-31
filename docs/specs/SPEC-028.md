# SPEC-028 - Core Command Operational Readiness Gate

## 1. Contexto

A SPEC-027 estabeleceu o bootstrap operacional unico do Core na ordem `compose -> create -> initialize -> start`, retornando uma instancia pronta para `executeCommand(input)`.

O bootstrap garante o caminho nominal de criacao, mas o contrato publico do `SebastianCore` ainda pode ser acessado diretamente. A presenca de dependencias de pipeline, isoladamente, nao garante que a instancia tenha concluido `initialize()` e `start()`, nem que continue operacional apos `shutdown()`.

Existe, portanto, uma lacuna no limite de admissao de comandos: `executeCommand(input)` precisa rejeitar execucao quando o Core nao estiver integralmente pronto.

---

## 2. Objetivo

Definir a regra unica de prontidao operacional para admissao de comandos no Core, garantindo que `executeCommand(input)` somente delegue ao pipeline quando a instancia:

- concluiu `initialize()`;
- concluiu `start()`;
- nao foi encerrada;
- esta com status `ready`;
- possui dependencias de pipeline validas.

---

## 3. Escopo

Esta SPEC define:

- validacao de prontidao no limite publico de `executeCommand`;
- falha tipada quando o Core nao estiver operacional;
- precedencia da prontidao sobre a delegacao ao executor;
- preservacao do comportamento nominal da instancia retornada pela SPEC-027.

O MVP deve rejeitar comandos:

- antes de `initialize()`;
- depois de `initialize()` e antes de `start()`;
- quando `start()` ocorrer sem inicializacao previa;
- depois de `shutdown()`;
- quando o status nao for `ready`.

---

## 4. Fora do Escopo

Esta SPEC nao inclui:

- mudancas no comportamento de `initialize()`, `start()` ou `shutdown()`;
- redesign do lifecycle ou do `LifecycleManager`;
- alteracoes no pipeline `process -> adapt -> execute`;
- mudancas na composicao ou no bootstrap operacional;
- filas, retries, concorrencia, cancelamento ou recuperacao automatica;
- UI, Supabase, banco, rede, IA, LLM, memoria, RAG ou integracoes externas;
- alteracoes de ROADMAP;
- definicao da SPEC-029.

---

## 5. Responsabilidades Arquiteturais

### 5.1 SebastianCore

Passa a ser responsavel por verificar seu proprio estado operacional antes de delegar um comando.

Permanece responsavel por:

- validar o contrato de entrada;
- validar as dependencias do pipeline;
- delegar ao executor;
- propagar falhas tipadas.

Nao assume:

- composicao de dependencias;
- ativacao automatica;
- recuperacao de estado;
- logica interna do pipeline.

### 5.2 Bootstrap Operacional

Permanece responsavel por criar e ativar o Core na ordem homologada. Nenhuma regra da SPEC-027 e duplicada ou movida para `executeCommand`.

---

## 6. Fluxo

Fluxo nominal:

1. Core recebe `executeCommand(input)`.
2. Core valida o contrato de entrada.
3. Core valida a prontidao operacional.
4. Core valida a disponibilidade das dependencias.
5. Core delega ao executor e retorna `CapabilityResult`.

Fluxo de rejeicao:

1. Core detecta estado nao operacional.
2. Core lanca erro tipado de prontidao.
3. Executor nao e chamado.
4. Nenhum resultado parcial e produzido.

---

## 7. Contrato de Prontidao

Uma instancia esta pronta para comandos somente quando todas as condicoes forem verdadeiras:

- `lifecycleState.initialized === true`;
- `lifecycleState.started === true`;
- `lifecycleState.shutDown === false`;
- `status === 'ready'`.

As condicoes sao cumulativas. Nenhuma condicao isolada autoriza execucao.

---

## 8. Tratamento de Erros

- estado nao operacional deve lancar erro tipado especifico do limite do Core;
- a falha deve ocorrer antes da chamada ao executor;
- proibido inicializar ou iniciar automaticamente como fallback;
- proibido converter rejeicao em sucesso parcial;
- erros do pipeline continuam sendo propagados conforme a SPEC-025 quando o Core estiver pronto.

---

## 9. Invariantes

- dependencias validas nao substituem prontidao de lifecycle;
- status `ready` isolado nao substitui `initialize()` e `start()`;
- `shutdown()` revoga a admissao de novos comandos;
- rejeicoes nao alteram o estado do Core nem o input;
- o gate nao executa, adapta ou recompõe o pipeline;
- a instancia retornada pela SPEC-027 continua apta a executar comandos.

---

## 10. Criterios de Aceitacao

A implementacao sera adequada quando:

- comandos forem aceitos somente no estado operacional completo;
- estados pre-inicializacao, intermediario e pos-shutdown forem rejeitados tipadamente;
- o executor nao for chamado em rejeicoes;
- o estado e o input permanecerem inalterados;
- o bootstrap da SPEC-027 continuar produzindo uma instancia funcional;
- nenhuma responsabilidade interna do pipeline ou lifecycle for alterada.

---

## 11. Estrategia de Testes

Testes permanentes devem cobrir:

- rejeicao antes de `initialize()`;
- rejeicao entre `initialize()` e `start()`;
- rejeicao de `start()` sem inicializacao previa;
- rejeicao depois de `shutdown()`;
- rejeicao quando status nao for `ready`;
- executor nao chamado em estado invalido;
- ausencia de mutacao do input e do estado em rejeicoes;
- execucao nominal no estado pronto;
- compatibilidade real com o bootstrap da SPEC-027;
- determinismo da decisao para o mesmo estado.

---

## 12. Riscos e Mitigacoes

Riscos:

- duplicar o lifecycle dentro do gate;
- permitir `ready` como unica condicao;
- alterar o fluxo interno do pipeline;
- ativar o Core implicitamente.

Mitigacoes:

- limitar o gate a leitura das condicoes homologadas;
- exigir todas as condicoes cumulativamente;
- rejeitar antes da delegacao;
- manter lifecycle e pipeline inalterados.

---

## 13. Criterios de Homologacao

A SPEC-028 sera homologada quando:

- o gate operacional estiver implementado no limite de `executeCommand`;
- os testes permanentes da SPEC-028 passarem;
- `npm test` passar;
- `npm run build` passar;
- `npm run typecheck` passar;
- as SPECs 025, 026 e 027 permanecerem aderentes aos seus contratos.

---

## 14. Justificativa da Sequencia Arquitetural

A SPEC-027 garante como obter uma instancia pronta. A SPEC-028 torna essa prontidao uma invariante efetiva na operacao publica de comandos, inclusive quando o Core for acessado fora do bootstrap nominal.

Essa responsabilidade pertence ao proprio Core, que e o unico proprietario de seu estado operacional e o limite publico de `executeCommand`. Nao exige nova camada e encerra a discrepancia entre estar configurado e estar efetivamente pronto.

---

## Status

Implementada - aguardando homologacao
