# SPEC-009 — Configuration Manager

## Objetivo

Criar uma infraestrutura centralizada, explícita e tipada para armazenamento, consulta, validação e composição de configurações do Sebastian IA.

## Escopo

- criar a camada de configuration no core em core/config;
- implementar tipos explícitos para valores de configuração;
- implementar enum de origem de configuração;
- implementar schemas e validação mínima;
- implementar ConfigurationManager com armazenamento, substituição, remoção, validação e resolução;
- garantir imutabilidade profunda dos valores e entradas retornados;
- garantir atomicidade em setMany;
- criar erros próprios reutilizando a infraestrutura de AppError.

## Fora de escopo

- leitura automática de arquivos .env;
- acesso direto a process.env;
- JSON, YAML ou TOML;
- persistência;
- banco de dados;
- rede;
- secrets manager;
- criptografia;
- hot reload;
- watchers;
- decorators;
- reflexão;
- singleton;
- estado global;
- integração automática com outros módulos.

## Arquitetura

A implementação é modular e explícita:

- ConfigurationTypes.ts: tipos e fontes de configuração
- ConfigurationErrors.ts: erros tipados compatíveis com AppError
- ConfigurationSchema.ts: representação e validação mínima de schema
- ConfigurationManager.ts: armazenamento e resolução em memória

## API pública

- registerSchema(schema)
- removeSchema(key)
- getSchema(key)
- listSchemas()
- set(key, value, source?)
- setMany(entries, source?)
- get(key)
- getEntry(key)
- has(key)
- remove(key)
- clear()
- validate(key)
- validateAll()
- resolve(key)

## Regras de validação

- schemas são registrados por chave única;
- chaves vazias são rejeitadas;
- validate deve ser uma função;
- required assume false quando ausente;
- validate não aplica default automaticamente.

## Regras de resolução

- valor explícito armazenado tem prioridade;
- defaultValue do schema é usado depois;
- undefined é retornado quando não há valor nem default;
- valores explícitos inválidos e defaults inválidos geram erro tipado.

## Atomicidade de setMany

- todas as entradas são validadas antes da alteração;
- chaves duplicadas dentro do mesmo lote são rejeitadas;
- se qualquer entrada falhar, nenhuma entrada é aplicada.

## Imutabilidade

- objetos e arrays retornados são clonados e congelados profundamente;
- entradas e schemas expostos não permitem mutação do estado interno.

## Erros tipados

- InvalidConfigurationKeyError
- ConfigurationSchemaAlreadyRegisteredError
- InvalidConfigurationSchemaError
- ConfigurationValidationError
- DuplicateConfigurationEntryError

## Testes

A suíte permanente cobre os principais cenários de registro, validação, resolução, atomicidade, imutabilidade e isolamento.

## Limitações

- a implementação é somente em memória;
- não há integração automática com outros serviços.

## Riscos

- a API é deliberadamente pequena e explícita para manter o projeto alinhado à arquitetura atual.

## Critérios de homologação

- build sem erros;
- typecheck sem erros;
- testes permanentes válidos;
- documentação consistente.

## Status

Homologação pendente
