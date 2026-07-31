# SPEC-014 — Capability Resolver

## 1. Contexto

O Sebastian IA já consolidou uma infraestrutura modular, explícita e previsível. Após a homologação do Command Processor, a próxima evolução arquitetural natural é introduzir uma camada mínima capaz de resolver uma capability declarada, validar a chamada e direcionar sua execução.

Essa camada não substitui o Core nem assume responsabilidades de orquestração sistêmica. Seu papel é exclusivamente resolver uma capability declarada, validar a chamada associada e encaminhar a execução para um handler compatível, utilizando os módulos já existentes do Core.

A implementação desta SPEC define a arquitetura mínima do Capability Resolver para o MVP, mantendo-o alinhado com os princípios do projeto: modularidade, previsibilidade, baixo acoplamento, determinismo, clareza de responsabilidades e segurança.

---

## 2. Objetivo

Implementar uma camada mínima no core que:

- receba uma capability declarada;
- valide a chamada mínima;
- resolva a capability para um handler compatível;
- encaminhe a execução para o handler apropriado;
- retorne um resultado estruturado quando bem-sucedido;
- lance erros tipados compatíveis com o Error Core quando a execução falhar;
- preserve a divisão de responsabilidades entre Core, Command Processor, Plugin Manager e Capability Resolver.

---

## 3. Princípios arquiteturais

A implementação desta SPEC deve seguir, obrigatoriamente, os seguintes princípios:

1. O Core continua sendo o orquestrador do sistema.
2. O Command Processor continua responsável por validar o comando e compor o contexto.
3. O Capability Resolver não reconstrói nem administra contexto.
4. O Plugin Manager continua responsável por registro de plugins, armazenamento de instâncias, resolução por identificador, ativação, desativação e lifecycle.
5. O Capability Resolver não registra plugins nem controla lifecycle.
6. O Capability Resolver não mantém registry interno mutável.
7. O catálogo de capabilities deve ser declarativo, explícito e imutável, fornecido pela camada chamadora ou por dependência injetada.
8. O módulo não implementa workflow, filas, retries, persistência, cache, CQRS, Event Sourcing, agentes, seleção de modelos ou inferência semântica.
9. Falhas devem ser lançadas como erros tipados compatíveis com o Error Core.
10. O resultado público representa exclusivamente uma execução bem-sucedida.
11. O módulo é síncrono, determinístico e sem estado próprio.
12. A resolução é baseada em contratos explícitos e previsíveis.

---

## 4. Responsabilidades

O Capability Resolver deve ser responsável por:

- receber uma capability declarada;
- validar a estrutura mínima da entrada;
- localizar o descriptor da capability no catálogo fornecido;
- resolver a capability para um handler compatível;
- encaminhar a execução para o handler;
- retornar um resultado estruturado para o fluxo bem-sucedido;
- lançar erros tipados compatíveis com o Error Core quando a resolução ou a execução falhar.

O Capability Resolver não é responsável por:

- substituir o Core como coordenador do sistema;
- reconstruir contexto;
- administrar lifecycle de plugins;
- registrar plugins;
- implementar workflow de múltiplos passos;
- persistir estado;
- manter cache;
- decidir entre múltiplos agentes ou modelos;
- alterar a assinatura pública de comandos ou capabilities.

---

## 5. Limites

O Capability Resolver do MVP deve ser deliberadamente simples.

### Limites de projeto

- não implementa filas;
- não implementa persistência;
- não implementa cache;
- não mantém estado interno entre chamadas;
- não implementa reprocessamento automático;
- não implementa retries automáticos;
- não implementa workflow distribuído;
- não implementa integração externa;
- não implementa descoberta automática de capabilities.

### Limites de lógica

- não decide automaticamente entre múltiplos caminhos de execução;
- não executa múltiplas etapas complexas;
- não inferir intenções ou semântica;
- não altera a entrada recebida;
- não substitui o papel do Core.

---

## 6. Escopo

### Escopo desta SPEC

Criar a camada mínima de Capability Resolver com:

- catálogo declarativo, explícito e imutável;
- entrada baseada em uma capability declarada;
- validação mínima da chamada;
- resolução determinística para um handler compatível;
- execução síncrona e previsível;
- saída estruturada com resultado bem-sucedido;
- lançamento de erro tipado compatível com o Error Core para falhas.

### Escopo do MVP

O MVP deve suportar, no mínimo:

- uma capability simples;
- um catálogo explícito e estático;
- uma validação mínima de entrada;
- uma execução sem estado próprio;
- uma relação bem definida com o Core e o Plugin Manager.

### Escopos fora do escopo desta SPEC

