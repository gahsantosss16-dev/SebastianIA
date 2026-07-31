# SPEC-021 - Capability Execution Gateway

## 1. Contexto

A arquitetura atual ja possui os componentes necessarios para preparar e validar a execucao de capabilities:

Core
  -> Command Processor
  -> Command Capability Binding
  -> Capability Invocation Composer
  -> Capability Execution Bundle Builder
  -> Capability Execution Preflight Validator
  -> Capability Resolver
  -> Capability Handler
  -> Result

As SPECs 019 e 020 consolidaram duas partes criticas:

- validacao preflight da invocation contra catalogo;
- construcao de execution bundle coerente (catalog + handlersById).

Apos a SPEC-020, permanece a lacuna arquitetural imediata: ainda nao existe uma camada explicita que execute, de forma unificada e deterministica, o fluxo preflight + resolver usando o mesmo bundle.

Sem essa camada, o Core tende a compor esse encadeamento manualmente em cada ponto chamador, aumentando acoplamento e risco de divergencia de fluxo.

---

## 2. Motivacao

Sem um gateway de execucao dedicado, surgem riscos objetivos:

- orquestracao ad-hoc do fluxo preflight -> invoke em multiplos pontos;
- chance de usar catalogo diferente entre preflight e resolver;
- aumento de acoplamento do Core a detalhes operacionais de capability;
- menor auditabilidade do caminho final de execucao.

A evolucao incremental natural apos a SPEC-020 e introduzir uma camada minima de gateway que padronize o fluxo de execucao protegido, sem assumir responsabilidades de binding, composicao, provisionamento ou lifecycle.

---

## 3. Objetivo

Definir uma camada minima e explicita de Capability Execution Gateway que:

- receba invocation e execution bundle;
- execute preflight obrigatorio antes do invoke;
- execute resolver usando o mesmo bundle validado;
- devolva resultado de capability em fluxo deterministico;
- mantenha operacao sincrona, previsivel e sem estado global oculto;
- lance erros tipados compativeis com o Error Core em falhas de entrada ou execucao.

---

## 4. Escopo

### Escopo desta SPEC

Criar o contrato de Capability Execution Gateway com:

- API publica minima para executar invocation protegida;
- validacao de entrada invocation e bundle;
- encadeamento deterministico preflight -> resolver;
- garantia de uso do mesmo catalogo entre preflight e invoke;
- retorno de resultado estruturado do resolver;
- isolamento de responsabilidade sem invadir fronteiras dos demais modulos.

### Escopo do MVP

O MVP deve suportar, no minimo:

- execucao de invocation valida com bundle valido;
- falha tipada quando bundle for invalido;
- falha tipada quando preflight reprovar a invocation;
- falha tipada quando resolver falhar;
- comportamento deterministico para mesma entrada.

---

## 5. Fora do escopo

Esta SPEC nao inclui:

- resolucao de commandType para capabilityId;
- composicao de invocation;
- construcao do execution bundle;
- provisionamento de capabilities;
- controle de lifecycle de plugins;
- workflow de multiplos passos;
- persistencia em banco ou arquivo;
- cache distribuido;
- filas, retries ou processamento distribuido;
- IA, LLM, embeddings, RAG;
- politicas dinamicas de roteamento;
- definicao da SPEC-022.

---

## 6. Responsabilidades

### Capability Execution Gateway

Responsavel por:

- validar entrada minima de invocation e bundle;
- chamar preflight validator com invocation e catalogo do bundle;
- chamar resolver com invocation, catalogo e handlers do mesmo bundle;
- devolver CapabilityResult de execucao bem-sucedida;
- propagar falhas tipadas sem conversao silenciosa.

Nao responsavel por:

- executar binding commandType -> capabilityId;
- compor invocation;
- construir ou atualizar bundle;
- executar handler diretamente fora do resolver;
- orquestrar fluxo fim a fim de comando.

### Core

Permanece responsavel por:

- coordenar o fluxo geral;
- obter invocation e bundle das camadas adequadas;
- acionar o gateway para execucao da capability.

### Capability Execution Bundle Builder

Permanece responsavel por:

- construir bundle coerente e imutavel de execucao.

### Capability Execution Preflight Validator

Permanece responsavel por:

- validar prontidao da invocation contra catalogo.

### Capability Resolver

Permanece responsavel por:

- resolver handler e executar capability.

---

## 7. Arquitetura

### Posicao na arquitetura

Core (coordenacao)
  |
  v
Capability Execution Gateway
  |
  +-> Capability Execution Preflight Validator
  |
  +-> Capability Resolver
        ^
        |
Execution Bundle (catalog + handlersById)

### Diretriz arquitetural

O gateway padroniza o fluxo protegido de execucao sem substituir o Core como coordenador e sem absorver responsabilidades de builder, preflight ou resolver.

---

## 8. Fluxos

