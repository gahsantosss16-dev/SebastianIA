# SPEC-011 — Conversation Manager

## Objetivo

Projetar uma camada responsável por gerenciar a memória conversacional do Sebastian IA utilizando exclusivamente o Memory Manager (SPEC-010) como mecanismo de persistência.

Esta camada deverá organizar o contexto de conversas sem implementar qualquer inteligência artificial, sem inferência de intenção e sem processamento semântico.

## Motivação

O projeto já possui uma base sólida para infraestrutura, erros, configuração, saúde e memória genérica. No entanto, ainda falta uma camada explícita para organizar o contexto conversacional de forma estruturada, isolada e previsível.

A necessidade desta SPEC é fornecer uma abstração mínima para:

- representar conversas;
- organizar sessões de interação;
- registrar mensagens;
- registrar decisões e pendências;
- armazenar resumos;
- preservar isolamento entre conversas e sessões.

Essa camada deve servir como base para futuros módulos de contexto, agentes e automações, sem introduzir comportamento de IA ou lógica de negócio avançada.

## Escopo

- criar a camada de conversation no core em core/conversation;
- implementar um Conversation Manager responsável por organizar o contexto conversacional;
- utilizar exclusivamente o Memory Manager (SPEC-010) como mecanismo de persistência;
- modelar os conceitos de Conversation, Session, Message, Decision, PendingTask e Summary;
- garantir isolamento explícito entre conversas e sessões;
- garantir proteção contra mutações externas nos objetos retornados;
- garantir que a remoção de uma conversa remova todos os seus dados associados;
- criar testes permanentes para a suíte do projeto.

## Responsabilidades

O Conversation Manager deverá:

- criar conversas;
- listar conversas;
- recuperar conversas;
- remover conversas;
- criar sessões;
- encerrar sessões;
- armazenar mensagens;
- recuperar mensagens;
- registrar decisões;
- registrar pendências;
- concluir ou cancelar pendências;
- armazenar resumos;
- recuperar o resumo mais recente.

## Arquitetura

A implementação proposta deve ser modular, explícita e compatível com o padrão arquitetural do projeto.

Estrutura sugerida:

- core/conversation/ConversationManager.ts: componente principal da camada;
- core/conversation/ConversationTypes.ts: tipos e estruturas de dados conceituais;
- core/conversation/ConversationErrors.ts: erros específicos da camada;
- core/conversation/index.ts: exportações públicas;
- tests/conversation-manager.test.ts: suíte permanente.

### Dependências permitidas

- Memory Manager (SPEC-010);
- AppError e infraestrutura de erros já existente;
- recursos nativos do runtime TypeScript/Node.js.

### Dependências não permitidas

- IA;
- LLM;
- embeddings;
- memória vetorial;
- RAG;
- busca semântica;
- sumarização automática;
- planejamento automático;
- raciocínio automático.

## Modelo de Dados

Os objetos abaixo devem ser suportados pela camada, com representação explícita e previsível.

### Conversation

Representa uma conversa lógica do usuário com o sistema.

Campos conceituais mínimos:

- id: string;
- title: string | undefined;
- createdAt: string;
- updatedAt: string;
- status: 'active' | 'closed';
- metadata: objeto opcional.

### Session

Representa uma sessão de interação dentro de uma conversa.

Campos conceituais mínimos:

- id: string;
- conversationId: string;
- createdAt: string;
- closedAt: string | undefined;
- status: 'active' | 'closed';
- metadata: objeto opcional.

### Message

Representa uma mensagem registrada dentro de uma sessão.

Campos conceituais mínimos:

- id: string;
- conversationId: string;
- sessionId: string;
- role: 'user' | 'assistant' | 'system';
- content: string;
- createdAt: string;
- metadata: objeto opcional.

### Decision

Representa uma decisão registrada durante a execução da conversa.

Campos conceituais mínimos:

- id: string;
- conversationId: string;
- sessionId: string;
- kind: string;
- summary: string;
- createdAt: string;
- metadata: objeto opcional.

### PendingTask

Representa uma pendência associada a uma conversa ou sessão.

Campos conceituais mínimos:

- id: string;
- conversationId: string;
- sessionId: string;
- title: string;
- status: 'pending' | 'completed' | 'cancelled';
- createdAt: string;
- completedAt: string | undefined;
- cancelledAt: string | undefined;
- metadata: objeto opcional.

### Summary

Representa um resumo textual da conversa ou da sessão.

Campos conceituais mínimos:

- id: string;
- conversationId: string;
- sessionId: string;
- content: string;
- createdAt: string;
- metadata: objeto opcional.

## API pública

A API pública deve ser pequena, explícita e assíncrona.

Métodos previstos:

- createConversation(input?): Promise<Conversation>
- listConversations(): Promise<Conversation[]>
- getConversation(id: string): Promise<Conversation | undefined>
- removeConversation(id: string): Promise<boolean>
- createSession(conversationId: string, input?): Promise<Session>
- closeSession(conversationId: string, sessionId: string): Promise<boolean>
- storeMessage(conversationId: string, sessionId: string, message: MessageInput): Promise<Message>
- getMessages(conversationId: string, sessionId: string): Promise<Message[]>
- registerDecision(conversationId: string, sessionId: string, decision: DecisionInput): Promise<Decision>
- registerPendingTask(conversationId: string, sessionId: string, task: PendingTaskInput): Promise<PendingTask>
- completePendingTask(conversationId: string, sessionId: string, taskId: string): Promise<boolean>
- cancelPendingTask(conversationId: string, sessionId: string, taskId: string): Promise<boolean>
- storeSummary(conversationId: string, sessionId: string, summary: SummaryInput): Promise<Summary>
- getLatestSummary(conversationId: string, sessionId: string): Promise<Summary | undefined>

### Decisão de design

A API deve ser assíncrona em todos os métodos para manter compatibilidade com o padrão adotado pela arquitetura do projeto e para permitir evolução futura para persistência externa sem reescrever o contrato público.

## Regras de negócio

- toda conversa deve possuir um identificador único;
- toda sessão deve pertencer a uma conversa existente;
- sessões devem permanecer isoladas dentro da conversa correspondente;
- conversas devem permanecer totalmente isoladas entre si;
- mensagens, decisões, pendências e resumos devem permanecer associados à conversa e à sessão corretas;
- não deve existir armazenamento próprio fora do Memory Manager;
- operações de leitura de objetos inexistentes devem retornar undefined ou false, conforme o caso;
- a remoção de uma conversa deve remover todos os seus dados associados;
- a criação de uma sessão deve exigir uma conversa válida;
- o encerramento de uma sessão deve marcar o estado como fechado sem alterar a existência do registro;
- os objetos retornados devem ser protegidos contra mutações externas;
- a API não deve expor diretamente a estrutura interna do Memory Manager.

## Persistência

A persistência da camada deve ser exclusivamente via Memory Manager.

### Regras de persistência

- o Conversation Manager não deve manter estado próprio além de um contrato de acesso ao Memory Manager;
- cada entidade deve ser armazenada em namespaces explícitos e isolados;
- a implementação deve usar o Memory Manager para armazenar e recuperar registros por chave e namespace;
- a estratégia de namespaces deve preservar o isolamento entre conversas e sessões;
- não devem existir arquivos, bancos de dados, caches externos ou armazenamento alternativo.

### Estratégia conceitual de armazenamento

A implementação pode utilizar uma organização conceitual baseada em namespaces, por exemplo:

- namespace principal de conversas;
- namespace dedicado a cada conversa;
- subregistro de sessões para cada conversa;
- subregistro de mensagens, decisões, pendências e resumos para cada sessão ou conversa.

Não há necessidade de introduzir um esquema de persistência próprio; o objetivo é manter a camada simples, previsível e compatível com o Memory Manager.

## Fluxo de funcionamento

### Criação de conversa

1. o consumidor solicita a criação de uma conversa;
2. o Conversation Manager valida os dados de entrada;
3. o manager cria um registro de conversa;
4. o manager armazena a conversa via Memory Manager;
5. o manager retorna uma cópia protegida do objeto.

### Criação de sessão

