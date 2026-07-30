# SPEC-004 — Service Container (Dependency Injection)

## Objetivo

Implementar um Service Container próprio para registrar, resolver e gerenciar serviços internos do Sebastian IA, mantendo a arquitetura modular e reduzindo o acoplamento causado por múltiplos `new` espalhados pelo projeto.

## Escopo

- Criar uma camada de infraestrutura de container.
- Permitir registro de serviços, instâncias e singletons.
- Manter a implementação simples, tipada e independente de bibliotecas externas.
- Não implementar DI automática, decorators, reflection, scopes HTTP ou qualquer funcionalidade de negócio.

## API implementada

A implementação atual expõe:

- `register(identifier, factory)`
- `registerSingleton(identifier, factory)`
- `registerInstance(identifier, instance)`
- `resolve(identifier)`
- `has(identifier)`
- `remove(identifier)`
- `clear()`

### Observação

A versão atual não implementa um método explícito `registerFactory`. O comportamento associado a esse tipo de registro não foi adicionado nesta revisão.

## Comportamento dos ciclos de vida

- `registerSingleton` cria a instância na primeira resolução e reutiliza a mesma instância nas próximas.
- `registerInstance` sempre retorna a mesma instância registrada.
- `resolve` de um identificador inexistente lança um erro com a mensagem `Service not registered: ...`.
- Reregistrar um identificador existente sobrescreve o registro anterior no mapa interno.
- `remove` elimina o registro e a instância singleton armazenada para esse identificador.
- `clear` remove todos os registros e todas as instâncias armazenadas.

## Decisões técnicas

- O container foi mantido como uma infraestrutura independente, sem depender de frameworks ou bibliotecas externas.
- A API foi desenhada para ser simples e tipada, preservando o tipo associado ao identificador na interface pública.
- Não existe um singleton global obrigatório nem estado global oculto; o container é uma instância explícita e local.

## Validações realizadas

Foram verificadas, com base no código real, as seguintes situações:

- registro e resolução de instância;
- singleton resolvido duas vezes com igualdade de referência;
- has antes e depois de remove;
- clear removendo todos os registros;
- erro ao resolver identificador inexistente.

## Resultado

A infraestrutura do Service Container está implementada e validada para o escopo atual, com comportamento simples e previsível.

## Status

Homologação pendente
