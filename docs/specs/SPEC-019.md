# SPEC-019 - Capability Execution Preflight Validator

## 1. Contexto

A arquitetura atual ja possui os componentes essenciais para processar comandos e executar capabilities:

Core
  -> Command Processor
  -> Command Capability Binding
  -> Capability Invocation Composer
  -> Capability Registry
  -> Capability Resolver
  -> Capability Handler
  -> Result

A SPEC-017 consolidou o vinculo deterministico entre command type e capabilityId.
A SPEC-018 consolidou a composicao deterministica de CapabilityInvocation.

Apos a SPEC-018, permanece uma lacuna arquitetural imediata: nao existe uma camada dedicada e explicita para validar, antes da execucao, a consistencia entre invocation composta e catalogo efetivo de capabilities.

Hoje, parte dessa falha aparece apenas no momento de invoke do resolver. Falta um contrato preflight claro para validacao antecipada e governada, sem transferir responsabilidades para o Core.

---

## 2. Motivacao

Sem um preflight validator explicito, existem riscos objetivos:

- validacoes estruturais dispersas em pontos diferentes do fluxo;
- deteccao tardia de inconsistencias (somente no invoke);
- menor auditabilidade do estado de prontidao da execucao;
- acoplamento do Core a verificacoes ad-hoc de consistencia.

A evolucao incremental natural e introduzir uma camada minima de validacao pre-execucao, sem executar handlers, sem orquestrar fluxo e sem alterar responsabilidades de binding, composer, registry ou resolver.

---

## 3. Objetivo

Definir uma camada minima e explicita de preflight que:

- valide consistencia entre CapabilityInvocation e catalogo declarativo;
- confirme existencia da capability alvo antes do invoke;
- valide integridade minima do descriptor selecionado;
- forneca resultado deterministico de prontidao de execucao;
- preserve comportamento sincrono, imutavel e sem estado global oculto;
- lance erros tipados compativeis com o Error Core quando houver violacoes.

---

## 4. Escopo

### Escopo desta SPEC

Criar o contrato de Capability Execution Preflight Validator com:

- API publica minima para validacao pre-execucao;
- validacao de entrada de invocation e catalogo em nivel de preflight;
- verificacao de existencia da capabilityId no catalogo;
- verificacao de integridade minima do descriptor correspondente;
- output explicito de prontidao para execucao;
- comportamento deterministico para mesma entrada.

### Escopo do MVP

O MVP deve suportar, no minimo:

- preflight bem-sucedido para invocation e catalogo consistentes;
- falha tipada para capability ausente no catalogo;
- falha tipada para catalogo invalido;
- falha tipada para invocation invalida;
- retorno de resultado imutavel e previsivel.

---

## 5. Fora do escopo

Esta SPEC nao inclui:

- execucao de capability;
- resolucao de handler;
- composicao de invocation;
- resolucao de command type para capabilityId;
- provisionamento do registry;
- alteracao de lifecycle de plugins;
- workflow de multiplos passos;
- persistencia em banco ou arquivo;
- cache distribuido;
- filas, retries ou processamento distribuido;
- IA, LLM, embeddings, RAG;
- alteracoes dinamicas de politica de preflight em runtime;
- definicao da SPEC-020.

---

## 6. Responsabilidades

### Capability Execution Preflight Validator

Responsavel por:

- receber invocation e catalogo para validacao pre-execucao;
- validar contratos minimos de entrada;
- confirmar existencia e integridade minima do descriptor alvo;
- retornar estado explicito de prontidao;
- lançar erros tipados em violacoes de preflight.

Nao responsavel por:

- executar capability;
- resolver handler;
- montar invocation;
- mapear command type para capabilityId;
- orquestrar fluxo fim a fim.

### Core

Permanece responsavel por:

- coordenar as etapas do fluxo;
- acionar preflight antes de chamar o resolver;
- tratar falhas de preflight sem conversao silenciosa para sucesso.

### Command Capability Binding

Permanece responsavel por:

- resolver capabilityId por command type;
- validar consistencia dos bindings.

### Capability Invocation Composer

Permanece responsavel por:

- compor CapabilityInvocation valida.

### Capability Registry

Permanece responsavel por:

- expor catalogo declarativo e handlers provisionados.

### Capability Resolver

Permanece responsavel por:

- executar o invoke e o handler apos preflight valido.

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
Capability Execution Preflight Validator
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

O preflight validator e uma camada de verificacao de prontidao. Nao substitui o resolver e nao duplica composicao, binding ou registry. Seu papel e apenas validar pre-condicoes de execucao.

---

## 8. Fluxos

### Fluxo 1 - Preflight bem-sucedido

