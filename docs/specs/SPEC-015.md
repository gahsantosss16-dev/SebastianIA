# SPEC-015 — Capability Registry

## 1. Contexto

A Fase 1 — Core Foundation encerrou com os módulos estruturais homologados, incluindo o fluxo:

```text
Core
  → Command Processor
  → Capability Resolver
  → Capability Handler
  → Result
```

Com a SPEC-014, o Capability Resolver passou a depender de um catálogo declarativo externo contendo a associação entre capability e handler. A própria SPEC-014 estabelece explicitamente que a construção desse catálogo não faz parte do Resolver.

Na transição para a Fase 2, a lacuna arquitetural real não é rotear comandos para capabilities, e sim definir uma fonte oficial, explícita e validada para registro e consulta de capabilities executáveis.

---

## 2. Motivação

Sem uma camada própria de registry de capabilities, o sistema fica com as seguintes fragilidades:

- origem do catálogo distribuída e pouco auditável;
- maior risco de duplicação de capabilities e associações inconsistentes de handlers;
- acoplamento do Core a estruturas ad-hoc para montar catálogos;
- baixa extensibilidade para adicionar novas capabilities de forma previsível.

O Capability Registry resolve esse problema fornecendo um ponto único e explícito para registrar e consultar capabilities e seus handlers, sem executar, sem orquestrar e sem assumir lifecycle.

---

## 3. Objetivo

Implementar uma camada mínima no core que:

- registre capabilities e seus handlers associados;
- rejeite registros inválidos ou duplicados;
- permita consulta determinística das capabilities disponíveis;
- forneça ao Capability Resolver uma fonte explícita de resolução;
- mantenha o contrato síncrono, imutável e sem estado implícito global;
- lance erros tipados compatíveis com o Error Core para falhas de registro e consulta.

---

## 4. Escopo

### Escopo desta SPEC

Criar um Capability Registry com:

- registro explícito de capability descriptor e handler;
- validação de contrato mínimo de descriptor e handler;
- consulta por `capabilityId`;
- listagem imutável das capabilities registradas;
- verificação de existência;
- método para exportar catálogo declarativo compatível com a SPEC-014.

### Escopo do MVP

O MVP deve suportar, no mínimo:

- registrar uma capability válida;
- rejeitar duplicidade de `capabilityId`;
- resolver handler por `capabilityId`;
- fornecer catálogo para `CapabilityResolver.invoke(...)`;
- operar de forma determinística e sem dependências externas.

---

## 5. Fora do escopo

Esta SPEC não inclui:

- execução de capability;
- validação semântica de payload;
- roteamento de comandos;
- carregamento automático de plugins;
- descoberta automática;
- controle de lifecycle de plugins;
- persistência em banco ou arquivo;
- cache distribuído;
- filas;
- retries;
- workflow;
- IA, LLM, embeddings, RAG;
- integração externa;
- alterações dinâmicas do Capability Registry após a inicialização do Core;
- definição da SPEC-016.

---

## 6. Princípios arquiteturais

A implementação desta SPEC deve seguir, obrigatoriamente, os seguintes princípios:

1. O Core continua como orquestrador.
2. O Command Processor continua responsável por validação do comando e composição de contexto.
3. O Capability Resolver continua responsável por validar invocation e executar capability.
4. O Plugin Manager continua responsável por lifecycle e disponibilidade de plugins.
5. O Capability Registry não executa handlers.
6. O Capability Registry não controla lifecycle.
7. O Capability Registry não carrega plugins automaticamente.
8. O módulo é síncrono e determinístico.
9. O módulo não usa estado global oculto.
10. Falhas são lançadas como erros tipados compatíveis com o Error Core.

---

## 7. Arquitetura

### Posição na arquitetura

```text
Core (coordenação)

Plugin Manager
  │
  ▼
Capability Registry
  │
  ▼
Capability Resolver
  │
  ▼
Capability Handler
```

### Responsabilidades do Capability Registry

- registrar `CapabilityDescriptor` + `CapabilityHandler`;
- validar entradas de registro;
- impedir duplicidade de `capabilityId`;
- expor consulta e listagem previsíveis;
- fornecer catálogo para o Capability Resolver;
- operar em modo somente leitura após a inicialização do Core.

### Não responsabilidades

- executar capabilities;
- resolver contexto;
- rotear comandos;
- ativar/desativar plugins;
- persistir dados;
- aplicar heurística de seleção.

---

## 8. Fluxo

### Fluxo de registro

1. Camada chamadora fornece descriptor e handler.
2. Registry valida contrato mínimo.
3. Registry verifica duplicidade de `capabilityId`.
4. Registry armazena associação descriptor/handler.
5. Registry confirma registro.

### Fluxo de execução via Resolver

1. Core/Command Processor preparam `CapabilityInvocation`.
2. Core consulta catálogo no Capability Registry.
3. Core passa invocation e catálogo para `CapabilityResolver.invoke(...)`.
4. Resolver valida, resolve handler e executa conforme SPEC-014.

### Fluxo de falha

1. Registro inválido, duplicado ou consulta impossível.
2. Registry lança erro tipado compatível com Error Core.
3. Fluxo chamador trata a falha sem converter em sucesso.

---

## 9. Interfaces públicas

A API pública deve ser mínima e explícita.

### Operações propostas