1. o consumidor solicita uma sessão para uma conversa;
2. o manager valida a existência da conversa;
3. o manager cria uma sessão vinculada à conversa;
4. o manager armazena a sessão e atualiza os metadados da conversa se necessário;
5. o manager retorna uma cópia protegida da sessão.

### Armazenamento de mensagens e outras entidades

1. o consumidor envia uma mensagem, decisão, pendência ou resumo;
2. o manager valida a conversa e a sessão;
3. o registro é persistido via Memory Manager;
4. o manager retorna uma cópia protegida da entidade criada.

### Remoção de conversa

1. o consumidor solicita a remoção de uma conversa;
2. o manager remove os dados associados à conversa do Memory Manager;
3. o manager retorna true se a conversa existia e foi removida.

## Tratamento de erros

A camada deve usar erros claros e explícitos, compatíveis com a infraestrutura de erros do projeto.

### Erros previstos

- InvalidConversationIdError: identificador inválido ou vazio;
- InvalidSessionIdError: identificador de sessão inválido ou vazio;
- ConversationNotFoundError: conversa inexistente;
- SessionNotFoundError: sessão inexistente;
- PendingTaskNotFoundError: pendência inexistente;
- ConversationPersistenceError: falha ao persistir ou recuperar dados no Memory Manager.

### Regras de tratamento

- entradas inválidas devem gerar erro tipado;
- operações de leitura de elementos inexistentes devem retornar undefined ou false quando a ausência for o comportamento esperado;
- falhas de persistência devem ser propagadas como erro explícito;
- a implementação não deve ocultar erros nem converter silenciosamente dados inválidos.

## Critérios de aceitação

A implementação desta SPEC será considerada adequada quando:

- a camada for capaz de criar, listar, recuperar e remover conversas;
- a camada for capaz de criar e encerrar sessões;
- a camada for capaz de armazenar e recuperar mensagens;
- a camada for capaz de registrar decisões e pendências;
- a camada for capaz de armazenar e recuperar resumos;
- a camada preserve isolamento entre conversas e sessões;
- a remoção de uma conversa remova todos os seus dados;
- os objetos retornados sejam protegidos contra mutações externas;
- a API seja inteiramente assíncrona;
- a persistência use exclusivamente o Memory Manager;
- a camada não implemente IA, LLM, embeddings, RAG ou outros recursos não autorizados.

## Critérios de homologação

A implementação desta SPEC será homologada quando:

- os testes permanentes forem aprovados;
- o build tiver sucesso;
- o typecheck tiver sucesso;
- o módulo estiver exportado pelo core central;
- a arquitetura permanecer simples e compatível com o restante do projeto;
- a documentação permanecer consistente com o comportamento implementado.

## Testes obrigatórios

A suíte permanente deve cobrir, no mínimo, os seguintes cenários:

- criação e recuperação de uma conversa;
- listagem de múltiplas conversas;
- remoção de conversa removendo todos os dados associados;
- criação e encerramento de sessão;
- armazenamento e recuperação de mensagens;
- registro de decisões;
- registro, conclusão e cancelamento de pendências;
- armazenamento e recuperação do resumo mais recente;
- isolamento entre conversas;
- isolamento entre sessões da mesma conversa;
- proteção contra mutação externa dos objetos retornados;
- rejeição de identificadores inválidos;
- uso exclusivo do Memory Manager como mecanismo de persistência.

## Fora de escopo

- IA;
- LLM;
- embeddings;
- memória vetorial;
- RAG;
- busca semântica;
- sumarização automática;
- planejamento;
- raciocínio;
- memória conversacional inteligente;
- integrações externas;
- persistência em banco de dados ou arquivos;
- interface de usuário.

## Possíveis evoluções futuras

Em SPECs futuras, esta camada poderá evoluir para:

- integração com agentes e runtime do core;
- observabilidade por eventos;
- histórico de contexto mais rico;
- integração com módulos de tarefas e decisões;
- suporte a persistência externa sem alterar o contrato público principal;
- expansão para modelos de contexto mais sofisticados.

No entanto, essas evoluções não devem ser implementadas nesta SPEC.

## Status

Especificação formal em elaboração
