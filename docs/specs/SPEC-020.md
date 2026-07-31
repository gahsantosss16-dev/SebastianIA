# SPEC-020 - Capability Execution Bundle Builder

## 1. Contexto

A arquitetura atual ja possui fluxo explicito para chegar ate a execucao de capability:

Core
  -> Command Processor
  -> Command Capability Binding
  -> Capability Invocation Composer
  -> Capability Execution Preflight Validator
  -> Capability Resolver
  -> Capability Handler
  -> Result

As SPECs 015 a 019 consolidaram:

- fonte declarativa de capabilities (registry);
- provisionamento deterministico de registros;
- binding deterministico commandType -> capabilityId;
- composicao deterministica de invocation;
- validacao preflight entre invocation e catalogo.

Apos a SPEC-019, permanece uma lacuna arquitetural imediata: ainda nao existe contrato explicito para construir e validar, como unidade imutavel, o pacote de execucao do resolver contendo catalogo e mapa de handlers coerentes entre si.

Sem essa camada, a composicao de dependencias do resolver tende a ficar ad-hoc no Core, com risco de inconsistencias entre descriptor.handlerId e handlers realmente disponiveis.

---

## 2. Motivacao

Sem um builder dedicado de execution bundle, surgem riscos objetivos:

- divergencia entre catalogo exportado e mapa de handlers usado pelo resolver;
- falha tardia de resolucao de handler apenas no momento do invoke;
- acoplamento do Core a montagem manual de estruturas internas do resolver;
- menor auditabilidade da prontidao estrutural do ambiente de execucao.

A evolucao incremental natural e introduzir uma camada minima de montagem e validacao de bundle, sem executar capability, sem alterar fluxo de comando e sem assumir orquestracao sistêmica.

---

## 3. Objetivo

Definir uma camada minima e explicita de construction/validation de execution bundle que:

- receba fonte de capabilities provisionadas;
- construa catalogo e mapa de handlers consistentes para o resolver;
- valide coerencia minima entre descriptor e handler associado;
- retorne bundle imutavel e deterministico;
- opere de forma sincrona e sem estado global oculto;
- lance erros tipados compativeis com o Error Core em inconsistencias.

---

## 4. Escopo

### Escopo desta SPEC

Criar o contrato de Capability Execution Bundle Builder com:

- API publica minima para construir bundle de execucao;
- validacao de consistencia entre catalogo e handlers;
- validacao de duplicidade de handlerId no pacote resultante;
- retorno de estrutura imutavel pronta para uso por preflight e resolver;
- comportamento deterministico para mesma fonte de entrada.

### Escopo do MVP

O MVP deve suportar, no minimo:

- extrair catalogo do Capability Registry;
- resolver handler por capabilityId no registry;
- montar mapa de handlers indexado por handlerId;
- falhar explicitamente quando faltar handler para descriptor valido;
- devolver bundle pronto para uso sem dependencias externas.

---

## 5. Fora do escopo

Esta SPEC nao inclui:

- execucao de capability;
- validacao semantica de payload;
- composicao de invocation;
- resolucao de binding commandType -> capabilityId;
- preflight de invocation;
- controle de lifecycle de plugins;
- provisionamento de capabilities;
- persistencia em banco ou arquivo;
- cache distribuido;
- filas, retries ou processamento distribuido;
- workflow de multiplos passos;
- IA, LLM, embeddings, RAG;
- mudancas dinamicas de bundle apos inicializacao do runtime;
- definicao da SPEC-021.

---

## 6. Responsabilidades

### Capability Execution Bundle Builder

Responsavel por:

- construir bundle de execucao a partir de fonte provisionada;
- validar coerencia catalogo <-> handlers;
- garantir estrutura final previsivel e imutavel;
- sinalizar inconsistencias por erros tipados.

Nao responsavel por:

- executar handlers;
- validar commandType;
- compor invocation;
- validar prontidao de invocation;
- orquestrar fluxo fim a fim.

### Core

Permanece responsavel por:

- coordenar bootstrap e execucao;
- solicitar construcao do bundle;
- disponibilizar bundle para preflight e resolver.

### Capability Registry

Permanece responsavel por:

- armazenar descriptors e handlers provisionados;
- expor catalogo e handlers para consulta.

### Capability Execution Preflight Validator

Permanece responsavel por:

- validar invocation contra catalogo do bundle.

### Capability Resolver

Permanece responsavel por:

- receber invocation e catalogo;
- localizar handler no mapa fornecido;
- executar capability.

---

## 7. Arquitetura

### Posicao na arquitetura

Core (coordenacao)
  |
  v
Capability Registry
  |
  v
Capability Execution Bundle Builder
  |
  v
Execution Bundle (catalog + handlersById)
  |
  v
Capability Execution Preflight Validator
  |
  v
Capability Resolver
  |
  v
Capability Handler

### Diretriz arquitetural

O builder e uma camada de preparacao estrutural do runtime de capability. Nao substitui registry, preflight ou resolver. Apenas prepara e valida as dependencias compartilhadas de execucao.

---

