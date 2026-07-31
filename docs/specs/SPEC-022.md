# SPEC-022 - Command Capability Execution Coordinator

## 1. Contexto

A arquitetura atual ja possui os componentes necessarios para executar capability com seguranca e determinismo:

Core
  -> Command Processor
  -> Command Capability Binding
  -> Capability Invocation Composer
  -> Capability Execution Bundle Builder
  -> Capability Execution Gateway
  -> Result

As SPECs 017 a 021 consolidaram toda a cadeia tecnica de capability:

- binding deterministico commandType -> capabilityId;
- composicao deterministica de CapabilityInvocation;
- preflight e resolver unificados pelo gateway;
- bundle coerente e imutavel para execucao.

Apos a SPEC-021, permanece a lacuna arquitetural imediata: ainda nao existe uma camada explicita para coordenar, em um unico ponto, o encadeamento local binding -> composer -> gateway para uma execucao de comando ja validado.

Sem essa camada, o Core tende a repetir o mesmo encadeamento manualmente em cada fluxo chamador, elevando acoplamento e risco de divergencia operacional.

---

## 2. Motivacao

Sem um coordenador dedicado de execucao de capability por comando, surgem riscos objetivos:

- orquestracao ad-hoc repetida no Core;
- divergencia de ordem entre binding, composicao e gateway;
- menor auditabilidade do caminho commandType -> capability result;
- aumento de pontos de falha por montagem manual recorrente.

A evolucao incremental natural apos a SPEC-021 e introduzir uma camada minima de coordenacao local desse fluxo, sem absorver responsabilidades do Command Processor, do Binding, do Composer, do Bundle Builder ou do Gateway.

---

## 3. Objetivo

Definir uma camada minima e explicita de Command Capability Execution Coordinator que:

- receba dados de comando ja validados e bundle de execucao;
- resolva capabilityId via binding;
- componha invocation via composer;
- execute invocation via gateway;
- devolva CapabilityResult final em fluxo deterministico;
- propague falhas tipadas sem conversao silenciosa.

---

## 4. Escopo

### Escopo desta SPEC

Criar o contrato de Command Capability Execution Coordinator com:

- API publica minima para coordenar o fluxo local;
- encadeamento fixo binding -> composer -> gateway;
- validacao estrutural minima da entrada do coordenador;
- reutilizacao de execution bundle fornecido externamente;
- comportamento deterministico para mesma entrada.

### Escopo do MVP

O MVP deve suportar, no minimo:

- execucao completa bem-sucedida para comando valido e bundle valido;
- propagacao de erro tipado do binding;
- propagacao de erro tipado do composer;
- propagacao de erro tipado do gateway;
- rejeicao tipada para entrada invalida do coordenador.

---

## 5. Fora do escopo

Esta SPEC nao inclui:

- validacao semantica de comando;
- processamento de comando no Command Processor;
- cadastro ou alteracao de bindings;
- construcao de execution bundle;
- execucao direta de resolver ou handler fora do gateway;
- workflow de multiplos passos;
- persistencia em banco ou arquivo;
- cache distribuido;
- filas, retries ou processamento distribuido;
- IA, LLM, embeddings, RAG;
- alteracoes da SPEC-021;
- definicao da SPEC-023.

---

## 6. Responsabilidades

### Command Capability Execution Coordinator

Responsavel por:

- receber commandType, payload, contexto, generatedAt e execution bundle;
- executar resolveCapabilityId no binding;
- executar compose no invocation composer;
- executar execute no capability execution gateway;
- retornar CapabilityResult quando bem-sucedido;
- propagar falhas tipadas de dependencias e de contrato de entrada.

Nao responsavel por:

- validar comando bruto;
- definir ou atualizar bindings;
- construir bundle de execucao;
- executar preflight/resolver diretamente;
- substituir o Core como coordenador sistemico.

### Core

Permanece responsavel por:

- coordenar o fluxo geral da aplicacao;
- acionar o coordenador como dependencia de dominio;
- tratar sucesso e falha no nivel de orquestracao sistemica.

### Command Capability Binding

Permanece responsavel por:

- mapear commandType para capabilityId.

### Capability Invocation Composer

Permanece responsavel por:

- compor CapabilityInvocation valida.

### Capability Execution Gateway

Permanece responsavel por:

- executar preflight -> resolver usando o mesmo bundle.

---

## 7. Arquitetura

### Posicao na arquitetura

Core (coordenacao)
  |
  v
Command Capability Execution Coordinator
  |
  +-> Command Capability Binding
  |
  +-> Capability Invocation Composer
  |
  +-> Capability Execution Gateway
          ^
          |
Execution Bundle (catalog + handlersById)

### Diretriz arquitetural

O coordenador encapsula somente o encadeamento local de capability por comando, sem absorver responsabilidades de processamento de comando nem de orquestracao sistemica do Core.

---

## 8. Fluxos

### Fluxo 1 - Execucao bem-sucedida

