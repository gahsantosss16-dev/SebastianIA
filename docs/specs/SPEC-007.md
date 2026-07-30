# SPEC-007 — Error Handling

## Objetivo

Criar uma infraestrutura centralizada para representação, classificação e propagação consistente de erros no Sebastian IA.

## Contexto

O projeto já possui módulos independentes para core, eventos, container, lifecycle e plugins. Nesta SPEC, a necessidade é garantir que todo erro futuro possa herdar de uma base comum, com código, categoria, severidade, causa, metadados e timestamp.

## Escopo

- criar a camada central de erros em core/errors;
- implementar AppError como classe base pública;
- criar enums para severidade e categoria;
- criar códigos explícitos para erros iniciais;
- criar uma ErrorFactory simples para criação e wrapping de erros;
- criar testes permanentes com o runner nativo do Node.

## Itens fora do escopo

- logging;
- telemetry;
- observabilidade;
- métricas;
- OpenTelemetry;
- integração externa;
- persistência;
- HTTP;
- UI;
- IA;
- plugins automáticos.

## Estrutura implementada

- core/errors/AppError.ts
- core/errors/ErrorCodes.ts
- core/errors/ErrorSeverity.ts
- core/errors/ErrorCategory.ts
- core/errors/ErrorFactory.ts
- core/errors/index.ts
- tests/error-handling.test.ts

## AppError

AppError herda de Error e expõe:

- code
- message
- category
- severity
- cause
- metadata
- timestamp

O timestamp é criado automaticamente e o metadata é tratado como valor imutável.

## Enums

Os enums implementados são:

- ErrorSeverity: INFO, WARNING, ERROR, FATAL
- ErrorCategory: SYSTEM, PLUGIN, LIFECYCLE, CONTAINER, EVENTBUS, VALIDATION, UNKNOWN

## ErrorCodes

Os códigos iniciais implementados são:

- UNKNOWN_ERROR
- INVALID_ARGUMENT
- INVALID_STATE
- NOT_FOUND
- ALREADY_EXISTS
- OPERATION_FAILED

## ErrorFactory

A ErrorFactory oferece:

- create()
- wrap()
- unknown()

O wrap() preserva a causa original quando aplicável.

## Regras de design

- sem estado global;
- sem singleton;
- sem dependências externas;
- sem decorators;
- sem reflexão;
- sem overengineering.

## Testes realizados

A suíte de testes cobre criação, timestamp, metadata opcional, cause opcional, preservação de causa, wrap(), unknown(), enums, códigos, instanceof, serialização e imutabilidade.

## Decisões técnicas

- a implementação é explícita e modular;
- a API é pequena e centralizada;
- a estrutura é compatível com o restante do core atual.

## Limitações

- esta SPEC não implementa integração com logging, observabilidade ou persistência.

## Resultado

A infraestrutura central de error handling foi implementada e validada com testes permanentes.

## Status

Homologação pendente