## 8. Fluxos

### Fluxo 1 - Construir bundle com sucesso

1. Core solicita construcao do bundle ao builder.
2. Builder consulta catalogo no Capability Registry.
3. Builder resolve handlers correspondentes por capabilityId.
4. Builder valida coerencia descriptor.handlerId -> handler disponivel.
5. Builder retorna bundle imutavel para uso no runtime.

### Fluxo 2 - Falha por handler ausente

1. Catalogo contem descriptor sem handler resolvivel no registry.
2. Builder interrompe construcao.
3. Erro tipado de consistencia e lancado.
4. Core bloqueia inicializacao do fluxo de execucao.

### Fluxo 3 - Uso do bundle no runtime

1. Preflight valida invocation contra catalogo do bundle.
2. Resolver usa catalogo e handlersById do mesmo bundle.
3. Execucao ocorre com estruturas coerentes entre si.

---

## 9. API publica

A API publica deve ser minima e explicita.

### 9.1 Operacao central

- build(registry: CapabilityRegistry): CapabilityExecutionBundle

### 9.2 Estrutura de retorno

CapabilityExecutionBundle
- catalog: readonly CapabilityDescriptor[]
- handlersById: ReadonlyMap<string, CapabilityHandler>

### 9.3 Erros previstos

- InvalidCapabilityExecutionBundleInputError
- CapabilityExecutionBundleConsistencyError
- CapabilityExecutionBundleError

---

## 10. Regras

### Regras de contrato

- registry deve ser instancia valida da fonte de capabilities;
- catalog extraido deve ser array valido de descriptors;
- cada descriptor deve possuir id e handlerId validos;
- todo descriptor deve mapear para um handler resolvivel;
- handlerId no bundle deve ser unico e coerente com descriptor associado.

### Regras de determinismo

- mesma entrada de registry deve produzir mesmo bundle observavel;
- ordem do catalogo deve ser estavel;
- nao utilizar estado global oculto, relogio proprio ou aleatoriedade.

### Regras de imutabilidade

- catalog retornado deve ser protegido contra mutacao externa;
- mapa de handlers retornado deve ser somente leitura;
- builder nao altera estado interno do registry.

### Regras de fronteira

- builder nao executa handler;
- builder nao realiza preflight de invocation;
- builder nao resolve commandType;
- Core continua apenas como orquestrador.

---

## 11. Criterios de aceitacao

A implementacao desta SPEC sera considerada adequada quando:

- existir modulo explicito para construcao de execution bundle;
- build retornar catalog e handlersById coerentes para entradas validas;
- inconsistencias catalogo/handler forem rejeitadas com erro tipado;
- bundle retornado for imutavel e deterministico;
- fluxo com preflight e resolver puder reutilizar o mesmo bundle;
- fronteiras entre Core, Registry, Preflight e Resolver permanecerem intactas;
- nao houver ampliacao para workflow, IA, persistencia, filas ou funcionalidades futuras.

---

## 12. Estrategia de testes

A implementacao futura deve incluir testes permanentes cobrindo, no minimo:

- construcao bem-sucedida de bundle a partir de registry valido;
- rejeicao de registry invalido;
- rejeicao de descriptor invalido no catalogo extraido;
- rejeicao de handler ausente para descriptor presente;
- rejeicao de inconsistencias de handlerId;
- determinismo para mesma entrada;
- imutabilidade de catalog e handlersById retornados;
- ausencia de mutacao do estado do registry;
- compatibilidade direta com preflight validator;
- compatibilidade direta com CapabilityResolver.invoke.

---

## 13. Riscos

Principais riscos:

- duplicar responsabilidades do registry ou do resolver;
- acoplar builder a detalhes concretos de orquestracao do Core;
- transformar builder em camada de execucao;
- crescimento indevido de escopo para politicas dinamicas de runtime.

Mitigacoes:

- manter API estrita de montagem e validacao estrutural;
- operar sobre contratos explicitos ja existentes;
- preservar fronteiras com responsabilidade unica;
- falhar cedo com erros tipados em inconsistencias.

---

## 14. Criterios de homologacao

A SPEC-020 sera homologada quando:

- a implementacao aderir integralmente a esta especificacao;
- testes permanentes da SPEC-020 passarem sem falhas;
- npm test passar sem falhas;
- npm run build passar sem falhas;
- npm run typecheck passar sem falhas;
- exports publicos estiverem consistentes com arquitetura e fronteiras;
- documentacao final estiver alinhada ao comportamento implementado.

---

## 15. Justificativa objetiva da sequencia arquitetural

A SPEC-020 e a proxima evolucao natural apos a SPEC-019 porque fecha a lacuna imediata de preparacao coerente das dependencias de execucao do resolver.

As SPECs anteriores definem registro, binding, composicao e preflight, mas ainda nao formalizam a construcao unica e validada do pacote catalog + handlersById usado no runtime. A SPEC-020 introduz exatamente essa responsabilidade, de forma incremental, estritamente arquitetural e sem antecipar fases futuras.

## Status

Implementada - aguardando homologacao
