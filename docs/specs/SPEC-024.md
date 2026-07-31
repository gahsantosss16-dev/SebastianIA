# SPEC-024 - Command Capability Pipeline Executor

## 1. Contexto

A arquitetura atual ja possui os modulos necessarios para cada etapa isolada do fluxo de comando para capability:

Core
  -> Command Processor
  -> Command Processing Result Adapter
  -> Command Capability Execution Coordinator
  -> Result

As SPECs recentes consolidaram:

- processamento deterministico de comando (SPEC-013);
- coordenacao local de execucao de capability (SPEC-022);
- adaptacao contratual entre processamento e execucao (SPEC-023).

Apos a SPEC-023, permanece a lacuna arquitetural imediata: ainda nao existe uma camada explicita para executar, em um unico ponto, o pipeline local completo process -> adapt -> execute para uma unidade de comando, mantendo contrato unico de entrada e saida para o Core.

Sem essa camada, o Core tende a montar esse encadeamento manualmente em cada chamador, aumentando acoplamento e risco de divergencia de fluxo.

---

## 2. Motivacao

Sem um executor dedicado do pipeline local de comando para capability, surgem riscos objetivos:

- repeticao de orquestracao process -> adapt -> execute no Core;
- divergencia de ordem entre etapas em diferentes pontos chamadores;
- menor auditabilidade do caminho command input -> capability result;
- crescimento de acoplamento do Core a detalhes operacionais de integracao.

A evolucao incremental natural apos a SPEC-023 e introduzir uma camada minima de execucao de pipeline local, sem absorver responsabilidades internas de processamento, adaptacao, binding, composicao ou gateway.

---

## 3. Objetivo

Definir uma camada minima e explicita de Command Capability Pipeline Executor que:

- receba CommandProcessingInput e CapabilityExecutionBundle;
- execute CommandProcessor.process;
- execute CommandProcessingResultAdapter.adapt;
- execute CommandCapabilityExecutionCoordinator.execute;
- devolva CapabilityResult final de forma deterministica;
- propague falhas tipadas sem conversao silenciosa.

---

## 4. Escopo

### Escopo desta SPEC

Criar o contrato de Command Capability Pipeline Executor com:

- API publica minima para execucao do pipeline local completo;
- encadeamento fixo process -> adapt -> execute;
- validacao estrutural minima de entrada do executor;
- reutilizacao de bundle fornecido externamente;
- comportamento deterministico para mesma entrada.

### Escopo do MVP

O MVP deve suportar, no minimo:

- execucao completa bem-sucedida para entrada valida;
- propagacao tipada de erro do Command Processor;
- propagacao tipada de erro do Adapter;
- propagacao tipada de erro do Coordinator;
- rejeicao tipada para entrada invalida no executor.

---

## 5. Fora do escopo

Esta SPEC nao inclui:

- alteracao de contratos internos do Command Processor;
- alteracao de contratos internos do Adapter;
- alteracao de contratos internos do Coordinator;
- construcao de execution bundle;
- workflow de multiplos passos;
- persistencia em banco ou arquivo;
- cache distribuido;
- filas, retries ou processamento distribuido;
- IA, LLM, embeddings, RAG;
- alteracoes da SPEC-023;
- definicao da SPEC-025.

---

## 6. Responsabilidades

### Command Capability Pipeline Executor

Responsavel por:

- receber entrada de processamento de comando e execution bundle;
- chamar process no Command Processor;
- chamar adapt no Command Processing Result Adapter;
- chamar execute no Command Capability Execution Coordinator;
- retornar CapabilityResult final quando bem-sucedido;
- propagar falhas tipadas de dependencias e de contrato de entrada.

Nao responsavel por:

- implementar processamento de comando;
- implementar transformacao de resultado;
- implementar binding, composicao, preflight ou resolver;
- construir bundle;
- substituir o Core como coordenador sistemico.

### Core

Permanece responsavel por:

- coordenar fluxo geral da aplicacao;
- fornecer dependencias necessarias;
- acionar o executor de pipeline local;
- tratar sucesso e falha no nivel sistemico.

### Command Processor

Permanece responsavel por:

- processar entrada de comando.

### Command Processing Result Adapter

Permanece responsavel por:

- adaptar resultado de processamento para entrada de execucao.

### Command Capability Execution Coordinator

Permanece responsavel por:

- executar binding -> composer -> gateway com entrada ja adaptada.

---

## 7. Arquitetura

### Posicao na arquitetura

Core (coordenacao)
  |
  v
Command Capability Pipeline Executor
  |
  +-> Command Processor
  |
  +-> Command Processing Result Adapter
  |
  +-> Command Capability Execution Coordinator
          ^
          |
Execution Bundle (catalog + handlersById)

### Diretriz arquitetural

O executor encapsula apenas o encadeamento local do pipeline de comando para capability. Ele nao substitui o Core nem absorve responsabilidades internas de cada modulo dependente.