- workflow de múltiplos passos;
- pipelines extensos;
- filas e background workers;
- persistência de execução;
- replays ou Event Sourcing;
- CQRS;
- processamento distribuído;
- IA, LLM, embeddings, RAG, inferência semântica;
- integração com sistemas externos;
- automação de seleção de handlers por heurística.

---

## 7. Fora de escopo

Esta SPEC não inclui:

- persistência de capabilities ou execuções;
- armazenamento interno do Capability Resolver;
- cache;
- filas;
- retries;
- histórico de execução;
- reexecução automática;
- Event Sourcing;
- CQRS;
- agentes;
- ferramentas;
- banco de dados ou integrações externas;
- orquestração distribuída;
- lógica de priorização automática;
- resumos automáticos ou inferência semântica.

---

## 8. Dependências

O Capability Resolver deve depender de módulos já existentes do Core e de entradas estruturadas fornecidas pelo ambiente de execução.

### Dependências arquiteturais esperadas

- Core como coordenador principal do sistema;
- Command Processor como camada responsável por validar o comando e compor contexto;
- Plugin Manager como camada responsável por disponibilizar plugins e lifecycle;
- infraestrutura de erros do projeto;
- tipagem explícita para capabilities e resultados.

### Dependências explícitas deste módulo

- não deve depender diretamente de implementações concretas desnecessárias que possam tornar o módulo acoplado;
- não deve substituir ou reimplementar a lógica de módulos já existentes;
- não deve manter estado próprio ou armazenamento.

---

## 9. Entidades e tipos

A implementação mínima deve trabalhar exclusivamente com tipos explícitos e simples.

### 9.1 Capability (conceito arquitetural)

O termo capability permanece como conceito arquitetural e representa a capacidade declarada do sistema. Ele não é um tipo de entrada nem uma entidade de armazenamento deste módulo.

### 9.2 Capability Descriptor (entidade de contrato do módulo)

Representa a descrição declarativa da capability consumida pelo Capability Resolver. Esta é a única entidade de contrato utilizada pela implementação mínima para identificar a capability, associar um handler e, opcionalmente, declarar um contrato de entrada.

Responsabilidade exclusiva do Capability Descriptor:

- identificar a capability de forma declarativa;
- apontar para o handler associado por meio de handlerId;
- declarar o contrato mínimo de entrada, quando aplicável.

Motivo de existir:

- o Capability Resolver precisa de uma estrutura explícita, declarativa e imutável para localizar o handler;
- o conceito de capability permanece útil para a camada chamadora, mas o módulo não precisa de uma segunda entidade de contrato para operar.

Diferenças de contrato:

- Capability é um conceito arquitetural, não um payload de execução;
- CapabilityDescriptor é o contrato operacional consumido pelo módulo.

### 9.3 Capability Handler

Representa a função ou implementação que executa a capability.

Contrato conceitual mínimo:

- recebe uma Invocation;
- executa de forma síncrona;
- retorna um resultado estruturado;
- pode lançar erros tipados compatíveis com o Error Core.

### 9.4 Capability Invocation

Representa a chamada da capability.

Campos mínimos sugeridos:

- capabilityId: string
- input: Readonly<Record<string, unknown>>
- context: Readonly<Record<string, unknown>>
- generatedAt: string

### 9.5 Capability Result

Representa a saída bem-sucedida da execução.

Campos mínimos sugeridos:

- status: 'succeeded'
- output: Readonly<Record<string, unknown>>
- generatedAt: string

### 9.6 Erros específicos

O módulo deve usar erros tipados compatíveis com o Error Core do projeto.

Erros previstos:

- InvalidCapabilityInvocationError
- UnsupportedCapabilityError
- CapabilityResolutionError
- CapabilityExecutionError

---

## 10. Modelo de catálogo declarativo

O catálogo de capabilities deve ser explícito e fornecido pela camada chamadora ou por dependência injetada.

### Regras do catálogo

- o catálogo deve ser um objeto imutável ou uma coleção imutável;
- cada capability deve possuir um descriptor explícito;
- cada descriptor deve apontar para um handler identificado;
- o resolutor não deve criar o catálogo dinamicamente;
- o catálogo não deve depender de estado interno do módulo.

### Modelo mínimo esperado

```ts
interface CapabilityDescriptor {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly handlerId: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
}
```

O resolver deve receber esse catálogo de fora, por injeção ou por parâmetro, sem armazená-lo como estado mutável interno.

### Origem do handler

O Capability Resolver não cria handlers nem constrói a associação entre handlerId e CapabilityHandler internamente. Ele recebe um catálogo declarativo contendo essa associação e usa esse catálogo como entrada de execução. A construção desse catálogo não faz parte desta SPEC. O Plugin Manager continua responsável apenas pelo lifecycle e disponibilidade dos plugins; ele não resolve nem executa capabilities.

