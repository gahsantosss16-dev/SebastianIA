# SPEC-010 — Memory Manager

## Objetivo

Criar uma infraestrutura centralizada, explícita e tipada para armazenamento, recuperação, verificação e remoção de entradas de memória no Sebastian IA, com isolamento por namespace.

## Contexto

O projeto já possui uma base sólida de infraestrutura para eventos, container de serviços, ciclo de vida, plugins, erros, health e configuração. Nesta SPEC, a necessidade é avançar para a camada de memória, mantendo o mesmo padrão arquitetural: módulos pequenos, independentes, previsíveis e sem dependências externas.

A implementação desta SPEC deve fornecer um mecanismo abstrato de armazenamento em memória para uso futuro por componentes do núcleo, agentes, contexto e outros módulos de execução, sem assumir comportamento de negócio, persistência, aprendizado ou recuperação semântica.

## Escopo

- criar a camada de memória no core em core/memory;
- implementar um MemoryManager com armazenamento e consulta por namespace;
- garantir isolamento explícito entre namespaces;
- aceitar valores tipados genericamente;
- implementar validação mínima para namespace e chave;
- definir comportamento previsível para sobrescrita, verificação, remoção e limpeza;
- preservar isolamento do estado interno contra mutações externas;
- criar testes permanentes com o runner nativo do Node.

## Fora de escopo

- memória permanente;
- banco de dados;
- armazenamento em arquivos;
- memória conversacional;
- histórico de mensagens;
- perfis de usuário;
- memória episódica ou semântica;
- embeddings;
- busca vetorial;
- recuperação semântica;
- RAG;
- seleção automática de contexto;
- integração com LLMs;
- agentes;
- ferramentas;
- políticas de privacidade;
- criptografia;
- expiração e TTL;
- replicação;
- sincronização entre dispositivos;
- interface de usuário;
- serialização para formato externo.

## Arquitetura proposta

A implementação inicial deve ser modular e explícita, com uma estrutura simples:

- core/memory/MemoryManager.ts: componente principal de armazenamento e consulta;
- core/memory/MemoryErrors.ts: erros mínimos para entradas inválidas;
- core/memory/index.ts: exportações públicas do módulo;
- tests/memory-manager.test.ts: testes permanentes.

## Contrato público

A API pública mínima proposta é:

- set(namespace, key, value): Promise<void>
- get(namespace, key): Promise<T | undefined>
- has(namespace, key): Promise<boolean>
- remove(namespace, key): Promise<boolean>
- clearNamespace(namespace): Promise<void>
- clear(): Promise<void>
- size(): Promise<number>

### Decisão de design

A API deve ser assíncrona. Essa decisão é mais compatível com a evolução arquitetural do projeto porque implementações futuras poderão usar banco de dados, Redis, SQLite, Supabase ou outros mecanismos de persistência sem exigir uma mudança de contrato. A implementação inicial em memória pode simplesmente devolver uma Promise resolvida imediatamente, preservando o mesmo contrato e mantendo o componente previsível para o restante do core.

## Regras de namespace

- todo valor armazenado deve pertencer a um namespace explícito;
- namespace é obrigatório;
- namespace deve ser uma string não vazia;
- namespace composto apenas por espaços é inválido;
- namespaces diferentes isolam chaves iguais;
- a mesma chave pode existir em namespaces distintos.

Exemplos conceituais de uso:
- namespace `conversation`
- namespace `user-preferences`
- namespace `runtime`

Esses exemplos não devem ser codificados como valores fixos nem como constantes internas do módulo.

## Regras de chave

- a chave deve ser uma string;
- a chave deve ser não vazia;
- chave composta apenas por espaços é inválida;
- a chave é única dentro do namespace correspondente;
- sobrescrever uma chave existente substitui o valor anterior.

## Regras de valor

O Memory Manager deve aceitar valores tipados genericamente.

### Decisão de isolamento de valores

Os valores armazenados devem ser protegidos contra mutações externas que possam alterar o estado interno do Memory Manager. O contrato não exige uma técnica específica de implementação. Implementações futuras podem escolher copiar valores, congelar objetos, usar estruturas imutáveis ou outra estratégia adequada, desde que o comportamento observado pelo consumidor seja o mesmo: uma mutação posterior em uma referência externa não deve alterar o valor já armazenado nem expor o estado interno de forma mutável.

## Comportamento operacional

### Armazenamento

- set(namespace, key, value) armazena um valor associado a um namespace e chave específicos;
- se a chave já existir no mesmo namespace, o valor anterior é substituído;
- a operação resolve sem valor de retorno, pois o sucesso da escrita é implícito pela conclusão da Promise.

### Recuperação

- get(namespace, key) retorna o valor armazenado, quando existir;
- se a chave não existir no namespace indicado, retorna undefined.

### Verificação

- has(namespace, key) retorna true quando a entrada existe no namespace indicado e false caso contrário.

