# SPEC-018 - Capability Invocation Composer

## 1. Contexto

A arquitetura atual ja possui os blocos essenciais para o fluxo de execucao de capability:

Core
  -> Command Processor
  -> Command Capability Binding
  -> Capability Provisioning Contract
  -> Capability Registry
  -> Capability Resolver
  -> Capability Handler
  -> Result

A SPEC-013 definiu o processamento de comando.
A SPEC-014 definiu a execucao da capability via resolver.
A SPEC-015 definiu o registry de descriptors e handlers.
A SPEC-016 definiu o provisionamento deterministico do registry.
A SPEC-017 definiu o vinculo deterministico entre command type e capabilityId.

Apos a SPEC-017, permanece uma lacuna natural: a composicao da CapabilityInvocation ainda tende a ficar distribuida na camada chamadora, sem um contrato minimo e explicito para transformar a saida do Command Processor em entrada valida para o Capability Resolver.

---

## 2. Motivacao

Sem uma camada dedicada de composicao de invocation, surgem riscos objetivos:

- montagem ad-hoc de invocation no Core;
- inconsistencias de formato entre diferentes fluxos de comando;
- validacoes duplicadas ou incompletas antes do resolver;
- menor auditabilidade do caminho command -> invocation.

A evolucao incremental natural e introduzir um modulo estritamente de composicao estrutural, sem executar capability, sem decidir roteamento e sem assumir responsabilidades de orquestracao.

---

## 3. Objetivo

Definir uma camada minima e explicita de composicao de invocation que:

- receba entrada estruturada derivada do Command Processor e do binding;
- produza CapabilityInvocation valida e deterministica;
- aplique validacoes estruturais minimas do contrato de composicao;
- preserve imutabilidade dos dados de entrada e saida;
- mantenha operacao sincrona e sem estado global oculto;
- lance erros tipados compativeis com o Error Core em falhas de composicao.

---

## 4. Escopo

### Escopo desta SPEC

Criar o contrato de Capability Invocation Composer com:

- API publica minima para compor invocation;
- estrutura explicita de entrada de composicao;
- validacao de campos obrigatorios para composicao;
- output estritamente compativel com CapabilityInvocation da SPEC-014;
- comportamento deterministico para mesma entrada;
- isolacao de responsabilidade em relacao ao Core e aos demais modulos.

### Escopo do MVP

O MVP deve suportar, no minimo:

- composicao de invocation a partir de commandType, capabilityId, payload e contexto;
- reaproveitamento de generatedAt fornecido pela camada chamadora;
- rejeicao de entrada invalida com erro tipado;
- retorno de objeto imutavel e previsivel;
- ausencia de dependencias externas.

---

## 5. Fora do escopo

Esta SPEC nao inclui:

- execucao de capability;
- resolucao de handler;
- consulta direta ao Capability Registry;
- roteamento de comandos;
- inferencia semantica de payload;
- workflow de multiplos passos;
- carregamento automatico de plugins;
- controle de lifecycle de plugins;
- persistencia em banco ou arquivo;
- cache distribuido;
- filas, retries ou processamento distribuido;
- IA, LLM, embeddings, RAG;
- alteracoes dinamicas de politica de composicao em runtime;
- definicao da SPEC-019.

---

## 6. Responsabilidades

### Capability Invocation Composer

Responsavel por:

- receber dados estruturados de composicao;
- validar contrato minimo da entrada de composicao;
- construir CapabilityInvocation valida;
- retornar objeto de saida sem referencias mutaveis internas;
- falhar de forma explicita com erros tipados.

Nao responsavel por:

- executar capability;
- resolver descriptor ou handler;
- manter catalogo de capabilities;
- decidir command type ou capabilityId;
- orquestrar fluxo fim a fim.

### Core

Permanece responsavel por:

- coordenar os modulos no fluxo;
- obter commandType processado;
- obter capabilityId pelo Command Capability Binding;
- acionar o composer para gerar invocation;
- chamar CapabilityResolver.invoke com invocation e catalogo.

### Command Processor

Permanece responsavel por:

- validar comando;
- compor contexto;
- produzir resultado previsivel de processamento unitario.

### Command Capability Binding

Permanece responsavel por:

- mapear command type para capabilityId;
- validar consistencia de bindings.

### Capability Registry

Permanece responsavel por:

- expor catalogo e handlers provisionados.

### Capability Resolver

Permanece responsavel por:

- validar invocation;
- resolver handler;
- executar capability e devolver resultado.

---

## 7. Arquitetura

### Posicao na arquitetura

Core (coordenacao)
  |
  v
Command Processor
  |
  v
Command Capability Binding
  |
  v
Capability Invocation Composer
  |
  v
Capability Registry
  |
  v
Capability Resolver
  |
  v
Capability Handler

### Diretriz arquitetural

O composer e um adaptador estrutural entre processamento de comando e execucao de capability. Ele nao substitui o Core, nao substitui o binding e nao substitui o resolver.

