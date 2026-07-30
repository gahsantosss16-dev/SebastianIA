# SPEC-005 — Lifecycle Manager

## Objetivo

Implementar um Lifecycle Manager simples, tipado e previsível para coordenar a inicialização e o encerramento de componentes internos do Sebastian IA.

## Escopo

- Criar uma infraestrutura mínima de ciclo de vida.
- Definir um contrato para componentes gerenciáveis.
- Permitir registro, remoção, listagem e execução sequencial de componentes.
- Manter o módulo independente, sem acoplar com Event Bus, Service Container, IA, memória ou plugins.

## Contrato implementado

A implementação atual expõe um contrato baseado em:

- `id`
- `order`
- `start()`
- `stop()`

Além disso, o manager fornece:

- `register(component)`
- `remove(id)`
- `list()`
- `isRegistered(id)`
- `start()`
- `stop()`
- `getState()`

## Estados

Os estados explícitos implementados são:

- `idle`
- `starting`
- `running`
- `stopping`
- `stopped`
- `failed`

## Ordem de inicialização

A inicialização executa componentes em ordem crescente de prioridade. Quando a prioridade é igual, a ordem de registro é preservada.

## Ordem de encerramento

O encerramento executa os componentes iniciados em ordem inversa.

## Tratamento de falhas

- Falhas na inicialização alteram o estado para `failed`.
- O erro original é propagado com mensagens claras.
- Componentes já iniciados com sucesso são encerrados em ordem inversa durante a recuperação da falha.
- Falhas no encerramento são coletadas e reportadas sem interromper o restante do processo.

## Decisões técnicas

- O Lifecycle Manager foi mantido independente e sem dependências externas.
- A implementação evita overengineering e preserva o comportamento previsível exigido para esta fase.
- Não há singleton global obrigatório nem estado global oculto.

## Validações realizadas

Foram validadas, com base no código real, as seguintes situações:

1. dois componentes iniciam em ordem crescente;
2. componentes com a mesma prioridade preservam a ordem de registro;
3. encerramento ocorre em ordem inversa;
4. registro duplicado lança erro;
5. inicialização duplicada é impedida;
6. encerramento duplicado é tratado de modo seguro;
7. falha durante a inicialização altera o estado para `failed`;
8. após falha na inicialização, componentes iniciados são encerrados em ordem inversa;
9. falhas durante o encerramento não impedem os demais encerramentos;
10. remoção em estado inseguro é bloqueada.

## Limitações

- A implementação atual é simples e não oferece paralelismo, dependências automáticas, timeouts, retry ou descoberta automática de componentes.

## Resultado

A infraestrutura do Lifecycle Manager está implementada e validada para a fase atual.

## Status

Homologação pendente