---

## 8. Fluxos

### Fluxo 1 - Execucao bem-sucedida

1. Core envia CommandProcessingInput e execution bundle ao executor.
2. Executor chama CommandProcessor.process.
3. Executor chama CommandProcessingResultAdapter.adapt.
4. Executor chama CommandCapabilityExecutionCoordinator.execute.
5. Executor retorna CapabilityResult ao Core.

### Fluxo 2 - Falha de processamento

1. Entrada invalida ou tipo nao suportado no processamento.
2. Command Processor lanca erro tipado.
3. Executor propaga a falha.
4. Adapter e Coordinator nao sao chamados.

### Fluxo 3 - Falha de adaptacao ou execucao

1. Processamento conclui com sucesso.
2. Adapter falha por contrato invalido, ou Coordinator falha durante execucao.
3. Executor propaga erro tipado sem mascaramento.

---

## 9. API publica

A API publica deve ser minima e explicita.

### 9.1 Operacao central

- execute(input: CommandProcessingInput, bundle: CapabilityExecutionBundle): CapabilityResult

### 9.2 Erros previstos

- InvalidCommandCapabilityPipelineInputError
- CommandCapabilityPipelineExecutorError

Observacao:
Erros tipados de Processor, Adapter e Coordinator devem ser propagados conforme seus contratos originais.

---

## 10. Regras

### Regras de contrato

- input deve ser compativel com CommandProcessingInput;
- bundle deve ser valido conforme contrato da SPEC-020;
- ordem de execucao deve ser fixa: process -> adapt -> execute;
- executor nao altera input nem bundle recebidos.

### Regras de determinismo

- para mesma entrada e mesmo bundle, o comportamento deve ser identico;
- nao usar estado global oculto, relogio proprio ou aleatoriedade;
- nao aplicar heuristicas de roteamento no executor.

### Regras de fronteira

- executor nao substitui Core;
- executor nao substitui Command Processor;
- executor nao substitui Adapter;
- executor nao substitui Coordinator.

---

## 11. Criterios de aceitacao

A implementacao desta SPEC sera considerada adequada quando:

- existir modulo explicito de Command Capability Pipeline Executor;
- execute aplicar exatamente a ordem process -> adapt -> execute;
- resultado bem-sucedido retornar CapabilityResult compativel com SPEC-014;
- falhas de Processor, Adapter e Coordinator forem propagadas de forma tipada;
- entradas invalidas forem rejeitadas com erro tipado;
- comportamento for deterministico e sem estado proprio;
- fronteiras arquiteturais das SPECs 013, 022 e 023 forem preservadas;
- nao houver ampliacao para workflow, IA, persistencia, filas ou fases futuras.

---

## 12. Estrategia de testes

A implementacao futura deve incluir testes permanentes cobrindo, no minimo:

- execucao bem-sucedida do pipeline completo;
- garantia da ordem process antes de adapt;
- garantia da ordem adapt antes de execute;
- garantia de que adapter nao e chamado quando processor falha;
- garantia de que coordinator nao e chamado quando adapter falha;
- propagacao de erro tipado do processor;
- propagacao de erro tipado do adapter;
- propagacao de erro tipado do coordinator;
- rejeicao de entrada invalida do executor;
- determinismo para entradas identicas;
- ausencia de mutacao de input e bundle.

---

## 13. Riscos

Principais riscos:

- duplicar papel de coordenacao sistemica do Core;
- transformar executor em workflow engine;
- acoplamento excessivo a detalhes concretos de modulos internos;
- ampliacao indevida para politicas de controle de fluxo.

Mitigacoes:

- manter API unica e estrita de execucao local de pipeline;
- preservar ordem fixa sem heuristicas;
- depender apenas de contratos publicos existentes;
- propagar erros tipados sem fallback oculto.

---

## 14. Criterios de homologacao

A SPEC-024 sera homologada quando:

- a implementacao aderir integralmente a esta especificacao;
- testes permanentes da SPEC-024 passarem sem falhas;
- npm test passar sem falhas;
- npm run build passar sem falhas;
- npm run typecheck passar sem falhas;
- exports publicos estiverem consistentes com arquitetura e fronteiras;
- documentacao final estiver alinhada ao comportamento implementado.

---

## 15. Justificativa objetiva da sequencia arquitetural

A SPEC-024 e a proxima evolucao natural apos a SPEC-023 porque fecha a lacuna imediata de execucao unificada do pipeline local completo entre entrada de comando e resultado de capability.

As SPECs 013, 022 e 023 definem os modulos do pipeline em partes, mas ainda nao formalizam um contrato unico para encadear process -> adapt -> execute em um ponto padronizado, sem repeticao ad-hoc no Core. A SPEC-024 introduz exatamente essa responsabilidade unica, de forma incremental e sem antecipar fases futuras.

## Status

Implementada - aguardando homologacao