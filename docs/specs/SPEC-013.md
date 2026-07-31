# SPEC-013 — Command Processor

## 1. Contexto

O Sebastian IA já consolidou uma infraestrutura modular composta por módulos especializados, explícitos e previsíveis. Após a implementação do Context Manager, a próxima evolução arquitetural natural é introduzir uma camada responsável por processar uma unidade de trabalho tipada, utilizando os módulos já existentes do Core.

Essa camada não substitui o Core nem assume responsabilidades de persistência, memória, configuração, lifecycle, plugins, eventos ou orquestração sistêmica. Seu papel é exclusivamente receber uma unidade de trabalho previsível, aplicar a lógica mínima de execução associada a essa entrada e, quando bem-sucedido, devolver um resultado estruturado; quando ocorre uma falha, lançar erros tipados compatíveis com o Error Core.

A implementação desta SPEC define a arquitetura mínima do Command Processor para o MVP, mantendo-o alinhado com os princípios do projeto: modularidade, previsibilidade, baixo acoplamento, determinismo e clareza de responsabilidades.

---

## 2. Objetivo

Implementar uma camada de processamento no core que:

- receba uma unidade de trabalho tipada;
- valide a entrada mínima;
- utilize os módulos já existentes do Core para montar o contexto necessário;
- processe uma unidade de trabalho previsível;
- retorne um resultado estruturado quando bem-sucedido e lance erros tipados compatíveis com o Error Core quando ocorre uma falha;
- preserve a divisão de responsabilidades entre Core e módulo especializado.

---

## 3. Princípios arquiteturais

A implementação desta SPEC deve seguir, obrigatoriamente, os seguintes princípios:

1. O Core continua sendo o orquestrador do sistema.
2. O Command Processor não substitui o Core.
3. O Command Processor não é um Workflow Engine.
4. O Command Processor não é um Task Runner.
5. O Command Processor não é um Command Bus.
6. O Command Processor não implementa CQRS.
7. O Command Processor não implementa filas.
8. O Command Processor não implementa Event Sourcing.
9. O Command Processor não mantém estado próprio.
10. O Command Processor não possui persistência.
11. O Command Processor não possui cache.
12. O Command Processor apenas processa uma unidade de trabalho previsível utilizando os módulos existentes.
13. O Command Processor nunca gera timestamps. Quando necessário, `generatedAt` deve ser fornecido pela camada chamadora, que no MVP é o Core.
14. O processamento é síncrono, pois o MVP não depende de I/O, rede, disco ou execução assíncrona externa.
15. O módulo é determinístico para uma mesma entrada e contexto.

---

## 4. Responsabilidades

O Command Processor deve ser responsável por:

- receber uma unidade de trabalho tipada;
- validar a estrutura mínima da entrada;
- selecionar o fluxo mínimo suportado pelo MVP;
- utilizar módulos existentes do Core para montar o contexto de execução;
- retornar um resultado estruturado quando bem-sucedido;
- lançar erros tipados compatíveis com o Error Core quando a entrada for inválida ou o processamento falhar.

O Command Processor não é responsável por:

- substituir o Core como coordenador do sistema;
- implementar workflows complexos;
- gerenciar filas ou jobs assíncronos;
- persistir estado;
- manter cache;
- implementar lógica de negócio avançada;
- decidir entre múltiplos agentes ou modelos;
- substituir módulos já existentes como Memory Manager, Conversation Manager, Configuration Manager, Event Bus ou Context Manager.

---

## 5. Limites

O Command Processor do MVP deve ser deliberadamente simples.

### Limites de projeto

- não implementa filas;
- não implementa persistência;
- não implementa cache;
- não mantém estado interno entre chamadas;
- não implementa reprocessamento automático;
- não implementa retries automáticos;
- não implementa workflow distribuído;
- não implementa integração externa.

### Limites de lógica

- não decide automaticamente entre múltiplos caminhos de execução;
- não executa múltiplas etapas complexas;
- não inferir intenções ou semântica;
- não altera a entrada recebida;
- não substitui o papel do Core.

---

## 6. Escopo

### Escopo desta SPEC

Criar a camada mínima de Command Processor com:

- entrada baseada em uma unidade de trabalho tipada;
- validação da estrutura mínima da entrada;
- processamento previsível e determinístico;
- saída estruturada com resultado ou erro;
- integração arquitetural com módulos existentes do Core.

### Escopo do MVP

O MVP deve suportar, no mínimo:

- uma unidade de trabalho simples;
- um resultado estruturado padrão para o fluxo bem-sucedido;
- um erro tipado compatível com o Error Core para entrada inválida;
- uma execução sem estado próprio;
- uma relação bem definida com o Core.

### Escopos fora do escopo desta SPEC

- workflows de múltiplos passos;
- pipelines extensos;
- filas e background workers;
- persistência de execução;
- replays ou Event Sourcing;
- CQRS;
- processamento distribuído;
- IA, LLM, embeddings, RAG, inferência semântica;
- integração com sistemas externos.

---

## 7. Fora de escopo

Esta SPEC não inclui:

- persistência de comandos ou execuções;
- armazenamento interno do Command Processor;
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

O Command Processor deve depender de módulos já existentes do Core e de entradas estruturadas fornecidas pelo ambiente de execução.

### Dependências arquiteturais esperadas

- Core como coordenador principal do sistema;
- módulos já existentes do Core, como Context Manager, Conversation Manager, Configuration Manager, Event Bus, Error Handling, Health Monitor e Memory Manager;
- tipagem explícita para a unidade de trabalho e o resultado.
- infraestrutura de erros do projeto.

### Dependências explícitas deste módulo

- não deve depender diretamente de implementações concretas desnecessárias que possam tornar o módulo acoplado;
- não deve substituir ou reimplementar a lógica de módulos já existentes;
- não deve manter estado próprio ou armazenamento.

---

## 9. Entidades e tipos

A implementação mínima deve trabalhar exclusivamente com tipos explícitos e simples.

### 9.1 Command

O Command representa uma unidade de trabalho previsível e explícita, destinada ao processamento local e síncrono. Ele não implica CQRS, Command Bus, Event Sourcing, filas, workflow distribuído ou qualquer camada de orquestração sistêmica. Ele é apenas uma descrição tipada de uma execução unitária.

Campos mínimos sugeridos:

- type: string
- input: Readonly<Record<string, unknown>>
- conversationId?: string
- sessionId?: string
- generatedAt?: string

### 9.2 Resultado de processamento

O resultado representa a saída do processamento.

Campos mínimos sugeridos:

- status: 'succeeded' | 'failed'
- output: Readonly<Record<string, unknown>>
- generatedAt: string

### 9.3 Contexto de execução

O contexto de execução é derivado dos módulos já existentes e pode incluir dados de:

- conversation;
- session;
- configuration;
- temporary values.

### 9.4 Erros específicos

O módulo deve usar erros tipados compatíveis com o Error Core do projeto.

Erros previstos:

- InvalidCommandInputError
- UnsupportedCommandTypeError
- CommandProcessingError

---

## 10. Modelo de entrada

A entrada deve ser baseada em uma unidade de trabalho tipada e estruturada.

### Modelo mínimo esperado

O modelo de entrada deve incluir, no mínimo:

- tipo de comando ou unidade de trabalho;
- payload de entrada;
- identificadores opcionais de conversa/sessão;
- timestamp de geração opcional.

### Regras de entrada

- a unidade de trabalho deve ser um objeto tipado;
- o campo type deve ser uma string não vazia;
- input deve ser um objeto, mesmo se vazio;
- entradas incompletas devem ser rejeitadas quando violarem o contrato mínimo;
- o módulo não deve modificar a entrada recebida;
- o campo generatedAt, quando presente, deve ser fornecido pela camada chamadora (Core) e não criado pelo Command Processor.

---

## 11. Modelo de saída

O output do Command Processor deve ser previsível e estruturado.

### Estrutura conceitual mínima

```ts
interface CommandProcessingResult {
  readonly status: 'succeeded' | 'failed';
  readonly output: Readonly<Record<string, unknown>>;
  readonly generatedAt: string;
}
```

### Comportamento esperado

