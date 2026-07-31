# SPEC-017 - Command Capability Binding

## 1. Contexto

A arquitetura atual ja possui os componentes centrais para executar capabilities de forma previsivel:

Core
  -> Command Processor
  -> Capability Provisioning Contract
  -> Capability Registry
  -> Capability Resolver
  -> Capability Handler
  -> Result

A SPEC-014 definiu a execucao de capability, a SPEC-015 definiu o registry de descriptors e handlers, e a SPEC-016 definiu o provisionamento deterministico do registry.

Apos essas etapas, permanece uma lacuna objetiva: ainda nao existe um contrato explicito e padronizado para vincular um tipo de comando valido a uma capability registrada.

Sem esse contrato, a decisao de qual capability executar tende a ficar espalhada na camada chamadora, elevando acoplamento e risco de inconsistencias.

---

## 2. Motivacao

A proxima evolucao natural e consolidar o elo entre comando processado e capability invocada, sem introduzir roteamento heuristico, workflow ou inteligencia semantica.

Problemas resolvidos por esta SPEC:

- ausencia de fonte unica para mapeamento command type -> capabilityId;
- risco de regras ad-hoc no Core para selecionar capability;
- menor auditabilidade sobre por que um comando aciona determinada capability;
- maior chance de divergencia entre contratos de comando e catalogo de capabilities.

A proposta preserva as fronteiras existentes: Command Processor continua validando comando e compondo contexto, Capability Resolver continua executando handler, e o Core continua apenas orquestrando.

---

## 3. Objetivo

Definir uma camada minima e explicita de binding entre comandos e capabilities que:

- mantenha um mapeamento declarativo de command type para capabilityId;
- forneca resolucao deterministica sem heuristica;
- valide consistencia minima dos bindings;
- permita verificacao antecipada de bindings invalidos durante bootstrap;
- preserve operacao sincrona, imutavel e sem estado global oculto;
- lance erros tipados compativeis com o Error Core em falhas de contrato.

---

## 4. Escopo

### Escopo desta SPEC

Criar o contrato de Command Capability Binding com:

- estrutura declarativa para binding de command type e capabilityId;
- validacao de contrato minimo dos bindings;
- resolucao de capabilityId por command type;
- listagem imutavel de bindings;
- validacao de duplicidade de command type;
- validacao de consistencia minima com o catalogo exportado pelo Capability Registry.

### Escopo do MVP

O MVP deve suportar, no minimo:

- registrar um binding valido;
- rejeitar command type duplicado;
- resolver capabilityId de forma deterministica por command type;
- falhar de forma explicita quando nao houver binding para o command type;
- operar sem dependencias externas e sem descoberta automatica.

---

## 5. Fora do escopo

Esta SPEC nao inclui:

- execucao de capabilities;
- validacao semantica de payload de comando;
- roteamento por heuristica, scoring ou inferencia;
- workflow de multiplos passos;
- carregamento automatico de plugins;
- controle de lifecycle de plugins;
- persistencia em banco ou arquivo;
- cache distribuido;
- filas, retries ou processamento distribuido;
- IA, LLM, embeddings, RAG;
- alteracoes dinamicas do binding em runtime apos bootstrap;
- definicao da SPEC-018.

---

## 6. Responsabilidades

### Command Capability Binding

Responsavel por:

- armazenar bindings declarativos de command type para capabilityId;
- validar consistencia estrutural dos bindings;
- resolver capabilityId com base em command type;
- expor consulta e listagem previsiveis;
- permitir verificacao explicita de consistencia com o catalogo de capabilities.

Nao responsavel por:

- executar handlers;
- montar contexto de comando;
- controlar lifecycle de plugins;
- provisionar capabilities;
- orquestrar fluxo fim a fim.

### Core

Permanece responsavel por:

- coordenar o fluxo geral;
- solicitar resolucao de capabilityId para command type;
- acionar o Capability Resolver com invocation e catalogo.

### Command Processor

Permanece responsavel por:

- validar comando;
- compor contexto;
- produzir resultado de processamento unitario sem executar capability.

### Capability Registry

Permanece responsavel por:

- manter descriptors e handlers provisionados;
- expor catalogo para o Resolver.

### Capability Resolver

Permanece responsavel por:

- validar invocation;
- resolver handler no catalogo;
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
Capability Registry
  |
  v
Capability Resolver
  |
  v
Capability Handler

### Diretriz arquitetural

Esta camada adiciona apenas o contrato de vinculacao entre comando e capability. Ela nao substitui registry, resolver, provisioning ou plugin lifecycle.

---

## 8. Fluxos

### Fluxo 1 - Bootstrap de bindings

1. Core recebe lista declarativa de bindings.
2. Camada de binding valida estrutura e duplicidade de command type.
3. Camada de binding valida consistencia minima com catalogo de capabilities.
4. Mapa de bindings e publicado em modo somente leitura.

