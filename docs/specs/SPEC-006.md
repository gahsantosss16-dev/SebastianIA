# SPEC-006 — Plugin Manager

## Objetivo

Implementar um Plugin Manager simples, tipado e previsível para registrar, consultar, ativar, desativar e remover plugins internos do Sebastian IA.

## Contexto

O projeto já possui infraestrutura central para eventos, container de serviços e lifecycle. Nesta SPEC, a necessidade é criar uma camada explícita de plugins, sem dependências externas, sem descoberta automática e sem estado global oculto.

## Escopo

- Criar um contrato público para plugins.
- Criar um PluginContext mínimo e tipado.
- Criar um Plugin Manager com registro, consulta, listagem e estados explícitos.
- Implementar ativação e desativação individuais.
- Implementar activateAll() e deactivateAll() com comportamento determinístico.
- Implementar remoção e clear() com regras de segurança.
- Criar erros tipados públicos para falhas e estados inválidos.
- Criar testes permanentes com o runner nativo do Node.

## Itens fora do escopo

- carregamento por arquivo;
- import() dinâmico;
- descoberta automática;
- plugins externos;
- integrações com IA, memória, rede, banco de dados, UI ou ferramentas.

## Estrutura implementada

- core/plugins/PluginTypes.ts
- core/plugins/PluginErrors.ts
- core/plugins/PluginManager.ts
- core/plugins/index.ts
- tests/plugin-manager.test.ts

## Contrato do plugin

O contrato público inclui:

- id
- name
- version
- description opcional
- activate(context)
- deactivate()

## PluginContext

O PluginContext é opcional e mínimo. Ele pode receber referências explícitas para infraestrutura futura, sem criar dependência global.

## Metadados

Cada plugin expõe metadados mínimos validados como strings não vazias.

## Estados

Os estados implementados são:

- registered
- activating
- active
- deactivating
- inactive
- failed

## Registro e consulta

O registro valida o contrato mínimo, rejeita identificadores duplicados e define o estado inicial como registered.
A consulta por identificador retorna undefined quando o plugin não existe.

## Ativação individual

A ativação individual exige que o plugin esteja registrado e em estado seguro. O estado é alterado para activating antes da execução do método activate(). Em caso de sucesso, o estado passa para active. Em caso de erro, o estado vai para failed e a causa original é preservada.

## Desativação individual

A desativação individual segue o mesmo padrão, alterando o estado para deactivating antes da execução de deactivate(). Em caso de sucesso, o estado torna-se inactive. Em caso de erro, o estado vira failed e a causa original é preservada.

## activateAll()

A ativação em lote segue a ordem de registro e executa sequencialmente. Se um plugin falhar, a operação é interrompida e os plugins ativados pela operação atual são desativados em ordem inversa.

## rollback

O rollback de activateAll() afeta apenas os plugins ativados durante a operação atual. Plugins já ativos antes da chamada não são desativados. A ordem de desativação segue a ordem inversa da ativação realizada pela própria operação.

## deactivateAll()

A desativação em lote executa na ordem inversa do registro, tenta desativar todos os plugins ativos e agrega múltiplas falhas em um erro público.

## Remoção e clear()

A remoção só é permitida para plugins em estados seguros. A clear() remove todos os plugins apenas quando todos os estados são seguros; caso contrário, a operação é bloqueada sem remover registros parcialmente.

## Erros tipados

Os erros públicos criados são:

- InvalidPluginError
- PluginAlreadyRegisteredError
- PluginNotFoundError
- InvalidPluginStateError
- PluginActivationError
- PluginDeactivationError
- PluginAggregateError

## Integrações

- Não há integração automática com Lifecycle Manager.
- Não há integração automática com Service Container.
- Não há emissão de eventos obrigatória nesta SPEC.

## Testes realizados

Os testes permanentes cobrem registro, consulta, estados, ativação, desativação, activateAll(), deactivateAll(), remoção, clear() e concorrência.

## Decisões técnicas

- A implementação é explícita e independente de estado global.
- Não há descoberta automática, decorators, reflection ou carregamento dinâmico.
- O design foi mantido simples e orientado por contratos públicos tipados.

## Limitações

- Esta SPEC não implementa carregamento de plugins externos, dependências entre plugins ou persistência.

## Riscos

- Crescimento futuro sem definir contratos claros para plugins.
- Expansão de funcionalidades sem respeitar a simplicidade inicial da infraestrutura.

## Resultado

A infraestrutura central do Plugin Manager foi implementada e validada com testes permanentes.

## Status

Homologação pendente
