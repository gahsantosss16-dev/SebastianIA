# SPEC-012 — Context Manager

## 1. Contexto

O Sebastian IA já consolidou uma infraestrutura modular composta por módulos especializados e explícitos. A partir dessa base, a próxima evolução arquitetural natural é a introdução de uma camada responsável por compor contexto para uso do Core.

Essa camada não deve substituir os módulos já existentes nem assumir responsabilidades de armazenamento, memória, configuração ou coordenação. Seu papel é exclusivamente organizar, consolidar e entregar uma visão derivada de contexto para a execução atual.

A implementação desta SPEC define a arquitetura mínima do Context Manager para o MVP, mantendo-o alinhado com os princípios do projeto: modularidade, previsibilidade, baixo acoplamento, imutabilidade e clareza de responsabilidades.

---

## 2. Objetivo

Implementar uma camada de contexto no core que:

- receba dados já estruturados e tipados;
- produza um snapshot consolidado de contexto;
- seja derivado, descartável e recalculado a cada chamada;
- preserve isolamento entre conversas e sessões;
- não introduzir armazenamento próprio, cache, persistência ou lógica de IA.

---

## 3. Princípios arquiteturais

A implementação desta SPEC deve seguir, obrigatoriamente, os seguintes princípios:

1. O Core é o orquestrador.
2. O Context Manager recebe dados já estruturados.
3. O Context Manager não consulta diretamente o ConversationManager ou o ConfigurationManager.
4. O Context Manager não depende diretamente de implementações concretas desses módulos.
5. O Context Manager não usa o MemoryManager para persistir snapshots.
6. O Context Manager não mantém armazenamento próprio.
7. O Context Manager não implementa CRUD.
8. O snapshot é recalculado a cada chamada.
9. O resultado é derivado, imutável e descartável.
10. A operação é síncrona, pois o MVP não depende de IO, rede, disco ou chamadas externas.
11. Os escopos obrigatórios são Conversation e Session.

---

## 4. Responsabilidades

O Context Manager deve ser responsável por:

- receber fragmentos de contexto tipados;
- validar a integridade mínima das entradas;
- consolidar informações em um snapshot único;
- preservar a ordem e a previsibilidade da composição;
- garantir que o resultado seja uma visão imutável e descartável;
- rejeitar entradas incompatíveis ou inválidas.

O Context Manager não é responsável por:

- armazenar estado interno;
- persistir snapshots;
- decidir relevância usando IA;
- resumir semanticamente os dados recebidos;
- inferir intenções ou mudanças de significado;
- substituir o MemoryManager;
- substituir o ConversationManager;
- substituir o ConfigurationManager.

---

## 5. Limites

O Context Manager do MVP deve ser deliberadamente simples.

### Limites de projeto

- não implementa cache;
- não implementa snapshots persistidos;
- não mantém estado interno entre chamadas;
- não implementa sincronização;
- não implementa invalidação de cache;
- não implementa overlays persistentes ou mutáveis.

### Limites de lógica

- não decide relevância semântica;
- não realiza resumo automático;
- não aplica inferência;
- não altera os dados recebidos;
- não mistura dados de outra conversa ou sessão.

---

## 6. Escopo

### Escopo desta SPEC

Criar a camada mínima de Context Manager com:

- entrada baseada em fragmentos tipados;
- composição determinística de snapshot;
- validação de IDs e estrutura básica;
- saída imutável e simples;
- integração arquitetural sem armazenamento próprio.

### Escopos obrigatórios no MVP

- Conversation
- Session

Esses dois escopos devem ser sempre identificados no snapshot produzido.

### Escopos fora do escopo desta SPEC

- Runtime
- User
- Project

Esses escopos não serão implementados nesta SPEC.

---

## 7. Fora de escopo

Esta SPEC não inclui:

- persistência de contextos;
- armazenamento interno do contexto;
- gerenciamento de histórico de snapshots;
- cache ou invalidation;
- IA, LLM, embeddings, RAG ou inferência semântica;
- agentes;
- ferramentas;
- integração com banco de dados ou sistemas externos;
- overlays persistentes ou mutáveis;
- lógica de priorização automática de informação;
- resumos automáticos ou sumarização semântica.