---

## 11. Modelo de entrada

A entrada deve ser baseada em uma capability declarada e estruturada.

### Modelo mínimo esperado

O modelo de entrada deve incluir, no mínimo:

- identificador da capability;
- payload de entrada;
- contexto adicional fornecido pela camada chamadora;
- timestamp de geração opcional.

### Regras de entrada

- a invocation deve ser um objeto tipado;
- capabilityId deve ser uma string não vazia;
- input deve ser um objeto, mesmo se vazio;
- o contexto deve ser tratado como leitura apenas;
- entradas incompletas devem ser rejeitadas quando violarem o contrato mínimo;
- o módulo não deve modificar a entrada recebida;
- generatedAt, quando presente, deve ser fornecido pela camada chamadora e não criado pelo Capability Resolver.

---

## 12. Modelo de saída

O output do Capability Resolver deve ser previsível e estruturado.

### Estrutura conceitual mínima

```ts
interface CapabilityResult {
  readonly status: 'succeeded';
  readonly output: Readonly<Record<string, unknown>>;
  readonly generatedAt: string;
}
```

### Comportamento esperado

- a saída deve depender apenas da capability, da entrada e do handler associado;
- a saída deve ser determinística para a mesma entrada e contexto;
- o resultado deve ser retornado como um objeto explícito;
- o módulo não deve expor referências mutáveis internas;
- o Capability Resolver não retorna resultados de falha; falhas são lançadas como erros tipados compatíveis com o Error Core.

---

## 13. API pública

A API pública deve ser deliberadamente minimalista.

### Operação central proposta

#### invoke(invocation: CapabilityInvocation, catalog: readonly CapabilityDescriptor[]): CapabilityResult

Essa operação é a única operação pública do módulo e é suficiente para o MVP.

### Justificativa para o nome `invoke(...)`

A responsabilidade real do módulo não é apenas localizar uma capability. O módulo valida a invocation, identifica o descriptor correspondente, resolve o handler compatível, executa esse handler e retorna um resultado estruturado. Por isso, o nome `invoke(...)` representa com maior precisão a responsabilidade do módulo do que `resolve(...)`.

### Fluxo arquitetural adotado

O fluxo arquitetural explícito desta SPEC é:

```text
Core
  → Command Processor
  → Capability Resolver
  → Capability Handler
  → Result
```

Nesse fluxo:

- o Core coordena a execução geral;
- o Command Processor é responsável por validar o comando e compor o contexto;
- o Capability Resolver recebe a invocation e o catálogo declarativo;
- o Capability Resolver valida a invocation, localiza o descriptor, resolve o handler compatível e executa esse handler;
- o handler retorna um resultado estruturado;
- o Capability Resolver devolve esse resultado como `CapabilityResult`.

Importante: o Capability Resolver é o componente que executa o handler. O Command Processor não executa o handler; sua função permanece restrita à validação e à composição de contexto.

A operação `invoke(...)` encapsula o fluxo completo de:

1. validar a invocation;
2. localizar o descriptor no catálogo;
3. resolver o handler;
4. executar a chamada;
5. devolver o resultado estruturado.

Isso mantém o módulo simples, previsível e alinhado com o restante da arquitetura.

---

## 14. Regras de resolução

A resolução deve seguir regras determinísticas e explícitas.

### Regras mínimas

- a capability deve existir no catálogo fornecido;
- o descriptor deve referenciar um handlerId válido;
- o handler associado deve ser compatível com o contrato de execução;
- se a capability não for encontrada, o módulo deve lançar `UnsupportedCapabilityError`;
- se o handler não for encontrado ou não for invocável, o módulo deve lançar `CapabilityResolutionError`;
- se a execução do handler falhar, o módulo deve lançar `CapabilityExecutionError`.

### Regras de compatibilidade

- a resolução deve depender do descriptor e do handlerId, não de heurísticas ocultas;
- não deve existir seleção implícita por semântica ou inferência;
- o módulo não deve criar handlers dinamicamente.

---

## 15. Regras de validação

O Capability Resolver deve validar, no mínimo, os itens abaixo:

- capabilityId deve ser uma string não vazia;
- input deve ser um objeto válido;
- o catálogo fornecido deve ser explícito e não mutável;
- a capability declarada deve existir no catálogo;
- a chamada deve ser compatível com o descriptor;
- entradas incompletas devem ser rejeitadas quando violarem o contrato mínimo.

### Validações de integridade

- uma invocation inválida não deve ser processada;
- o resultado não deve ser produzido se a entrada não atender ao contrato mínimo;
- falhas de resolução ou execução devem ser propagadas como erros tipados compatíveis com o Error Core.