### Remoção

- remove(namespace, key) remove a entrada correspondente quando existir;
- se a entrada não existir, a operação retorna false.

### Limpeza por namespace

- clearNamespace(namespace) remove todas as entradas pertencentes ao namespace informado;
- se o namespace não existir, a operação não gera erro e não altera o estado;
- a operação resolve sem valor de retorno.

### Limpeza completa

- clear() remove todas as entradas da instância do Memory Manager;
- a operação resolve sem valor de retorno.

### Contagem

- size() retorna a quantidade total de entradas armazenadas em toda a memória da instância, independentemente de namespace.

## Erros e validações

O Memory Manager deve rejeitar entradas inválidas com erros claros e explícitos.

### Erros previstos

- InvalidMemoryNamespaceError: namespace inválido ou vazio;
- InvalidMemoryKeyError: chave inválida ou vazia.

### Comportamento previsto

- namespace vazio deve lançar erro;
- chave vazia deve lançar erro;
- recuperar uma chave inexistente deve retornar undefined;
- remover uma chave inexistente deve retornar false;
- a implementação deve preferir comportamento previsível e minimalista em vez de lançar exceções para operações de ausência.

A infraestrutura de erros já existente deve ser reutilizada somente se isso trouxer consistência real ao contrato público. Nesta SPEC, a decisão inicial é manter os erros do Memory Manager simples e compatíveis com a filosofia do projeto, sem introduzir complexidade desnecessária.

## Eventos

Eventos não serão incluídos nesta SPEC.

### Justificativa

A primeira versão do Memory Manager deve permanecer focada no gerenciamento abstrato de entradas de memória. Event Bus introduziria acoplamento adicional e não é necessário para o comportamento mínimo. A emissão de eventos pode ser considerada em SPECs futuras, se houver uma necessidade real de observabilidade ou integração.

## Concorrência e atomicidade

A primeira implementação será executada em memória dentro do mesmo runtime do Node.js e resolverá imediatamente em uma Promise. A API continua assíncrona para manter compatibilidade com futuras implementações de persistência externa.

Não serão incluídos:
- locks;
- filas;
- transações distribuídas;
- concorrência entre processos.

O comportamento esperado para operações consecutivas é o seguinte:
- operações aguardadas sequencialmente com await devem produzir resultados na sequência em que foram aguardadas;
- quando a ordem for importante, o consumidor é responsável por aguardar a conclusão da operação anterior;
- chamadas iniciadas concorrentemente, sem aguardar a anterior, não possuem garantia de ordem;
- o Memory Manager não implementará filas, locks ou serialização automática nesta SPEC.

## Integração arquitetural futura

Esta SPEC não implementa integrações automáticas.

O Memory Manager poderá futuramente:
- ser registrado no Service Container;
- ser utilizado por agentes;
- ser utilizado por uma camada de contexto;
- ser substituído por outra implementação sem alterar o contrato público básico.

No entanto, a implementação inicial não deve depender diretamente de:
- Plugin Manager;
- Lifecycle Manager;
- Agent Runtime;
- modelos de IA.

## Contratos previstos

A SPEC deve manter o contrato público pequeno e explícito.

### Contratos públicos previstos

- MemoryManager: componente principal que expõe as operações públicas.

A implementação inicial não deve introduzir múltiplas interfaces ou abstrações sem necessidade comprovada. O foco deve ser um contrato simples, legível e alinhado com os demais módulos do core. Tipos adicionais para entrada, namespace ou chave só devem ser adicionados se houver benefício real para a implementação ou para os testes.

## Implementação inicial prevista

A implementação posterior deverá usar apenas recursos nativos do TypeScript e Node.js.

Não serão utilizados:
- dependências externas;
- banco de dados;
- filesystem;
- localStorage;
- cache externo;
- embeddings;
- vetores;
- mecanismos de expiração;
- TTL;
- limite automático de tamanho;
- criptografia;
- compressão.

## Testes previstos

A suíte permanente deve cobrir, no mínimo, os seguintes cenários:

- armazenamento e recuperação;
- isolamento entre namespaces;
- sobrescrita de uma chave existente;
- verificação de existência;
- remoção de entrada existente;
- remoção de entrada inexistente;
- limpeza de namespace;
- preservação dos demais namespaces durante uma limpeza;
- limpeza completa;
- contagem de entradas;
- rejeição de namespace vazio;
- rejeição de chave vazia;
- comportamento dos valores mutáveis conforme a decisão de isolamento;
- ausência de exposição indevida do estado interno.

## Critérios de homologação

A implementação desta SPEC será considerada adequada quando:

- os testes permanentes forem aprovados;
- o build tiver sucesso;
- o typecheck tiver sucesso;
- a API pública permanecer pequena e explícita;
- não houver dependências externas;
- a implementação permanecer dentro do escopo definido;
- o módulo estiver exportado pelo core central.

## Status

Homologada