1. Core recebe invocation composta e catalogo atual.
2. Preflight validator valida contratos de entrada.
3. Preflight validator confirma descriptor compativel para capabilityId.
4. Preflight retorna resultado de prontidao.
5. Core chama CapabilityResolver.invoke.

### Fluxo 2 - Falha por capability ausente

1. Invocation referencia capabilityId nao presente no catalogo.
2. Preflight validator interrompe o fluxo.
3. Erro tipado de preflight e lancado.
4. Core trata a falha sem chamar o resolver.

### Fluxo 3 - Falha por catalogo ou invocation invalida

1. Entradas invalidas sao fornecidas ao preflight.
2. Preflight validator rejeita a operacao com erro tipado.
3. Nenhuma execucao de capability ocorre.

---

## 9. API publica

A API publica deve ser minima e explicita.

### 9.1 Operacao central

- validate(invocation: CapabilityInvocation, catalog: readonly CapabilityDescriptor[]): CapabilityPreflightResult

### 9.2 Estrutura de retorno

CapabilityPreflightResult
- status: 'ready'
- capabilityId: string
- descriptor: CapabilityDescriptor

### 9.3 Erros previstos

- InvalidCapabilityPreflightInputError
- CapabilityPreflightNotReadyError
- CapabilityPreflightError

---

## 10. Regras

### Regras de contrato

- invocation deve ser objeto valido;
- catalog deve ser array valido;
- capabilityId da invocation deve ser string nao vazia;
- descriptor correspondente deve existir no catalog;
- descriptor correspondente deve possuir id e handlerId validos.

### Regras de determinismo

- mesma invocation e mesmo catalog devem produzir mesmo resultado;
- ordem de validacao deve ser previsivel;
- nao utilizar estado global oculto, relogio proprio ou aleatoriedade.

### Regras de imutabilidade

- resultado nao deve expor referencias mutaveis internas;
- o preflight nao deve alterar invocation nem catalog recebidos.

### Regras de fronteira

- preflight nao executa handler;
- preflight nao substitui validacoes internas do resolver;
- preflight nao realiza composicao de invocation;
- Core continua apenas como orquestrador.

---

## 11. Criterios de aceitacao

A implementacao desta SPEC sera considerada adequada quando:

- existir modulo explicito de preflight validator;
- validate retornar estado ready para entradas consistentes;
- entradas invalidas forem rejeitadas com erro tipado;
- capability ausente no catalogo for rejeitada antes do invoke;
- resultado e comportamento forem deterministicos;
- imutabilidade de entradas e saida for preservada;
- fronteiras entre Core, Binding, Composer, Registry e Resolver permanecerem intactas;
- nao houver ampliacao para workflow, IA, persistencia, filas ou funcionalidades futuras.

---

## 12. Estrategia de testes

A implementacao futura deve incluir testes permanentes cobrindo, no minimo:

- preflight bem-sucedido para invocation valida e catalogo valido;
- rejeicao de invocation invalida;
- rejeicao de catalogo invalido;
- rejeicao de capabilityId ausente no catalogo;
- rejeicao de descriptor invalido no catalogo;
- determinismo para entradas identicas;
- imutabilidade do resultado retornado;
- ausencia de mutacao da invocation original;
- ausencia de mutacao do catalogo original;
- compatibilidade de uso imediatamente antes de CapabilityResolver.invoke.

---

## 13. Riscos

Principais riscos:

- duplicar excessivamente validacoes do resolver;
- acoplar preflight ao registry concreto;
- transformar preflight em orquestrador de fluxo;
- crescimento indevido de escopo para politica dinamica.

Mitigacoes:

- manter API estrita de validacao pre-execucao;
- operar com contratos abstratos (invocation + catalog), sem dependencia concreta;
- preservar fronteiras com responsabilidade unica;
- falhar cedo e de forma tipada.

---

## 14. Criterios de homologacao

A SPEC-019 sera homologada quando:

- a implementacao aderir integralmente a esta especificacao;
- testes permanentes da SPEC-019 passarem sem falhas;
- npm test passar sem falhas;
- npm run build passar sem falhas;
- npm run typecheck passar sem falhas;
- exports publicos estiverem consistentes com arquitetura e fronteiras;
- documentacao final estiver alinhada ao comportamento implementado.

---

## 15. Justificativa objetiva da sequencia arquitetural

A SPEC-019 e a proxima evolucao natural apos a SPEC-018 porque fecha a lacuna imediata de validacao de prontidao antes da execucao.

A SPEC-018 garante como a invocation e composta, mas ainda nao define um contrato dedicado para verificar de forma explicita e antecipada se essa invocation esta apta para execucao com o catalogo atual. A SPEC-019 introduz exatamente essa camada, mantendo evolucao incremental, estritamente arquitetural e sem antecipar fases futuras.

## Status

Implementada - aguardando homologacao