---

## 16. Tratamento de erros

Falhas devem ser lançadas como erros tipados compatíveis com o Error Core.

### Comportamento esperado

- `InvalidCapabilityInvocationError` para entrada inválida;
- `UnsupportedCapabilityError` quando a capability não existe no catálogo;
- `CapabilityResolutionError` quando a handler associado não puder ser resolvido;
- `CapabilityExecutionError` quando o handler falhar durante a execução.

### Regras de erro

- não devem existir retornos de falha de execução no resultado público;
- a execução bem-sucedida retorna `CapabilityResult`;
- a execução falha lança uma exceção tipada;
- a causa original deve ser preservada quando aplicável.

---

## 17. Imutabilidade e determinismo

O módulo deve ser estritamente determinístico para a mesma entrada, catálogo e contexto.

### Regras de projeto

- o catálogo fornecido pela camada chamadora deve ser tratado como leitura apenas;
- o módulo não deve manter estado interno entre chamadas;
- o módulo não deve alterar a entrada recebida;
- o resultado deve depender apenas da invocation, do catálogo e do handler associado.

---

## 18. Estratégia completa de testes

A implementação futura desta SPEC deve incluir testes permanentes cobrindo:

- resolução bem-sucedida de uma capability declarada;
- rejeição de invocation com capabilityId vazio;
- rejeição de input inválido;
- rejeição de capability não presente no catálogo;
- rejeição de handler não resolvido;
- propagação de falha de execução do handler;
- determinismo para a mesma entrada e catálogo;
- imutabilidade da entrada recebida;
- ausência de estado entre chamadas;
- integração mínima com o Command Processor e o Plugin Manager sem sobrepor suas responsabilidades.

### Estratégia recomendada

- testes unitários para o resolver;
- testes de integração mínima com um handler simples de referência;
- testes de erro compatíveis com o Error Core;
- testes de imutabilidade e determinismo.

---

## 19. Riscos

Os principais riscos desta SPEC são:

- sobrecarregar o módulo com responsabilidades de workflow ou lifecycle;
- duplicar o papel do Plugin Manager;
- transformar o resolver em um executor com estado próprio;
- introduzir lógica semântica ou heurística indevida;
- ampliar demais o escopo do MVP.

---

## 20. Decisões arquiteturais

### Decisão principal

A responsabilidade desta SPEC é limitada a resolver e direcionar a execução de uma capability declarada, sem criar estado próprio nem assumir lifecycle de plugins.

### Decisão de design

A API pública será deliberadamente mínima e a execução será feita através de uma única operação pública: `invoke(...)`.

### Decisão de compatibilidade

A implementação deve respeitar a separação já aprovada entre:

- Core: coordenação geral;
- Command Processor: validação do comando e composição de contexto;
- Plugin Manager: lifecycle e disponibilidade de plugins;
- Capability Resolver: resolução e execução de capabilities declaradas.

---

## 21. Evoluções futuras

Em fases posteriores, o módulo pode evoluir para:

- suportar um catálogo mais rico;
- suportar múltiplos handlers por capability;
- integrar com plugins ativos e registrados;
- permitir uma camada de observabilidade mais detalhada;
- incluir validação adicional de contratos de entrada/saída.

Essas evoluções devem acontecer sem quebrar o modelo básico estabelecido aqui.

---

## 22. Resumo executivo

A SPEC-014 define uma camada mínima de Capability Resolver para o Sebastian IA. O objetivo não é criar um workflow engine, um agent manager, um command bus ou uma camada de IA. O papel do módulo é bem específico: resolver uma capability declarada, validar sua chamada e encaminhar sua execução para um handler compatível, mantendo o Core como coordenador e preservando as fronteiras já estabelecidas para o Command Processor e o Plugin Manager.

---

## 23. Diagrama simples

```text
Core
  → Command Processor
  → Capability Resolver
  → Capability Handler
  → Result

Plugin Manager
  ↳ fornece disponibilidade e lifecycle de plugins
  ↳ não executa a chamada da capability
```

---

## 24. Critérios de aceitação

A implementação desta SPEC será considerada adequada quando:

- o módulo resolver uma capability declarada de forma explícita;
- a entrada mínima seja validada;
- o resultado seja retornado de forma estruturada;
- entradas inválidas sejam rejeitadas com erros tipados compatíveis com o Error Core;
- o módulo não implemente estado próprio, persistência ou cache;
- o módulo não implemente filas, CQRS, Event Sourcing ou workflow distribuído;
- o módulo preserve as fronteiras do Core, do Command Processor e do Plugin Manager.