---

## 8. Dependências

O Context Manager deve depender de dados estruturados fornecidos pelo ambiente de execução.

### Dependências arquiteturais esperadas

- Core como coordenador principal;
- dados já estruturados vindos de módulos de origem;
- tipagem explícita para os fragmentos de entrada;
- infraestrutura de erros do projeto.

### Dependências explícitas deste módulo

- não deve depender diretamente de implementações concretas do ConversationManager;
- não deve depender diretamente de implementações concretas do ConfigurationManager;
- não deve depender do MemoryManager para persistir snapshots;
- não deve depender de armazenamento próprio.

---

## 9. Entidades e tipos

A implementação mínima deve trabalhar exclusivamente com tipos explícitos e simples.

### 9.1 Fragmentos de entrada

Os fragmentos de entrada devem representar somente os dados necessários para a composição.

#### ConversationContextFragment

Representa dados da conversa.

Campos mínimos sugeridos:

- conversationId: string
- messages?: readonly MessageContextItem[]
- decisions?: readonly DecisionContextItem[]
- pendingTasks?: readonly PendingTaskContextItem[]
- summary?: SummaryContextItem | undefined

#### SessionContextFragment

Representa dados da sessão.

Campos mínimos sugeridos:

- conversationId: string
- sessionId: string
- messages?: readonly MessageContextItem[]
- decisions?: readonly DecisionContextItem[]
- pendingTasks?: readonly PendingTaskContextItem[]
- summary?: SummaryContextItem | undefined

#### ConfigurationContextFragment

Representa configurações relevantes para a execução atual.

Campos mínimos sugeridos:

- values: Readonly<Record<string, unknown>>

#### TemporaryContextFragment

Representa dados temporários da execução, fornecidos opcionalmente.

Campos mínimos sugeridos:

- values: Readonly<Record<string, unknown>>

### 9.2 Tipos auxiliares mínimos

Esses tipos podem ser definidos como estruturas simples e explícitas.

#### MessageContextItem

- id: string
- role: string
- content: string
- createdAt: string

#### DecisionContextItem

- id: string
- summary: string
- createdAt: string

#### PendingTaskContextItem

- id: string
- description: string
- status: string
- createdAt: string

#### SummaryContextItem

- id: string
- content: string
- createdAt: string

### 9.3 Snapshot

O snapshot é o resultado principal do módulo.

Campos mínimos obrigatórios:

- conversationId: string
- sessionId: string
- generatedAt: string

Campos opcionais no MVP:

- messages: readonly MessageContextItem[]
- decisions: readonly DecisionContextItem[]
- pendingTasks: readonly PendingTaskContextItem[]
- summary: SummaryContextItem | undefined
- configuration: Readonly<Record<string, unknown>> | undefined
- temporary: Readonly<Record<string, unknown>> | undefined

A definição exata de quais campos são obrigatórios ou opcionais deve ser consistente com a entrada recebida. O módulo não deve exigir a presença de todos os campos para produzir um snapshot válido.

---

## 10. Modelo de entrada

A entrada deve ser baseada em fragmentos tipados e estruturados.

### Modelo mínimo esperado

O modelo de entrada deve incluir, no mínimo:

- conversation fragment;
- session fragment;
- configuration fragment;
- temporary fragment opcional.

### Regras de entrada

- todos os fragmentos devem ser objetos tipados;
- a entrada deve ser tratada como imutável pelo módulo;
- nenhuma entrada deve ser alterada pelo Context Manager;
- o módulo não deve modificar os dados recebidos;
- o módulo deve operar apenas sobre cópias ou versões protegidas;
- o valor de generatedAt deve ser fornecido pelo Core, que coordena a execução atual.

### Fluxo de composição

```text
Conversation Fragment
        │
Session Fragment
        │
Configuration Fragment
        │
Temporary Fragment (opcional)
        │
        ▼
ContextSnapshot
```

### Regras de composição

- o snapshot deve ser derivado dos fragments recebidos;
- a ordem de composição deve ser determinística;
- o módulo deve preservar a ordem natural dos dados recebidos;
- dados de outra conversa ou sessão não podem ser misturados.