- a saída deve depender apenas da entrada e dos módulos utilizados;
- a saída deve ser determinística para a mesma entrada e contexto;
- o resultado deve ser retornado como um objeto explícito;
- o módulo não deve expor referências mutáveis internas;
- o módulo deve devolver um resultado estruturado quando bem-sucedido e lançar erros tipados compatíveis com o Error Core quando a entrada for inválida ou o processamento falhar;
- o Command Processor nunca gera timestamps; `generatedAt` deve ser fornecido pela camada chamadora (Core).

---

## 12. API pública

A API pública deve ser orientada exclusivamente ao processamento de uma unidade de trabalho.

### Operação central proposta

#### process(input: CommandProcessingInput): CommandProcessingResult

Essa é a operação principal do módulo. A API é deliberadamente minimalista: `process(...)` é a única operação pública do módulo, preservando o encapsulamento do componente e evitando a exposição de métodos de estado, armazenamento ou manipulação interna.

```text
Core
  → Command Processor
  → módulos existentes do Core
  → Result
```

### Parâmetros

#### CommandProcessingInput

Deve incluir os campos necessários para o processamento.

Campos mínimos propostos:

- type: string
- input: Readonly<Record<string, unknown>>
- conversationId?: string
- sessionId?: string
- generatedAt?: string

### Retorno

Retorna um CommandProcessingResult consolidado e previsível.

### Motivação da API

A operação central deve refletir o papel do módulo: receber uma unidade de trabalho estruturada e, quando bem-sucedido, devolver um resultado estruturado; quando ocorre uma falha, lançar erros tipados compatíveis com o Error Core.

### Por que não usar uma API semelhante a set/get/remove/update/clear

Essas operações seriam incompatíveis com a arquitetura proposta porque:

- sugerem armazenamento;
- confundem processamento com memória;
- aumentam a chance de o módulo virar um segundo MemoryManager ou um componente com estado próprio;
- não refletem o papel derivado e descartável do processamento.

---

## 13. Regras de processamento

As regras abaixo devem ser observadas no MVP:

1. O processamento deve ser explícito e previsível.
2. A ordem de execução deve ser determinística.
3. O módulo não pode inventar ou inferir comportamento além do contrato explícito.
4. O módulo deve preservar o que lhe foi fornecido, sem alterar o significado da entrada.
5. O módulo deve usar os módulos existentes do Core para compor o contexto necessário.
6. O módulo não deve substituir o Core nem implementar lógica de orquestração sistêmica.
7. Se informações estiverem ausentes, o módulo deve lidar de forma explícita e previsível.
8. O módulo deve respeitar o tipo de comando/ unidade de trabalho recebido e rejeitar tipos não suportados.

### Regras de determinismo

- a saída deve depender apenas da entrada, do contexto derivado e da lógica explícita de processamento;
- a ordem dos dados deve ser estável;
- o processamento não deve depender de estado interno.

---

## 14. Validações

O módulo deve validar, no mínimo, os itens abaixo:

- type deve ser uma string válida e não vazia;
- input deve ser um objeto válido;
- entradas incompletas devem ser rejeitadas quando violarem o contrato mínimo;
- comandos de tipo não suportado devem ser rejeitados;
- entradas inválidas devem produzir erros tipados compatíveis com o Error Core.

### Validações de integridade

- uma unidade de trabalho inválida não deve ser processada;
- o resultado não deve ser produzido se a entrada não atender ao contrato mínimo;
- falhas na composição do contexto devem ser propagadas como erros tipados compatíveis com o Error Core.

---

## 15. Tratamento de erros

O Command Processor deve usar erros tipados compatíveis com o Error Core do projeto.

### Erros previstos

- InvalidCommandInputError
- CommandProcessingError

A classe de erro para tipo de comando não suportado deve ser tratada como uma variação de entrada inválida, portanto não exige uma terceira classe separada.

### Regras de tratamento

- entradas inválidas devem rejeitar a operação;
- erros devem ser explícitos e informativos;
- o módulo não deve falhar silenciosamente;
- erros devem refletir a natureza da falha de validação ou processamento.

---

## 16. Imutabilidade

O Command Processor deve garantir que:

