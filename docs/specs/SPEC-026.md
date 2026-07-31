# SPEC-026 - Core Command Pipeline Bootstrap Composition

## 1. Contexto

A SPEC-025 integrou o contrato de execucao de comando ao Core real por meio de uma operacao publica unica:

Core.executeCommand(input) -> CommandCapabilityPipelineExecutor -> CapabilityResult

A integracao por contrato foi estabelecida e validada, incluindo validacoes de fronteira e propagacao tipada de falhas.

A lacuna arquitetural seguinte da Fase 2 e tornar oficial como o Core recebe dependencias de pipeline em ambiente real, de forma deterministica e repetivel, sem depender de montagem ad-hoc por chamador.

---

## 2. Objetivo

Definir o contrato arquitetural minimo de composicao (bootstrap wiring) das dependencias de comando do Core, garantindo que executor e bundle sejam construidos uma unica vez por fluxo de inicializacao e injetados de forma consistente no Core.

---

## 3. Escopo

### Escopo desta SPEC

Esta SPEC define:

- responsabilidade de composicao das dependencias de pipeline fora do Core;
- contrato de um composer/bootstrap unico para construir executor + bundle;
- regras de determinismo e imutabilidade da composicao;
- regras de falha tipada na etapa de composicao;
- fronteira entre composicao e execucao de comando.

### Escopo do MVP

O MVP deve suportar, no minimo:

- montagem unica de CommandCapabilityPipelineExecutor e CapabilityExecutionBundle;
- injecao dessas dependencias no SebastianCore antes da execucao de comandos;
- rejeicao tipada quando composicao falhar ou produzir contrato invalido;
- resultado deterministico para mesma configuracao de entrada de composicao.

---

## 4. Fora do escopo

Esta SPEC nao inclui:

- alteracoes no fluxo interno process -> adapt -> execute;
- mudancas de comportamento em CommandProcessor, Adapter, Coordinator ou Executor;
- redesign de lifecycle completo do Core;
- integracoes externas (UI, rede, banco, LLM, RAG, Supabase);
- alteracoes de ROADMAP;
- definicao da SPEC-027.

---

## 5. Responsabilidades Arquiteturais

### 5.1 Core

Permanece responsavel por:

- expor executeCommand(input) como ponto unico de execucao;
- validar entrada no limite publico;
- delegar ao executor com bundle ativo;
- propagar falhas tipadas.

Nao assume:

- montagem de registry, bindings, bundle ou executor dentro de executeCommand;
- recomposicao de dependencias por chamada.

### 5.2 Composer/Bootstrap de Pipeline

Passa a ser responsavel por:

- montar e validar CommandCapabilityPipelineExecutor e CapabilityExecutionBundle;
- garantir consistencia entre catalog, handlers e bindings antes da injecao;
- entregar objeto de dependencias pronto para o Core;
- falhar com erros tipados quando contrato de composicao for invalido.

---

## 6. Fluxo Arquitetural

Fluxo principal:

1. Bootstrap recebe configuracao de composicao (providers, bindings e politica local necessaria).
2. Bootstrap constroi registry e bundle validos.
3. Bootstrap constroi coordinator e pipeline executor.
4. Bootstrap devolve CorePipelineDependencies prontas.
5. SebastianCore e instanciado com dependencias compostas.
6. Chamador usa somente executeCommand(input).

Fluxo de falha:

1. Composicao detecta contrato invalido (registry/bundle/bindings/dependencias).
2. Falha tipada e lancada antes da execucao de comando.
3. Core nao inicia caminho operacional com dependencias quebradas.

---

## 7. Contratos

### 7.1 Entrada de composicao

Entrada minima esperada:

- fontes de registro de capabilities (providers ou equivalente homologado);
- mapeamento commandType -> capabilityId;
- configuracao opcional estritamente necessaria para montagem local.

### 7.2 Saida de composicao

Saida obrigatoria:

- CorePipelineDependencies com:
  - executor compatvel com execute(input, bundle);
  - bundle valido e compativel com o pipeline homologado.

### 7.3 Invariantes

- mesma entrada de composicao produz estrutura funcional equivalente;
- dependencias retornadas nao expoem estado mutavel perigoso;
- nenhuma etapa interna do pipeline e pulada ou substituida.

---

## 8. Tratamento de erros

Regras:

- falhas de contrato da composicao devem resultar em erros tipados de bootstrap;
- causas originais devem ser preservadas;
- proibido fallback silencioso para dependencias parciais;
- proibido iniciar caminho de execucao com composicao inconsistente.

Categorias de falha cobertas:

- providers invalidos;
- bindings inconsistentes com catalog;
- bundle invalido;
- executor invalido;
- falhas inesperadas encapsuladas com cause.

---

## 9. Criterios de aceitacao

A implementacao desta SPEC sera considerada adequada quando:

- existir um contrato unico e explicito de composicao para dependencias do Core;
- Core receber dependencias prontas sem recomposicao por chamada;
- composicao falhar tipadamente para contratos invalidos;
- caminho nominal manter compatibilidade com executeCommand da SPEC-025;
- comportamento permanecer deterministico para mesma entrada de composicao;
- nenhuma responsabilidade homologada das SPECs anteriores for alterada.

---

## 10. Estrategia de testes

A implementacao futura deve incluir testes permanentes cobrindo, no minimo:

- composicao bem-sucedida retorna dependencias validas para o Core;
- composicao rejeita providers invalidos;
- composicao rejeita bindings inconsistentes com catalog;
- composicao rejeita bundle/executor invalidos;
- composicao preserva determinismo para mesma entrada;
- Core com dependencias compostas executa comando pelo caminho publico sem regressao de contrato.

---

## 11. Riscos

Principais riscos:

- composicao espalhada em multiplos pontos sem contrato unico;
- acoplamento do Core a detalhes de montagem;
- fallbacks silenciosos produzindo estado operacional parcial.

Mitigacoes:

- centralizar composicao em unidade explicita;
- manter Core focado em delegacao e fronteira publica;
- falhar cedo com erros tipados na montagem.

---

## 12. Criterios de homologacao

A SPEC-026 sera homologada quando:

- contrato de composicao estiver implementado sem alterar responsabilidades anteriores;
- testes permanentes da SPEC-026 passarem sem falhas;
- npm test passar sem falhas;
- npm run build passar sem falhas;
- npm run typecheck passar sem falhas;
- Core continuar aderente ao contrato da SPEC-025.

---

## 13. Justificativa da sequencia arquitetural

A SPEC-026 e a proxima evolucao natural apos a SPEC-025 porque separa definitivamente duas responsabilidades:

- execucao de comando no Core (ja integrada);
- composicao das dependencias operacionais do pipeline (ainda nao formalizada como contrato arquitetural unico).

Sem essa formalizacao, a Fase 2 corre risco de montagem ad-hoc, duplicacao de wiring e inconsistencias de inicializacao entre ambientes.

## Status

Implementada - aguardando homologacao