- `register(descriptor: CapabilityDescriptor, handler: CapabilityHandler): void`
- `getDescriptor(capabilityId: string): CapabilityDescriptor | undefined`
- `getHandler(capabilityId: string): CapabilityHandler | undefined`
- `has(capabilityId: string): boolean`
- `listDescriptors(): readonly CapabilityDescriptor[]`
- `exportCatalog(): readonly CapabilityDescriptor[]`

### Justificativa da API

- cobre registro e consulta sem ampliar escopo;
- mantém compatibilidade direta com o catálogo exigido pela SPEC-014;
- evita misturar responsabilidades com execução, roteamento ou lifecycle;
- preserva comportamento de leitura após inicialização, sem mutações dinâmicas em runtime.

---

## 10. Estruturas

### 10.1 CapabilityDescriptor

Mantém o contrato já definido na SPEC-014:

- `id: string`
- `name: string`
- `version: string`
- `handlerId: string`
- `inputSchema?: Readonly<Record<string, unknown>>`

### 10.2 CapabilityHandler

Mantém o contrato conceitual já definido na SPEC-014:

- recebe `CapabilityInvocation`;
- execução síncrona;
- retorna saída estruturada;
- pode lançar erro tipado.

### 10.3 CapabilityRegistration

Estrutura interna/conceitual do registry:

- `descriptor: CapabilityDescriptor`
- `handler: CapabilityHandler`

### 10.4 Erros específicos

Erros previstos:

- `InvalidCapabilityRegistrationError`
- `CapabilityAlreadyRegisteredError`
- `CapabilityNotFoundError`
- `CapabilityRegistryError`

---

## 11. Regras de validação

O Registry deve validar, no mínimo:

- `descriptor` como objeto válido;
- `id`, `name`, `version` e `handlerId` como strings não vazias;
- `handler` como função invocável;
- `capabilityId` de consulta como string não vazia;
- ausência de duplicidade de `id` no registro;
- consistência mínima entre `descriptor.id` e chave de armazenamento.

Falhas devem interromper a operação e lançar erro tipado.

---

## 12. Regras de imutabilidade e determinismo

O módulo deve garantir que:

- não expõe referências mutáveis internas do registry;
- listagens e catálogos retornados são cópias protegidas;
- a mesma sequência de operações gera o mesmo estado observável;
- não há uso de relógio interno, aleatoriedade ou estado global oculto.

---

## 13. Casos de uso

### Caso 1 — Registro de capability válida

- Registrar descriptor + handler.
- `has(capabilityId)` retorna `true`.
- `exportCatalog()` inclui descriptor registrado.

### Caso 2 — Registro duplicado

- Tentar registrar novo item com mesmo `capabilityId`.
- Resultado: `CapabilityAlreadyRegisteredError`.

### Caso 3 — Consulta de handler para execução

- Registry retorna handler associado ao `capabilityId`.
- Core utiliza esse vínculo para alimentar o fluxo da SPEC-014.

### Caso 4 — Exportação de catálogo para resolução

- Registry exporta catálogo declarativo de capabilities registradas.
- Core repassa o catálogo para `CapabilityResolver.invoke(...)`.

---

## 14. Critérios de aceitação

A implementação desta SPEC será considerada adequada quando:

- o módulo registrar capabilities válidas com handlers válidos;
- registros duplicados forem rejeitados;
- consultas por `capabilityId` forem previsíveis;
- catálogo exportado for compatível com a SPEC-014;
- o módulo não executar capabilities;
- o módulo não controlar lifecycle de plugins;
- o módulo não introduzir persistência, cache, filas ou workflow;
- erros tipados forem lançados em falhas de contrato.

---

## 15. Estratégia de testes

A implementação futura deve incluir testes permanentes cobrindo, no mínimo:

- registro de capability válida;
- rejeição de descriptor inválido;
- rejeição de handler inválido;
- rejeição de duplicidade;
- consulta de descriptor e handler por id;
- listagem e exportação de catálogo;
- isolamento entre instâncias do registry;
- imutabilidade das estruturas retornadas;
- determinismo para sequência idêntica de operações;
- compatibilidade do catálogo exportado com `CapabilityResolver.invoke(...)`.

---

## 16. Riscos

Principais riscos:

- duplicar responsabilidades do Plugin Manager;
- transformar o registry em executor de capabilities;
- introduzir descoberta automática prematura;
- acoplar o registry ao comando/processamento;
- ampliar escopo com persistência e workflow.

Mitigações:

- manter API restrita a registro e consulta;
- preservar separação explícita entre registry, resolver e plugin lifecycle;
- manter entradas declarativas e validação estrita.

---

## 17. Critérios de homologação

A SPEC-015 será homologada quando:

- implementação aderir integralmente a esta especificação;
- `npm test` passar sem falhas;
- `npm run build` passar sem falhas;
- `npm run typecheck` passar sem falhas;
- testes cobrirem os cenários mínimos definidos;
- exports públicos estiverem consistentes com a arquitetura;
- documentação final estiver alinhada com o comportamento implementado.

---

## 18. Conclusão de transição Fase 1 → Fase 2

A transição para a Fase 2 exige o primeiro componente de extensibilidade real após o Capability Resolver: uma fonte explícita e governada de capabilities.

O Capability Registry é esse componente porque:

- resolve a origem do catálogo exigido pela SPEC-014;
- permite crescimento incremental do conjunto de capabilities;
- evita duplicação de responsabilidade com Plugin Manager e Resolver;
- adiciona capacidade arquitetural concreta sem ampliar escopo para workflow, IA ou infraestrutura distribuída.

## Status

Implementada — aguardando homologação