### Fluxo 1 - Execucao bem-sucedida

1. Core envia invocation e execution bundle para o gateway.
2. Gateway valida contrato minimo de entrada.
3. Gateway executa preflight com invocation e catalog do bundle.
4. Gateway executa resolver com invocation e o mesmo catalog/handlers do bundle.
5. Gateway retorna CapabilityResult ao Core.

### Fluxo 2 - Falha de preflight

1. Invocation ou catalog nao atende contrato minimo.
2. Preflight lanca erro tipado.
3. Gateway propaga a falha.
4. Resolver nao e chamado.

### Fluxo 3 - Falha de resolver

1. Preflight aprova a invocation.
2. Resolver falha durante resolucao/execucao.
3. Gateway propaga erro tipado sem mascaramento.

---

## 9. API publica

A API publica deve ser minima e explicita.

### 9.1 Operacao central

- execute(invocation: CapabilityInvocation, bundle: CapabilityExecutionBundle): CapabilityResult

### 9.2 Erros previstos

- InvalidCapabilityExecutionGatewayInputError
- CapabilityExecutionGatewayError

Observacao:
Erros de preflight e resolver devem ser propagados conforme seus contratos originais, sem conversao para sucesso.

---

## 10. Regras

### Regras de contrato

- invocation deve ser objeto valido;
- bundle deve conter catalog e handlersById validos;
- catalog usado no preflight deve ser o mesmo usado no invoke;
- gateway nao altera invocation nem bundle recebidos.

### Regras de determinismo

- para mesma invocation e mesmo bundle, o comportamento deve ser identico;
- ordem do fluxo e fixa: preflight sempre antes de resolver;
- nao usar estado global oculto, relogio proprio ou aleatoriedade.

### Regras de imutabilidade

- gateway nao deve expor nem mutar estado interno de preflight/resolver;
- entradas devem ser tratadas como leitura.

### Regras de fronteira

- gateway nao substitui o Core;
- gateway nao executa binding, composer ou builder;
- gateway nao implementa workflow, retries ou fallback heuristico.

---

## 11. Criterios de aceitacao

A implementacao desta SPEC sera considerada adequada quando:

- existir modulo explicito de Capability Execution Gateway;
- execute aplicar preflight antes do invoke em todos os casos;
- execute reutilizar o mesmo catalog do bundle no preflight e no resolver;
- resultado bem-sucedido retornar CapabilityResult compativel com a SPEC-014;
- falhas de entrada, preflight ou resolver forem propagadas de forma tipada;
- comportamento for deterministico e sem estado proprio;
- fronteiras arquiteturais existentes forem preservadas;
- nao houver ampliacao para workflow, IA, persistencia, filas ou fases futuras.

---

## 12. Estrategia de testes

A implementacao futura deve incluir testes permanentes cobrindo, no minimo:

- execucao bem-sucedida com invocation e bundle validos;
- rejeicao de invocation invalida na entrada do gateway;
- rejeicao de bundle invalido na entrada do gateway;
- garantia de que preflight e chamado antes do resolver;
- garantia de que resolver nao e chamado quando preflight falha;
- propagacao de erro tipado de preflight;
- propagacao de erro tipado de resolver;
- uso do mesmo catalog no preflight e no invoke;
- determinismo para entradas identicas;
- ausencia de mutacao de invocation e bundle.

---

## 13. Riscos

Principais riscos:

- duplicar responsabilidades de orquestracao do Core;
- transformar gateway em workflow engine;
- acoplamento excessivo com implementacoes concretas internas;
- introducao de comportamento nao deterministico no fluxo.

Mitigacoes:

- manter API estrita e unica de execucao protegida;
- preservar sequencia fixa preflight -> resolver;
- tratar gateway como coordenador local de capability, nao sistêmico;
- propagar erros tipados sem fallback oculto.

---

## 14. Criterios de homologacao

A SPEC-021 sera homologada quando:

- a implementacao aderir integralmente a esta especificacao;
- testes permanentes da SPEC-021 passarem sem falhas;
- npm test passar sem falhas;
- npm run build passar sem falhas;
- npm run typecheck passar sem falhas;
- exports publicos estiverem consistentes com arquitetura e fronteiras;
- documentacao final estiver alinhada ao comportamento implementado.

---

## 15. Justificativa objetiva da sequencia arquitetural

A SPEC-021 e a proxima evolucao natural apos a SPEC-020 porque fecha a lacuna imediata de execucao protegida unificada sobre o mesmo execution bundle.

A SPEC-020 garante como o pacote catalog + handlersById e construido e validado; a SPEC-021 define como esse mesmo pacote e consumido de forma padronizada no caminho preflight -> resolver. Assim, a arquitetura evolui incrementalmente, mantendo fronteiras e sem antecipar funcionalidades de fases futuras.

## Status

Implementada - aguardando homologacao
