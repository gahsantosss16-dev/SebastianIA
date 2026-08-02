# SPEC-036 - Specialized Agent Handoff Contract

## 1. Contexto

As SPECs ate a 035 consolidaram o ciclo de comando no Core, incluindo preparo de contexto, execucao e memoria.

A arquitetura homologada define explicitamente o fluxo Core -> Agente Especializado -> Ferramenta, mas ainda sem contrato arquitetural unico para o handoff entre Core e Agente.

A lacuna seguinte e formalizar essa fronteira de delegacao para responsabilidades especificas, preservando os contratos existentes e sem ampliar escopo.

---

## 2. Objetivo

Definir um contrato arquitetural unico de handoff entre o Core e um Agente Especializado para execucao de responsabilidades especificas.

---

## 3. Escopo

Esta SPEC define apenas:

- responsabilidade do Core no handoff;
- responsabilidade do Agente Especializado;
- contrato de entrada do handoff;
- contrato de saida do handoff;
- propagacao tipada de falhas;
- fronteira arquitetural Core -> Agente;
- invariantes operacionais;
- criterios de aceitacao;
- estrategia de testes;
- justificativa arquitetural.

---

## 4. Fora do Escopo

Esta SPEC nao inclui:

- implementacao;
- IA;
- LLM;
- selecao automatica de modelos;
- plugins;
- integracoes externas;
- banco de dados;
- persistencia;
- rede;
- paralelismo;
- orquestracao multipla;
- alteracoes em codigo.

---

## 5. Responsabilidade Arquitetural Unica

Formalizar o contrato de handoff Core -> Agente Especializado para execucao de uma responsabilidade especifica por chamada.

---

## 6. Responsabilidades por Modulo

### 6.1 Core

O Core deve:

- decidir quando delegar uma responsabilidade especializada;
- construir a entrada contratual do handoff;
- acionar exatamente um Agente Especializado por handoff;
- consumir a saida contratual do agente;
- propagar falhas tipadas sem mascaramento.

O Core nao deve:

- executar internamente a responsabilidade especializada delegada;
- depender de detalhes internos de implementacao do agente;
- introduzir cadeia multipla de handoffs nesta fronteira.

### 6.2 Agente Especializado

O Agente Especializado deve:

- receber entrada contratual valida do Core;
- executar somente sua responsabilidade especializada;
- devolver saida contratual tipada;
- devolver falha tipada com causa preservada quando aplicavel.

O Agente Especializado nao deve:

- assumir coordenacao global do sistema;
- acoplar o contrato a infraestrutura externa especifica;
- iniciar orquestracao multipla fora do contrato.

---

## 7. Fronteira Core -> Agente

Regra de fronteira:

- Core envia comando de handoff com contexto operacional minimo;
- Agente devolve resultado especializado tipado;
- a fronteira e contratual e nao expoe estado interno de nenhum modulo.

---

## 8. Contratos

### 8.1 Contrato de Entrada

Entrada minima do handoff deve conter, no minimo:

- identificador da responsabilidade especializada solicitada;
- identificador de execucao/correlacao;
- contexto minimo necessario para execucao especializada;
- referencia temporal da solicitacao.

### 8.2 Contrato de Saida

Saida do handoff deve ser tipada e explicita:

- sucesso com resultado especializado; ou
- falha tipada com causa preservada.

---

## 9. Propagacao de Falhas

Regras:

- falhas de contrato na entrada devem ser tipadas no limite do Core;
- falhas do Agente devem retornar tipadas e ser propagadas;
- proibido converter falha em sucesso parcial silencioso;
- proibido ocultar causa original quando disponivel.

---

## 10. Invariantes

- um unico handoff por chamada desta fronteira;
- Core permanece coordenador e nao executa responsabilidade especializada;
- Agente permanece executor especializado e nao vira orquestrador global;
- contratos de entrada e saida sao deterministas para mesma entrada;
- nenhuma responsabilidade homologada ate a SPEC-035 e alterada;
- nenhuma nova camada arquitetural e introduzida.

---

## 11. Criterios de Aceitacao

A SPEC-036 sera considerada adequada quando:

- existir contrato unico e explicito de handoff Core -> Agente;
- responsabilidades de Core e Agente estiverem claramente separadas;
- entrada e saida tipadas estiverem definidas de forma objetiva;
- propagacao tipada de falhas estiver definida sem mascaramento;
- nao houver orquestracao multipla nesta fronteira;
- nao houver alteracao de contratos homologados anteriores.

---

## 12. Estrategia de Testes

Quando implementada, a validacao permanente deve cobrir, no minimo:

- handoff bem-sucedido com contrato de entrada valido;
- rejeicao tipada de entrada invalida no Core;
- propagacao tipada de falha retornada pelo Agente;
- garantia de que o Core nao executa internamente a responsabilidade delegada;
- determinismo para entradas identicas;
- ausencia de mutacao indevida do payload de handoff entre os modulos.

---

## 13. Justificativa Arquitetural

Esta SPEC e a proxima evolucao natural apos a SPEC-035 porque formaliza a fronteira Core -> Agente prevista pela arquitetura, sem alterar o ciclo de comando ja consolidado.

O contrato elimina ambiguidade de delegacao, preserva responsabilidades unicas por modulo e evita overengineering ao limitar-se ao handoff minimo necessario.

## Status

Implementada - aguardando homologacao