# SPEC-023 - Command Processing Result Adapter

## 1. Contexto

A arquitetura atual ja possui os blocos necessarios para processamento e execucao de capability:

Core
  -> Command Processor
  -> Command Capability Execution Coordinator
  -> Result

As SPECs recentes consolidaram:

- processamento deterministico de comando no Command Processor (SPEC-013);
- execucao local de capability via binding -> composer -> gateway no Coordinator (SPEC-022).

Apos a SPEC-022, permanece a lacuna arquitetural imediata: ainda nao existe uma camada explicita para adaptar, de forma contratual e deterministica, a saida do Command Processor para a entrada exigida pelo Command Capability Execution Coordinator.

Sem essa camada, o Core tende a realizar mapeamento manual de payload entre modulos em multiplos pontos, elevando acoplamento e risco de divergencia estrutural.

---

## 2. Motivacao

Sem um adaptador dedicado entre processamento e execucao de capability, surgem riscos objetivos:

- transformacao ad-hoc de estruturas no Core;
- divergencia de mapeamento entre output do Command Processor e input do Coordinator;
- menor auditabilidade do fluxo process result -> capability execution;
- duplicacao de validacoes estruturais de integracao.

A evolucao incremental natural apos a SPEC-022 e introduzir uma camada minima de adaptacao contratual, sem absorver responsabilidades de processamento, binding, composicao, preflight ou execucao.

---

## 3. Objetivo

Definir uma camada minima e explicita de Command Processing Result Adapter que:

- receba CommandProcessingResult bem-sucedido;
- extraia e valide os campos necessarios para execucao de capability;
- produza CommandCapabilityExecutionInput compativel com a SPEC-022;
- mantenha comportamento sincrono, deterministico e sem estado;
- propague falhas tipadas em violacoes de contrato.

---

## 4. Escopo

### Escopo desta SPEC

Criar o contrato de adaptacao entre Command Processor e Command Capability Execution Coordinator com:

- API publica minima de adaptacao;
- validacao estrutural do resultado de processamento;
- mapeamento explicito de campos para o input de execucao;
- retorno deterministico e imutavel da estrutura adaptada.

### Escopo do MVP

O MVP deve suportar, no minimo:

- adaptacao bem-sucedida de resultado valido;
- rejeicao tipada de resultado invalido;
- rejeicao tipada de output sem campos necessarios;
- ausencia de mutacao do resultado original.

---

## 5. Fora do escopo

Esta SPEC nao inclui:

- processamento de comando;
- resolucao de commandType para capabilityId;
- composicao de invocation;
- execucao de gateway, resolver ou handler;
- construcao de execution bundle;
- workflow de multiplos passos;
- persistencia em banco ou arquivo;
- cache distribuido;
- filas, retries ou processamento distribuido;
- IA, LLM, embeddings, RAG;
- alteracoes da SPEC-022;
- definicao da SPEC-024.

---

## 6. Responsabilidades

### Command Processing Result Adapter

Responsavel por:

- receber CommandProcessingResult;
- validar estado de sucesso e contrato minimo de output;
- mapear output.type para commandType;
- mapear output.input para input;
- mapear output.context para context;
- mapear generatedAt para generatedAt da entrada de execucao;
- retornar CommandCapabilityExecutionInput imutavel.

Nao responsavel por:

- processar comando;
- decidir ou resolver capabilityId;
- compor invocation;
- executar capability;
- coordenar fluxo sistemico.

### Core

Permanece responsavel por:

- coordenar o fluxo fim a fim;
- acionar o adaptador apos Command Processor;
- acionar o Coordinator com a estrutura adaptada.

### Command Processor

Permanece responsavel por:

- processar comando e retornar CommandProcessingResult.

### Command Capability Execution Coordinator

Permanece responsavel por:

- executar binding -> composer -> gateway com input ja adaptado.

---

## 7. Arquitetura

### Posicao na arquitetura

Core (coordenacao)
  |
  v
Command Processor
  |
  v
Command Processing Result Adapter
  |
  v
Command Capability Execution Coordinator

### Diretriz arquitetural

O adaptador encapsula apenas a transformacao contratual entre dois modulos adjacentes. Nao substitui o Core como coordenador e nao invade responsabilidades de processamento ou execucao.

