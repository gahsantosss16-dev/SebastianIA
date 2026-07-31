# SPEC-016 — Capability Provisioning Contract

## 1. Contexto

A Fase 1 foi encerrada com a base do Core estabilizada e com o fluxo de execução de capability já definido:

Core
  -> Command Processor
  -> Capability Registry
  -> Capability Resolver
  -> Capability Handler
  -> Result

A SPEC-014 formalizou o Capability Resolver e a SPEC-015 formalizou o Capability Registry como fonte explícita de catálogo declarativo.

Após a SPEC-015, permanece uma lacuna arquitetural objetiva: o processo de provisionamento das capabilities no registry ainda não está formalizado como contrato de módulo.

Sem essa camada, o Core tende a acumular montagem manual de registros, aumentando acoplamento e reduzindo previsibilidade de expansão.

---

## 2. Motivação

A evolução natural após a SPEC-015 é definir como capabilities são fornecidas ao Capability Registry antes do início da execução operacional.

Problemas que esta SPEC resolve:

- ausência de contrato único para declarar capabilities por provedor;
- risco de montagem ad-hoc do catálogo no Core;
- inconsistência potencial entre múltiplos provedores de capability;
- baixa auditabilidade da origem dos registros.

A proposta mantém o Core como orquestrador e preserva fronteiras: Plugin Manager continua em lifecycle, Registry continua em registro e consulta, Resolver continua em execução.

---

## 3. Objetivo

Definir uma camada mínima e explícita de provisionamento de capabilities que:

- padronize a origem dos registros de capability;
- componha registros de múltiplos provedores em ordem determinística;
- valide conflitos e contratos antes da publicação do catálogo;
- construa um Capability Registry pronto para uso do Resolver;
- mantenha operação síncrona, previsível e sem estado global oculto;
- lance erros tipados compatíveis com o Error Core em falhas de provisionamento.

---

## 4. Escopo

### Escopo desta SPEC

Criar o contrato de Capability Provisioning com:

- contrato público de provedor de capabilities;
- contrato público de bootstrap do Capability Registry;
- composição determinística de registros de capability;
- validação de duplicidade entre provedores;
- validação estrutural mínima de registros recebidos;
- publicação de registry em modo somente leitura para runtime.

### Escopo do MVP

O MVP deve suportar, no mínimo:

- receber uma lista explícita de provedores;
- coletar registros de capability de cada provedor;
- rejeitar conflito de capabilityId entre provedores;
- construir um único registry consistente para exportação de catálogo;
- operar sem descoberta automática e sem dependências externas.

---

## 5. Fora do escopo

Esta SPEC não inclui:

- execução de capabilities;
- roteamento de comandos;
- workflow de múltiplos passos;
- carregamento automático de plugins por arquivo;
- descoberta automática de provedores;
- ativação ou desativação de plugins;
- persistência em banco ou arquivo;
- cache distribuído;
- filas, retries ou processamento distribuído;
- IA, LLM, embeddings, RAG;
- alterações dinâmicas do catálogo em runtime após bootstrap;
- definição da SPEC-017.

---

## 6. Responsabilidades

### Capability Provisioning Contract

Responsável por:

- definir o formato explícito de um provedor de capabilities;
- coletar registros declarativos de capability;
- validar consistência mínima e conflitos;
- entregar estrutura final pronta para o Capability Registry.

Não responsável por:

- executar handlers;
- controlar lifecycle de plugin;
- selecionar fluxo de comando;
- persistir registros.

### Core

Permanece responsável por:

- orquestrar a ordem do bootstrap;
- escolher quais provedores participam da inicialização;
- tratar falhas de provisionamento.

### Plugin Manager

Permanece responsável por:

- lifecycle e disponibilidade de plugins;
- não provisionar catálogo diretamente;
- não executar o papel de registry.

### Capability Registry

Permanece responsável por:

- armazenar e expor descriptors e handlers;
- disponibilizar catálogo para o Resolver;
- operar em modo somente leitura em runtime.

### Capability Resolver

Permanece responsável por:

- validar invocation;
- resolver descriptor e handler no catálogo;
- executar handler e retornar resultado.

---

## 7. Arquitetura

### Posição na arquitetura

Core (coordenação)

Plugin Manager
  |
  v
Capability Providers
  |
  v
Capability Provisioning Contract
  |
  v
Capability Registry (read-only runtime)
  |
  v
Capability Resolver
  |
  v
Capability Handler

### Diretriz arquitetural

A nova camada não substitui nenhum módulo existente. Ela apenas formaliza o ponto de composição entre origem declarativa de capabilities e publicação controlada no registry.

---

## 8. Fluxos

### Fluxo 1 — Bootstrap de capabilities

1. Core define a lista de provedores de capability para inicialização.
2. Camada de provisioning solicita os registros declarativos de cada provedor.
3. Registros são validados por contrato mínimo.
4. Conflitos de identificador são detectados de forma determinística.
5. Lista consolidada é entregue para construção do Capability Registry.
6. Registry é publicado em modo somente leitura.