---

## 8. Fluxos

### Fluxo 1 - Composicao de invocation

1. Command Processor conclui o processamento e disponibiliza dados estruturados.
2. Core resolve capabilityId pelo Command Capability Binding.
3. Core envia dados de composicao ao Capability Invocation Composer.
4. Composer valida entrada e gera CapabilityInvocation.
5. Core envia invocation para CapabilityResolver.invoke junto ao catalogo.

### Fluxo 2 - Falha de composicao

1. Entrada de composicao invalida e recebida pelo composer.
2. Composer interrompe o fluxo.
3. Erro tipado de composicao e lancado.
4. Core trata a falha sem conversao silenciosa para sucesso.

### Fluxo 3 - Determinismo

1. Duas entradas de composicao identicas sao fornecidas.
2. Composer gera invocations equivalentes.
3. Nao ha dependencia de estado interno, relogio proprio ou aleatoriedade.

---

## 9. API publica

A API publica deve ser minima e explicita.

### 9.1 Estrutura de entrada

CapabilityInvocationInput
- capabilityId: string
- input: Readonly<Record<string, unknown>>
- context: Readonly<Record<string, unknown>>
- generatedAt: string

### 9.2 Operacao central

- compose(input: CapabilityInvocationInput): CapabilityInvocation

### 9.3 Erros previstos

- InvalidCapabilityInvocationInputError
- CapabilityInvocationCompositionError

---

## 10. Regras

### Regras de contrato

- capabilityId deve ser string nao vazia;
- input deve ser objeto valido;
- context deve ser objeto valido;
- generatedAt deve ser string nao vazia fornecida pela camada chamadora;
- composer nao deve alterar a entrada recebida.

### Regras de determinismo

- mesma entrada deve produzir mesma invocation;
- ordem de campos e estrutura observavel devem ser estaveis;
- nao utilizar estado global oculto, relogio proprio ou aleatoriedade.

### Regras de imutabilidade

- saida nao deve expor referencias mutaveis internas;
- mudancas externas na entrada nao devem afetar invocations ja compostas.

### Regras de fronteira

- composer nao consulta registry diretamente;
- composer nao resolve binding;
- composer nao executa resolver nem handler;
- Core continua exclusivamente como orquestrador do fluxo.

---

## 11. Criterios de aceitacao

A implementacao desta SPEC sera considerada adequada quando:

- houver modulo explicito para composicao de CapabilityInvocation;
- a operacao compose gerar estrutura compativel com a SPEC-014;
- entradas invalidas forem rejeitadas com erro tipado;
- comportamento for deterministico para mesma entrada;
- imutabilidade da saida for preservada;
- fronteiras entre Core, Binding, Registry e Resolver permanecerem intactas;
- nao houver ampliacao para workflow, IA, persistencia, filas ou heuristicas.

---

## 12. Estrategia de testes

A implementacao futura deve incluir testes permanentes cobrindo, no minimo:

- composicao bem-sucedida com entrada valida;
- rejeicao de capabilityId invalido;
- rejeicao de input invalido;
- rejeicao de context invalido;
- rejeicao de generatedAt invalido;
- verificacao de estrutura compativel com CapabilityInvocation;
- determinismo para entradas identicas;
- imutabilidade da invocation retornada;
- ausencia de mutacao da entrada original;
- compatibilidade de integracao com CapabilityResolver.invoke.

---

## 13. Riscos

Principais riscos:

- duplicar responsabilidades do Command Processor ou Resolver;
- acoplar composer ao registry ou ao binding;
- transformar composer em camada de decisao semantica;
- crescimento de escopo para orquestracao de workflow.

Mitigacoes:

- manter API estrita focada em composicao estrutural;
- preservar fronteiras explicitas entre modulos;
- impedir heuristicas e inferencias no composer;
- falhar cedo em violacoes de contrato.

---

## 14. Criterios de homologacao

A SPEC-018 sera homologada quando:

- a implementacao aderir integralmente a esta especificacao;
- testes permanentes da SPEC-018 passarem sem falhas;
- npm test passar sem falhas;
- npm run build passar sem falhas;
- npm run typecheck passar sem falhas;
- exports publicos estiverem consistentes com arquitetura e fronteiras;
- documentacao final estiver alinhada ao comportamento implementado.

---

## 15. Justificativa objetiva da sequencia arquitetural

A SPEC-018 e a proxima evolucao natural apos a SPEC-017 porque fecha a lacuna imediata de adaptacao estrutural entre comando processado e invocation executavel.

A SPEC-017 define qual capability deve ser acionada; a SPEC-018 define como a invocation deve ser composta de forma padronizada e deterministica antes da chamada ao resolver. Assim, a arquitetura continua incremental, com fronteiras preservadas e sem antecipar funcionalidades de fases futuras.

## Status

Implementada - aguardando homologacao
