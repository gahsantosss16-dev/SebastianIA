# SPEC-034 - Command Result Memory Contract

## 1. Contexto

As SPECs ate a 033 consolidaram o pipeline de comando no Core, incluindo validacao, execucao, classificacao de resultado e trilha de auditoria.

A arquitetura homologada define que o fluxo sistemico percorre Resultado -> Validacao -> Memoria.

A lacuna arquitetural seguinte e formalizar o contrato de write-back do resultado validado de comando no limite entre Core e modulo Memory, sem alterar responsabilidades ja homologadas.

---

## 2. Objetivo

Definir um contrato arquitetural unico para registro em memoria do resultado validado de um comando executado pelo Core.

---

## 3. Escopo

Esta SPEC define apenas:

- responsabilidade do Core no write-back pos-execucao;
- responsabilidade do modulo Memory no recebimento e registro do resultado;
- contrato de write-back do resultado validado;
- fronteira arquitetural Core -> Memory;
- invariantes operacionais desse contrato;
- criterios de aceitacao;
- estrategia de testes;
- justificativa arquitetural.

---

## 4. Fora do Escopo

Esta SPEC nao inclui:

- implementacao;
- persistencia real;
- banco de dados;
- RAG;
- vetores;
- embeddings;
- cache;
- plugins;
- IA;
- integracoes externas;
- alteracoes em codigo;
- alteracoes na arquitetura existente.

---

## 5. Responsabilidade Arquitetural Unica

Formalizar o contrato de write-back do resultado validado de comando do Core para o modulo Memory.

---

## 6. Responsabilidades por Modulo

### 6.1 Core

O Core deve:

- concluir o pipeline de comando conforme contratos homologados;
- produzir o resultado validado final da execucao;
- acionar o write-back para Memory no limite pos-validacao;
- propagar falhas tipadas do write-back sem mascaramento de sucesso.

O Core nao deve:

- assumir responsabilidades internas de armazenamento do modulo Memory;
- redefinir politicas de persistencia;
- criar nova camada de orquestracao.

### 6.2 Memory

O modulo Memory deve:

- receber o payload de resultado validado conforme contrato;
- registrar o resultado de forma compativel com suas fronteiras existentes;
- preservar integridade sem mutar o payload recebido;
- retornar confirmacao tipada de registro ou falha tipada.

O modulo Memory nao deve:

- reexecutar pipeline de comando;
- reclassificar resultado do comando;
- acoplar o contrato a tecnologia de persistencia especifica.

---

## 7. Fronteira Core -> Memory

Regra de fronteira:

- Core entrega resultado validado para write-back;
- Memory registra e devolve status tipado de operacao;
- a fronteira e contratual, sem exposicao de detalhes internos de armazenamento.

---

## 8. Contrato de Write-back

### 8.1 Entrada do write-back

Entrada minima do contrato deve conter, no minimo:

- identificador de comando/execucao;
- referencia temporal do resultado;
- classificacao final do resultado;
- output validado do comando;
- metadados essenciais de contexto necessarios para rastreabilidade.

### 8.2 Saida do write-back

Saida do contrato deve ser tipada e explicita:

- sucesso de registro; ou
- falha tipada com causa preservada.

---

## 9. Invariantes

- write-back ocorre somente apos resultado validado;
- Core nao registra memoria antes de validacao final;
- Memory nao altera semanticamente o resultado recebido;
- nenhuma etapa interna do pipeline homologado e modificada;
- ausencia de fallback silencioso para ocultar falha de write-back;
- mesma entrada contratual produz comportamento deterministico no limite do contrato.

---

## 10. Criterios de Aceitacao

A SPEC-034 sera considerada adequada quando:

- existir contrato unico e explicito de write-back Core -> Memory;
- responsabilidades de Core e Memory estiverem claramente separadas;
- write-back usar resultado validado como precondicao obrigatoria;
- falhas de write-back forem tipadas e propagadas sem mascaramento;
- nao houver nova camada arquitetural;
- nao houver alteracao de responsabilidades homologadas ate a SPEC-033.

---

## 11. Estrategia de Testes

Quando implementada, a validacao permanente deve cobrir, no minimo:

- Core aciona write-back apenas apos resultado validado;
- payload entregue ao Memory respeita o contrato definido;
- Memory confirma registro com retorno tipado de sucesso;
- falha tipada do Memory e propagada pelo Core;
- nao ocorre mutacao do payload no limite Core -> Memory;
- comportamento deterministico para mesma entrada contratual.

---

## 12. Justificativa Arquitetural

Esta SPEC e a proxima evolucao natural apos a SPEC-033 porque fecha o ciclo arquitetural de execucao ate memoria sem introduzir novas camadas.

Ela preserva a arquitetura homologada: Core continua coordenando, Memory continua registrando.

O foco permanece em uma unica responsabilidade legitima, evitando overengineering e mantendo compatibilidade integral com os contratos anteriores.

## Status

Implementada - aguardando homologacao