- as entradas recebidas não sejam mutadas;
- o resultado retornado não exponha referências mutáveis internas;
- alterações posteriores nas entradas externas não afetem o resultado já produzido.

### Estratégia mínima

- produzir um resultado que não permita mutação pelo consumidor;
- evitar compartilhamento de referências mutáveis entre o resultado e as entradas recebidas;
- utilizar qualquer estratégia de implementação compatível com esse comportamento, desde que o efeito observado seja o mesmo.

---

## 17. Determinismo

O Command Processor deve ser determinístico.

Isso significa que:

- a mesma entrada produz o mesmo resultado, dadas as mesmas dependências e contexto;
- não há dependência de estado interno;
- não há dependência de relógio externo além do valor generatedAt, quando fornecido;
- o processamento é previsível e sem efeitos colaterais.

---

## 18. Critérios de aceitação

A implementação desta SPEC será considerada adequada quando:

- o módulo processar uma unidade de trabalho tipada;
- a entrada mínima seja validada;
- o resultado seja retornado de forma estruturada;
- entradas inválidas sejam rejeitadas com erros tipados compatíveis com o Error Core;
- o módulo utilize módulos existentes do Core sem substituí-los;
- o módulo não implemente estado próprio, persistência ou cache;
- o módulo não implemente filas, CQRS, Event Sourcing ou workflow distribuído;
- o módulo seja exportado corretamente pelo core central;
- a implementação siga os limites arquiteturais desta SPEC.

---

## 19. Estratégia completa de testes

Esta SPEC não implementa testes, mas a implementação futura deve incluir uma suíte permanente com foco em comportamento real e não em mocks.

### Cenários mínimos de teste

- processamento básico de uma unidade de trabalho válida;
- rejeição de entrada inválida;
- rejeição de tipo não suportado;
- uso correto do contexto derivado dos módulos existentes;
- lançamento de erros tipados compatíveis com o Error Core para falha de processamento;
- determinismo para a mesma entrada;
- ausência de armazenamento interno entre chamadas.

### Critérios de teste

- testes devem validar o comportamento público;
- testes não devem depender de implementações internas;
- testes devem cobrir tanto o caso feliz quanto os erros de entrada.

---

## 20. Riscos

Os principais riscos desta SPEC são:

1. transformar o Command Processor em um Workflow Engine;
2. dar ao módulo responsabilidades de orquestração sistêmica;
3. introduzir estado próprio, persistência ou cache prematuramente;
4. fazer o módulo depender demais de implementações concretas;
5. expandir o escopo além do MVP.

Esses riscos devem ser tratados com disciplina arquitetural e manutenção do escopo definido.

---

## 21. Decisões arquiteturais

As decisões abaixo devem orientar a implementação futura:

- ✓ O Command Processor NÃO substitui o Core.
- ✓ O Command Processor NÃO mantém estado próprio.
- ✓ O Command Processor NÃO implementa persistência.
- ✓ O Command Processor NÃO implementa cache.
- ✓ O Command Processor NÃO implementa filas.
- ✓ O Command Processor NÃO implementa CQRS.
- ✓ O Command Processor NÃO implementa Event Sourcing.
- ✓ O Command Processor processa uma unidade de trabalho previsível utilizando os módulos existentes.
- ✓ O Core continua sendo o orquestrador do sistema.
- ✓ O processamento é derivado, previsível e descartável.

---

## 22. Evoluções futuras

Após a homologação desta SPEC, evoluções futuras podem incluir:

- expansão para tipos adicionais de unidade de trabalho;
- integração mais explícita com o Context Manager e a Conversation layer;
- refinamento da tipagem do resultado;
- extensão da camada para suportar mais regras de execução sem perder o caráter simples do MVP.

No entanto, essas evoluções não devem ser incorporadas ao MVP desta SPEC.

---

## 23. Resumo executivo

Esta SPEC define um Command Processor mínimo, orientado ao processamento de uma unidade de trabalho tipada, sem estado próprio, sem persistência, sem cache e sem lógica de workflow complexo. O objetivo é criar uma camada simples, previsível e alinhada com a arquitetura do Sebastian IA, para que o Core continue coordenando o sistema enquanto um módulo especializado processa uma execução unitária de forma explícita e estruturada.