---

## 11. Modelo do snapshot

O snapshot representa a visão consolidada do contexto para a execução atual.

### Estrutura conceitual mínima

```ts
interface ContextSnapshot {
  readonly conversationId: string;
  readonly sessionId: string;
  readonly messages: readonly MessageContextItem[];
  readonly decisions: readonly DecisionContextItem[];
  readonly pendingTasks: readonly PendingTaskContextItem[];
  readonly summary?: SummaryContextItem;
  readonly configuration?: Readonly<Record<string, unknown>>;
  readonly temporary?: Readonly<Record<string, unknown>>;
  readonly generatedAt: string;
}
```

### Comportamento esperado

- o snapshot é sempre recalculado a cada chamada;
- não há armazenamento interno;
- o resultado é descartável;
- o retorno não pode expor referências mutáveis;
- o consumidor não pode modificar o snapshot produzido;
- o snapshot não pode compartilhar referências mutáveis com o estado interno ou com as entradas externas.

---

## 12. API pública

A API pública deve ser orientada exclusivamente à montagem de contexto.

### Operação central proposta

#### buildSnapshot(input: ContextBuildInput): ContextSnapshot

Essa é a operação principal do módulo.

### Parâmetros

#### ContextBuildInput

Deve incluir os fragmentos necessários para composição.

Campos mínimos propostos:

- conversation: ConversationContextFragment
- session: SessionContextFragment
- configuration?: ConfigurationContextFragment
- temporary?: TemporaryContextFragment
- generatedAt: string

### Retorno

Retorna um ContextSnapshot consolidado e imutável.

### Motivação da API

A operação central deve refletir o papel do módulo: receber entradas estruturadas e devolver uma visão consolidada de contexto.

### Por que não usar uma API semelhante a set/get/remove/update/clear

Essas operações seriam incompatíveis com a arquitetura proposta porque:

- sugerem armazenamento;
- confundem contexto com memória;
- aumentam a chance de o módulo virar um segundo MemoryManager;
- não refletem o papel derivado e descartável do snapshot.

---

## 13. Regras de composição

As regras abaixo devem ser observadas no MVP:

1. A composição deve ser explícita e previsível.
2. A ordem de composição deve ser determinística.
3. O módulo não pode inventar ou inferir relevância.
4. O módulo deve preservar o que lhe foi fornecido, sem alterar o significado.
5. Dados de outra conversa ou sessão não podem ser misturados.
6. O módulo não deve substituir ou reordenar dados sem uma regra explícita.
7. Se informações estiverem ausentes, elas devem simplesmente não aparecer no snapshot, sem criar valores inventados.
8. O módulo deve respeitar a estrutura dos fragmentos e não expandir semanticamente o conteúdo.

### Regras de determinismo

- a saída deve depender apenas dos dados de entrada e da lógica explícita de composição;
- a ordem dos dados deve ser estável;
- a composição não deve depender de estado interno.

---

## 14. Validações

O módulo deve validar, no mínimo, os itens abaixo:

- conversationId deve ser uma string válida e não vazia;
- sessionId deve ser uma string válida e não vazia;
- os fragmentos de entrada devem ter a estrutura esperada;
- entradas incompletas devem ser aceitas apenas se forem compatíveis com o modelo mínimo;
- IDs de outra conversa ou sessão não devem ser aceitos para composição em um snapshot incompatível.

### Validações de integridade

- o snapshot não deve ser produzido se os IDs principais forem inválidos;
- entradas de diferentes conversas ou sessões devem ser rejeitadas ou tratadas como erro de composição.

---

## 15. Tratamento de erros

O Context Manager deve usar erros tipados compatíveis com o Error Core do projeto.

### Erros previstos

- InvalidContextConversationIdError
- InvalidContextSessionIdError
- InvalidContextInputError

### Regras de tratamento

- entradas inválidas devem rejeitar a operação;
- erros devem ser explícitos e informativos;
- o módulo não deve falhar silenciosamente;
- erros devem refletir a natureza da falha de validação ou composição.

---

## 16. Imutabilidade

O Context Manager deve garantir que:

- os fragmentos recebidos não sejam mutados;
- o snapshot retornado não exponha referências mutáveis;
- alterações posteriores nas entradas externas não afetem o snapshot já produzido.

### Estratégia mínima

- produzir um resultado que não permita mutação pelo consumidor;
- evitar compartilhamento de referências mutáveis entre o snapshot e as entradas recebidas;
- utilizar qualquer estratégia de implementação compatível com esse comportamento, desde que o efeito observado seja o mesmo.

---

## 17. Determinismo

O Context Manager deve ser determinístico.

Isso significa que:

- a mesma entrada produz o mesmo snapshot;
- não há dependência de estado interno;
- não há dependência de relógio externo além do valor generatedAt fornecido pelo Core;
- a composição é previsível e sem efeitos colaterais.

O valor de generatedAt pode variar entre chamadas, mas a estrutura e o conteúdo devem permanecer determinísticos com base na entrada.

---

## 18. Critérios de aceitação

A implementação desta SPEC será considerada adequada quando:

- o módulo construir snapshots a partir de fragmentos tipados;
- o snapshot incluir conversationId e sessionId;
- os dados recebidos sejam preservados sem alteração semântica;
- entradas inválidas sejam rejeitadas com erro explícito;
- o resultado seja imutável e descartável;
- o módulo não implemente armazenamento próprio;
- o módulo não implemente cache ou persistência;
- o módulo não use IA ou inferência semântica;
- o módulo seja exportado corretamente pelo core central;
- a implementação siga os limites arquiteturais desta SPEC.

---

## 19. Estratégia completa de testes

Esta SPEC não implementa testes, mas a implementação futura deve incluir uma suíte permanente com foco em comportamento real e não em mocks.

### Cenários mínimos de teste

- construção básica de snapshot com conversação e sessão;
- inclusão opcional de configuração;
- inclusão opcional de dados temporários;
- rejeição de conversationId inválido;
- rejeição de sessionId inválido;
- rejeição de entradas incompatíveis;
- preservação da ordem dos dados recebidos;
- imutabilidade do snapshot retornado;
- ausência de armazenamento interno entre chamadas;
- determinismo para a mesma entrada.

### Critérios de teste

- testes devem validar o comportamento público;
- testes não devem depender de implementações internas;
- testes devem cobrir tanto o caso feliz quanto os erros de entrada.

---

## 20. Riscos

Os principais riscos desta SPEC são:

1. transformar o Context Manager em um segundo MemoryManager;
2. adicionar cache ou persistência prematuramente;
3. permitir lógica de relevância ou sumarização semântica;
4. fazer o módulo depender demais de implementações concretas;
5. expandir o escopo além do MVP.

Esses riscos devem ser tratados com disciplina arquitetural e manutenção do escopo definido.

---

## 21. Decisões arquiteturais

As decisões abaixo devem orientar a implementação futura:

- ✓ O Context Manager NÃO substitui o MemoryManager.
- ✓ O Context Manager NÃO mantém armazenamento próprio.
- ✓ O Context Manager NÃO implementa CRUD.
- ✓ O Context Manager recebe dados já estruturados.
- ✓ O Core continua sendo o orquestrador.
- ✓ O snapshot é derivado e descartável.
- ✓ Os escopos obrigatórios do MVP são Conversation e Session.
- ✓ O módulo é orientado à composição, não à persistência.

---

## 22. Evoluções futuras

Após a homologação desta SPEC, evoluções futuras podem incluir:

- expansão para escopos adicionais, como Runtime ou User;
- introdução de regras mais sofisticadas de composição;
- mais integração com módulos de execução;
- melhoria da tipagem das entradas e do snapshot;
- refinamento da camada de validação sem perder o caráter simples do MVP.

No entanto, essas evoluções não devem ser incorporadas ao MVP desta SPEC.

---

## 23. Resumo executivo

Esta SPEC define um Context Manager mínimo, orientado à composição de contexto, sem armazenamento próprio e sem lógica de inferência. O objetivo é criar uma camada simples, previsível e alinhada com a arquitetura do Sebastian IA, para que o Core receba uma visão consolidada de contexto a partir de dados já estruturados.