---

## 8. Fluxos

### Fluxo 1 - Adaptacao bem-sucedida

1. Core recebe CommandProcessingResult com status de sucesso.
2. Adaptador valida o contrato minimo do resultado.
3. Adaptador transforma o resultado em CommandCapabilityExecutionInput.
4. Core envia a estrutura adaptada ao Coordinator.

### Fluxo 2 - Falha de contrato de resultado

1. Resultado de processamento nao atende contrato minimo.
2. Adaptador interrompe o fluxo.
3. Erro tipado e propagado.
4. Coordinator nao e chamado.

---

## 9. API publica

A API publica deve ser minima e explicita.

### 9.1 Operacao central

- adapt(result: CommandProcessingResult): CommandCapabilityExecutionInput

### 9.2 Erros previstos

- InvalidCommandProcessingResultAdapterInputError
- CommandProcessingResultAdapterError

Observacao:
Erros de contrato devem ser propagados sem conversao silenciosa para sucesso.

---

## 10. Regras

### Regras de contrato

- result deve ser objeto valido;
- result.status deve representar sucesso de processamento;
- result.output deve conter type, input e context validos;
- result.generatedAt deve ser string nao vazia;
- o adaptador nao altera o objeto de entrada.

### Regras de determinismo

- para o mesmo result, o output adaptado deve ser identico;
- nao usar estado global oculto, relogio proprio ou aleatoriedade.

### Regras de fronteira

- adaptador nao processa comando;
- adaptador nao executa capability;
- adaptador nao substitui Coordinator;
- Core continua coordenador sistemico.

---

## 11. Criterios de aceitacao

A implementacao desta SPEC sera considerada adequada quando:

- existir modulo explicito de adaptacao de resultado de processamento;
- adapt retornar estrutura compativel com CommandCapabilityExecutionInput da SPEC-022;
- resultados invalidos forem rejeitados com erro tipado;
- input original nao for mutado;
- comportamento for deterministico e sem estado proprio;
- fronteiras entre Command Processor, Adapter e Coordinator permanecerem intactas;
- nao houver ampliacao para workflow, IA, persistencia, filas ou fases futuras.

---

## 12. Estrategia de testes

A implementacao futura deve incluir testes permanentes cobrindo, no minimo:

- adaptacao bem-sucedida para resultado valido;
- rejeicao de result invalido;
- rejeicao de status incompativel com sucesso;
- rejeicao de output sem type valido;
- rejeicao de output sem input valido;
- rejeicao de output sem context valido;
- rejeicao de generatedAt invalido;
- determinismo para entradas identicas;
- ausencia de mutacao do resultado original;
- compatibilidade direta com CommandCapabilityExecutionCoordinator.execute.

---

## 13. Riscos

Principais riscos:

- duplicar papel de coordenacao do Core;
- transformar adaptador em orquestrador de execucao;
- acoplamento excessivo a detalhes internos dos modulos;
- crescimento indevido para workflow.

Mitigacoes:

- manter API unica e estrita de transformacao;
- limitar responsabilidade a mapeamento estrutural;
- depender apenas de contratos publicos;
- propagar falhas tipadas sem fallback oculto.

---

## 14. Criterios de homologacao

A SPEC-023 sera homologada quando:

- a implementacao aderir integralmente a esta especificacao;
- testes permanentes da SPEC-023 passarem sem falhas;
- npm test passar sem falhas;
- npm run build passar sem falhas;
- npm run typecheck passar sem falhas;
- exports publicos estiverem consistentes com arquitetura e fronteiras;
- documentacao final estiver alinhada ao comportamento implementado.

---

## 15. Justificativa objetiva da sequencia arquitetural

A SPEC-023 e a proxima evolucao natural apos a SPEC-022 porque fecha a lacuna imediata de adaptacao contratual entre a saida do Command Processor e a entrada do Command Capability Execution Coordinator.

A SPEC-022 consolidou o encadeamento de execucao local de capability, mas ainda nao formaliza o ponto unico e padronizado de mapeamento estrutural entre processamento e execucao. A SPEC-023 introduz exatamente essa responsabilidade unica, de forma incremental e sem antecipar fases futuras.

## Status

Implementada - aguardando homologacao