### Fluxo 2 - Resolucao para execucao

1. Command Processor produz comando validado com command type.
2. Core solicita capabilityId ao Command Capability Binding.
3. Core monta invocation e consulta catalogo no Capability Registry.
4. Core chama CapabilityResolver.invoke com invocation e catalogo.
5. Resolver executa fluxo da SPEC-014 sem alteracoes de responsabilidade.

### Fluxo 3 - Falha de binding

1. command type nao possui binding ou aponta para capability ausente.
2. Camada de binding lanca erro tipado.
3. Core trata falha sem conversao silenciosa para sucesso.

---

## 9. API publica

A API publica deve ser minima e explicita.

### 9.1 Estrutura de binding

CommandCapabilityBinding
- commandType: string
- capabilityId: string

### 9.2 Operacoes propostas

- resolveCapabilityId(commandType: string): string
- has(commandType: string): boolean
- listBindings(): readonly CommandCapabilityBinding[]
- validateAgainstCatalog(catalog: readonly CapabilityDescriptor[]): void

### 9.3 Erros previstos

- InvalidCommandCapabilityBindingError
- CommandCapabilityBindingNotFoundError
- DuplicateCommandCapabilityBindingError
- CommandCapabilityBindingConsistencyError

---

## 10. Regras

### Regras de contrato

- commandType deve ser string nao vazia;
- capabilityId deve ser string nao vazia;
- cada commandType deve ser unico no conjunto;
- lista de bindings deve ser valida e explicita.

### Regras de consistencia

- todo capabilityId de binding deve existir no catalogo validado;
- um binding inconsistente deve bloquear o fluxo de inicializacao;
- falhas devem ser explicitas e tipadas.

### Regras de determinismo

- mesma entrada de bindings deve gerar mesmo estado observavel;
- resolucao por commandType deve ser estavel;
- nao usar heuristicas ocultas, relogio interno ou aleatoriedade.

### Regras de fronteira

- nao executar capability na camada de binding;
- nao inferir intent ou semantica;
- nao absorver responsabilidades de Command Processor, Registry ou Resolver;
- nao transformar Core em componente de mapeamento ad-hoc.

---

## 11. Criterios de aceitacao

A implementacao desta SPEC sera considerada adequada quando:

- existir contrato explicito de binding command type -> capabilityId;
- bindings duplicados por commandType forem rejeitados;
- resolucao por commandType for deterministica;
- inconsistencia com catalogo de capabilities for rejeitada com erro tipado;
- listagem retornada for imutavel e previsivel;
- fluxo de execucao da SPEC-014 permanecer inalterado;
- nao houver ampliacao para workflow, IA, persistencia, filas ou heuristicas.

---

## 12. Estrategia de testes

A implementacao futura deve incluir testes permanentes cobrindo, no minimo:

- criacao com binding valido;
- rejeicao de commandType invalido;
- rejeicao de capabilityId invalido;
- rejeicao de duplicidade de commandType;
- resolveCapabilityId para commandType existente;
- falha tipada para commandType inexistente;
- validacao de consistencia contra catalogo valido;
- rejeicao de consistency check para capabilityId ausente no catalogo;
- imutabilidade das estruturas retornadas;
- determinismo para mesma sequencia de entradas.

---

## 13. Riscos

Principais riscos:

- transformar binding em roteador com heuristicas;
- duplicar validacoes que pertencem ao Command Processor ou Resolver;
- acoplamento excessivo ao Core;
- crescimento de escopo para workflow ou decisao inteligente.

Mitigacoes:

- manter API estrita e declarativa;
- preservar fronteiras explicitas entre modulos;
- limitar a responsabilidade a mapeamento deterministico;
- falhar cedo em contratos invalidos.

---

## 14. Criterios de homologacao

A SPEC-017 sera homologada quando:

- a implementacao aderir integralmente a esta especificacao;
- testes permanentes da SPEC-017 passarem sem falhas;
- npm test passar sem falhas;
- npm run build passar sem falhas;
- npm run typecheck passar sem falhas;
- exports publicos estiverem consistentes com arquitetura e fronteiras;
- documentacao final estiver alinhada ao comportamento implementado.

---

## 15. Justificativa objetiva da sequencia arquitetural

A SPEC-017 e a proxima evolucao natural apos a SPEC-016 porque fecha a lacuna imediata entre comando validado e capability invocada, por meio de um contrato declarativo de vinculacao sem heuristica.

A SPEC-013 definiu processamento de comando, a SPEC-014 definiu execucao de capability, a SPEC-015 definiu o registry e a SPEC-016 definiu o provisionamento. A SPEC-017 completa o elo que faltava para conectar essas camadas de forma previsivel, incremental e sem antecipar funcionalidades de fases posteriores.

## Status

Implementada - aguardando homologacao