### Fluxo 2 — Falha de provisionamento

1. Provedor retorna contrato inválido ou registro inconsistente.
2. Camada de provisioning interrompe bootstrap.
3. Erro tipado é lançado com contexto da origem da falha.
4. Core trata falha sem converter em sucesso parcial silencioso.

### Fluxo 3 — Execução operacional

1. Core e Command Processor preparam invocation.
2. Core obtém catálogo do registry provisionado.
3. Core chama Capability Resolver com invocation e catálogo.
4. Resolver executa fluxo da SPEC-014 sem mudanças comportamentais.

---

## 9. API pública

A API pública desta SPEC deve ser mínima e explícita.

### 9.1 Contrato de provedor

Interface conceitual:

CapabilityProvider
- providerId: string
- listRegistrations(): readonly CapabilityRegistration[]

### 9.2 Contrato de bootstrap

Operação central:

buildRegistry(providers: readonly CapabilityProvider[]): CapabilityRegistry

Comportamento esperado:

- falha rápida em contratos inválidos;
- falha rápida em duplicidade de capabilityId;
- retorno de registry consistente e pronto para exportCatalog;
- nenhuma mutação global implícita.

### 9.3 Erros previstos

- InvalidCapabilityProviderError
- InvalidCapabilityProvisioningError
- DuplicateCapabilityProvisionError
- CapabilityProvisioningError

---

## 10. Regras

### Regras de contrato

- providerId deve ser string não vazia;
- listRegistrations deve retornar coleção válida;
- cada registro deve conter descriptor e handler válidos;
- descriptor.id deve ser único no conjunto consolidado.

### Regras de determinismo

- ordem de avaliação de provedores é definida pela lista de entrada;
- para mesma lista de provedores e mesmos registros, o resultado deve ser idêntico;
- não usar relógio interno, aleatoriedade ou estado global oculto.

### Regras de imutabilidade

- estruturas retornadas não devem expor referências mutáveis internas;
- catálogo final deve ser compatível com leitura somente.

### Regras de fronteira

- não absorver responsabilidades de Plugin Manager, Command Processor ou Resolver;
- não introduzir execução de handler na camada de provisioning;
- não transformar o Core em registry ou resolver.

---

## 11. Critérios de aceitação

A implementação desta SPEC será considerada adequada quando:

- houver contrato explícito para provedor de capabilities;
- o bootstrap consolidar registros de múltiplos provedores;
- duplicidades entre provedores forem rejeitadas com erro tipado;
- o registry resultante estiver pronto para exportCatalog;
- o fluxo operacional da SPEC-014 permanecer inalterado;
- o módulo permanecer síncrono, determinístico e sem estado global oculto;
- não houver ampliação para workflow, IA, persistência, filas ou descoberta automática.

---

## 12. Estratégia de testes

A implementação futura deve incluir testes permanentes cobrindo, no mínimo:

- bootstrap com um provedor válido;
- bootstrap com múltiplos provedores válidos;
- rejeição de providerId inválido;
- rejeição de listRegistrations inválido;
- rejeição de registro inválido de capability;
- rejeição de duplicidade de capabilityId entre provedores;
- estabilidade determinística para mesma entrada;
- imutabilidade das estruturas retornadas;
- compatibilidade do registry final com CapabilityResolver.invoke;
- preservação das fronteiras de responsabilidade entre módulos.

---

## 13. Riscos

Principais riscos:

- sobreposição indevida com responsabilidades do Plugin Manager;
- acoplamento excessivo do provisioning ao Core;
- evolução para descoberta automática prematura;
- crescimento de escopo para runtime dinâmico não previsto.

Mitigações:

- manter API estrita de contrato e bootstrap;
- preservar separação explícita entre lifecycle, registro e execução;
- manter provisionamento apenas na inicialização;
- falhar cedo em violações de contrato.

---

## 14. Critérios de homologação

A SPEC-016 será homologada quando:

- a implementação aderir integralmente a esta especificação;
- todos os testes permanentes da SPEC-016 passarem;
- npm test passar sem falhas;
- npm run build passar sem falhas;
- npm run typecheck passar sem falhas;
- exports públicos estiverem consistentes com arquitetura e fronteiras;
- documentação final estiver alinhada ao comportamento implementado.

---

## 15. Justificativa objetiva da sequência arquitetural

A SPEC-016 é a próxima evolução natural após a SPEC-015 porque resolve a lacuna imediatamente remanescente: a origem contratual e a consolidação determinística dos registros que alimentam o Capability Registry.

A SPEC-014 definiu execução, a SPEC-015 definiu armazenamento e consulta, e a SPEC-016 completa a etapa de entrada governada desses dados sem antecipar workflow, IA, persistência ou módulos de fases posteriores.

## Status

Implementada — aguardando homologação