1. Core envia entrada de comando ja validada e execution bundle ao coordenador.
2. Coordenador resolve capabilityId via binding.
3. Coordenador compoe invocation via composer.
4. Coordenador executa invocation via gateway.
5. Coordenador retorna CapabilityResult ao Core.

### Fluxo 2 - Falha de binding

1. commandType nao possui binding valido.
2. Binding lanca erro tipado.
3. Coordenador propaga a falha.
4. Composer e gateway nao sao chamados.

### Fluxo 3 - Falha de composer ou gateway

1. Binding resolve capabilityId.
2. Composer falha por entrada invalida, ou gateway falha na execucao.
3. Coordenador propaga erro tipado sem mascaramento.

---

## 9. API publica

A API publica deve ser minima e explicita.

### 9.1 Estrutura de entrada

CommandCapabilityExecutionInput
- commandType: string
- input: Readonly<Record<string, unknown>>
- context: Readonly<Record<string, unknown>>
- generatedAt: string

### 9.2 Operacao central

- execute(input: CommandCapabilityExecutionInput, bundle: CapabilityExecutionBundle): CapabilityResult

### 9.3 Erros previstos

- InvalidCommandCapabilityExecutionInputError
- CommandCapabilityExecutionCoordinatorError

Observacao:
Erros tipados de binding, composer e gateway devem ser propagados conforme seus contratos originais.

---

## 10. Regras

### Regras de contrato

- input do coordenador deve conter commandType, input, context e generatedAt validos;
- bundle deve ser valido conforme contrato da SPEC-020;
- ordem de execucao deve ser fixa: binding -> composer -> gateway;
- coordenador nao altera input nem bundle recebidos.

### Regras de determinismo

- para mesma entrada e mesmo bundle, o comportamento deve ser identico;
- nao usar estado global oculto, relogio proprio ou aleatoriedade;
- o coordenador nao aplica heuristicas de roteamento.

### Regras de fronteira

- coordenador nao substitui Command Processor;
- coordenador nao substitui Gateway;
- coordenador nao executa handler diretamente;
- Core permanece coordenador sistemico.

---

## 11. Criterios de aceitacao

A implementacao desta SPEC sera considerada adequada quando:

- existir modulo explicito de Command Capability Execution Coordinator;
- o metodo execute aplicar exatamente a ordem binding -> composer -> gateway;
- resultado bem-sucedido retornar CapabilityResult compativel com SPEC-014;
- falhas de binding, composer e gateway forem propagadas de forma tipada;
- entradas invalidas forem rejeitadas com erro tipado;
- comportamento for deterministico e sem estado proprio;
- fronteiras arquiteturais de SPEC-017 a SPEC-021 forem preservadas;
- nao houver ampliacao para workflow, IA, persistencia, filas ou fases futuras.

---

## 12. Estrategia de testes

A implementacao futura deve incluir testes permanentes cobrindo, no minimo:

- execucao bem-sucedida do fluxo completo;
- garantia da ordem binding antes de composer;
- garantia da ordem composer antes de gateway;
- garantia de que composer nao e chamado quando binding falha;
- garantia de que gateway nao e chamado quando composer falha;
- propagacao de erro tipado do binding;
- propagacao de erro tipado do composer;
- propagacao de erro tipado do gateway;
- rejeicao de entrada invalida do coordenador;
- determinismo para entradas identicas;
- ausencia de mutacao de input e bundle.

---

## 13. Riscos

Principais riscos:

- duplicar papel de orquestracao sistemica do Core;
- transformar coordenador em workflow engine;
- acoplamento excessivo a detalhes concretos das dependencias;
- ampliacao indevida para politicas de roteamento.

Mitigacoes:

- manter API unica e estrita de coordenacao local;
- preservar ordem fixa e sem heuristicas;
- depender apenas de contratos publicos dos modulos existentes;
- propagar erros tipados sem fallback oculto.

---

## 14. Criterios de homologacao

A SPEC-022 sera homologada quando:

- a implementacao aderir integralmente a esta especificacao;
- testes permanentes da SPEC-022 passarem sem falhas;
- npm test passar sem falhas;
- npm run build passar sem falhas;
- npm run typecheck passar sem falhas;
- exports publicos estiverem consistentes com arquitetura e fronteiras;
- documentacao final estiver alinhada ao comportamento implementado.

---

## 15. Justificativa objetiva da sequencia arquitetural

A SPEC-022 e a proxima evolucao natural apos a SPEC-021 porque fecha a lacuna imediata de coordenacao local do encadeamento binding -> composer -> gateway para comandos ja validados.

As SPECs 017 a 021 definem cada bloco do pipeline de capability, mas ainda nao formalizam um contrato unico para executar esse encadeamento de forma padronizada, sem repeticao ad-hoc no Core. A SPEC-022 introduz exatamente essa responsabilidade unica, de forma incremental e sem antecipar fases futuras.

## Status

Implementada - aguardando homologacao