# SPEC-035 - Command Context Hydration Contract

## 1. Contexto

As SPECs ate a 034 consolidaram o ciclo de execucao de comando com validacao, resultado e write-back para Memory no limite pos-execucao.

A arquitetura homologada exige que o Core coordene modulos independentes e que Memory preserve contexto entre interacoes.

A lacuna arquitetural seguinte e formalizar o contrato de hidratacao de contexto antes da execucao de comando, estabelecendo a fronteira de leitura Memory -> Context/Core sem alterar responsabilidades ja homologadas.

---

## 2. Objetivo

Definir um contrato arquitetural unico para leitura de contexto no modulo Memory e consumo desse contexto por Core/Context antes da execucao de comandos.

---

## 3. Escopo

Esta SPEC define apenas:

- responsabilidade do modulo Memory na leitura de contexto;
- responsabilidade de Core/Context no consumo do contexto hidratado;
- contrato de hidratacao de contexto pre-execucao;
- fronteira arquitetural Memory -> Context/Core;
- invariantes operacionais do contrato;
- criterios de aceitacao;
- estrategia de testes;
- justificativa arquitetural.

---

## 4. Fora do Escopo

Esta SPEC nao inclui:

- implementacao;
- persistencia real;
- banco de dados;
- cache;
- RAG;
- vetores;
- embeddings;
- IA;
- plugins;
- alteracoes em codigo;
- alteracoes na arquitetura existente.

---

## 5. Responsabilidade Arquitetural Unica

Formalizar o contrato de hidratacao de contexto pre-comando por leitura em Memory e consumo por Context/Core.

---

## 6. Responsabilidades por Modulo

### 6.1 Memory

O modulo Memory deve:

- receber uma requisicao contratual de leitura de contexto;
- retornar snapshot de contexto tipado e coerente com o contrato;
- preservar integridade e nao expor estado mutavel interno;
- retornar ausencia de dados de forma explicita quando nao houver contexto.

O modulo Memory nao deve:

- executar comando;
- decidir politica de orquestracao do Core;
- acoplar o contrato a tecnologia de persistencia especifica.

### 6.2 Core/Context

Core/Context deve:

- solicitar hidratacao de contexto antes da execucao de comando;
- consumir o snapshot retornado como entrada de contexto da execucao;
- tratar ausencia de contexto como estado valido e explicito;
- propagar falhas tipadas de hidratacao sem mascaramento.

Core/Context nao deve:

- acessar armazenamento interno do Memory diretamente;
- reimplementar logica de leitura interna do Memory;
- introduzir camada adicional para contornar a fronteira contratual.

---

## 7. Fronteira Memory -> Context/Core

Regra de fronteira:

- Memory fornece snapshot de contexto conforme contrato;
- Context/Core consome o snapshot para preparar execucao de comando;
- a fronteira e estritamente contratual, sem vazamento de detalhes internos.

---

## 8. Contrato de Hidratacao de Contexto

### 8.1 Entrada de hidratacao

Entrada minima do contrato deve conter, no minimo:

- identificador de conversa ou sessao aplicavel;
- referencia temporal da solicitacao;
- metadados minimos para rastreabilidade da leitura.

### 8.2 Saida de hidratacao

Saida contratual deve ser tipada e explicita:

- contexto hidratado disponivel; ou
- contexto ausente de forma explicita; ou
- falha tipada com causa preservada.

---

## 9. Invariantes

- hidratacao ocorre antes da execucao de comando;
- ausencia de contexto nao e tratada como erro silencioso nem como dado fabricado;
- snapshot retornado nao compartilha referencias mutaveis com estado interno do Memory;
- Core/Context nao altera responsabilidades homologadas do pipeline de comando;
- falhas de leitura sao tipadas e propagadas;
- mesma entrada contratual produz comportamento deterministico no limite do contrato.

---

## 10. Criterios de Aceitacao

A SPEC-035 sera considerada adequada quando:

- existir contrato unico e explicito para hidratacao pre-comando;
- responsabilidades de Memory e Core/Context estiverem separadas com clareza;
- hidratacao ocorrer no ponto pre-execucao definido pelo contrato;
- ausencia de contexto for tratada explicitamente;
- falhas de hidratacao forem tipadas e propagadas sem mascaramento;
- nenhuma nova camada arquitetural for introduzida;
- nao houver alteracao de responsabilidades homologadas ate a SPEC-034.

---

## 11. Estrategia de Testes

Quando implementada, a validacao permanente deve cobrir, no minimo:

- leitura bem-sucedida de contexto no Memory conforme contrato;
- consumo do contexto hidratado por Core/Context antes da execucao;
- tratamento explicito de contexto ausente;
- propagacao de falhas tipadas de hidratacao;
- ausencia de mutacao do snapshot hidratado no limite entre modulos;
- determinismo para entradas contratuais identicas.

---

## 12. Justificativa Arquitetural

Esta SPEC e a evolucao natural apos a SPEC-034 porque complementa o ciclo da memoria: alem de write-back pos-execucao, define o read-back pre-execucao para preparacao de contexto.

Ela preserva a arquitetura homologada: Memory continua responsavel por leitura/registro de contexto e Core/Context continua coordenando e consumindo contexto.

O foco permanece em uma unica responsabilidade legitima, sem novas camadas e sem overengineering.

## Status

Implementada - aguardando homologacao