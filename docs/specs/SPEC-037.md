# SPEC-037 - Specialized Agent Tool Invocation Contract

## 1. Contexto

As SPECs ate a 036 consolidaram o fluxo de comando do Core e formalizaram o handoff Core -> Agente Especializado.

A arquitetura homologada explicita a etapa seguinte Agente Especializado -> Ferramenta, porem ainda sem um contrato arquitetural unico de invocacao nessa fronteira.

A lacuna imediata e definir essa fronteira de invocacao com contratos tipados e responsabilidades claras, sem ampliar escopo e sem alterar o que ja foi homologado.

---

## 2. Objetivo

Definir um contrato arquitetural unico de invocacao entre um Agente Especializado e uma Ferramenta.

---

## 3. Escopo

Esta SPEC define apenas:

- responsabilidade do Agente na invocacao;
- responsabilidade da Ferramenta;
- contrato de entrada da invocacao;
- contrato de saida da invocacao;
- propagacao tipada de falhas;
- fronteira arquitetural Agente -> Ferramenta;
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
- MCP;
- APIs;
- plugins;
- integracoes externas;
- banco de dados;
- persistencia;
- rede;
- paralelismo;
- alteracoes em codigo.

---

## 5. Responsabilidade Arquitetural Unica

Formalizar o contrato de invocacao Agente Especializado -> Ferramenta para execucao de uma responsabilidade especifica por chamada.

---

## 6. Responsabilidades por Modulo

### 6.1 Agente Especializado

O Agente deve:

- decidir qual ferramenta contratual deve ser invocada para a responsabilidade recebida;
- montar entrada contratual valida da invocacao;
- invocar exatamente uma Ferramenta por chamada desta fronteira;
- consumir a saida contratual da Ferramenta;
- propagar falhas tipadas sem mascaramento.

O Agente nao deve:

- executar internamente a responsabilidade da Ferramenta;
- acoplar o contrato a tecnologia externa especifica;
- iniciar orquestracao multipla nesta fronteira.

### 6.2 Ferramenta

A Ferramenta deve:

- receber entrada contratual valida;
- executar sua responsabilidade especifica dentro do seu limite;
- devolver saida contratual tipada;
- devolver falha tipada com causa preservada quando aplicavel.

A Ferramenta nao deve:

- assumir coordenacao do fluxo global do sistema;
- alterar contratos do Core ou do Agente;
- introduzir side effects fora de seu escopo declarado.

---

## 7. Fronteira Agente -> Ferramenta

Regra de fronteira:

- Agente envia comando de invocacao com contexto operacional minimo necessario;
- Ferramenta devolve resultado tipado de execucao;
- a fronteira e estritamente contratual e nao expoe estado interno entre modulos.

---

## 8. Contratos

### 8.1 Contrato de Entrada

Entrada minima da invocacao deve conter, no minimo:

- identificador da ferramenta alvo;
- identificador de execucao/correlacao;
- identificador da responsabilidade solicitada;
- payload minimo necessario para a execucao;
- referencia temporal da solicitacao.

### 8.2 Contrato de Saida

Saida da invocacao deve ser tipada e explicita:

- sucesso com resultado da ferramenta; ou
- falha tipada com causa preservada.

---

## 9. Propagacao de Falhas

Regras:

- falhas de contrato na entrada devem ser tipadas no limite do Agente;
- falhas da Ferramenta devem ser retornadas tipadas e propagadas;
- proibido converter falha em sucesso parcial silencioso;
- proibido ocultar causa original quando disponivel.

---

## 10. Invariantes

- uma unica invocacao de ferramenta por chamada desta fronteira;
- Agente permanece coordenador especializado e nao substitui a Ferramenta;
- Ferramenta permanece executora e nao vira orquestradora global;
- contratos de entrada e saida sao deterministas para mesma entrada;
- nenhuma responsabilidade homologada ate a SPEC-036 e alterada;
- nenhuma nova camada arquitetural e introduzida.

---

## 11. Criterios de Aceitacao

A SPEC-037 sera considerada adequada quando:

- existir contrato unico e explicito de invocacao Agente -> Ferramenta;
- responsabilidades de Agente e Ferramenta estiverem claramente separadas;
- entrada e saida tipadas estiverem definidas de forma objetiva;
- propagacao tipada de falhas estiver definida sem mascaramento;
- nao houver orquestracao multipla nesta fronteira;
- nao houver alteracao de contratos homologados anteriores.

---

## 12. Estrategia de Testes

Quando implementada, a validacao permanente deve cobrir, no minimo:

- invocacao bem-sucedida com contrato de entrada valido;
- rejeicao tipada de entrada invalida no Agente;
- propagacao tipada de falha retornada pela Ferramenta;
- garantia de que o Agente nao executa internamente a responsabilidade da Ferramenta;
- determinismo para entradas identicas;
- ausencia de mutacao indevida do payload de invocacao entre os modulos.

---

## 13. Justificativa Arquitetural

Esta SPEC e a continuidade natural da SPEC-036 porque fecha a proxima fronteira explicita do fluxo arquitetural (Agente -> Ferramenta) sem alterar os contratos anteriores.

O contrato reduz ambiguidade de invocacao, preserva responsabilidades unicas por modulo e evita overengineering ao limitar-se ao handoff minimo necessario entre os dois limites.

## Status

Implementada - aguardando homologacao