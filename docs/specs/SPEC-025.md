# SPEC-025 - Core Pipeline Integration Contract

## 1. Contexto

A Fase 1 foi encerrada com a arquitetura fundamental homologada ate a SPEC-024.

O pipeline de comando para capability ja existe e esta consolidado:

Core
  -> CommandCapabilityPipelineExecutor
      -> CommandProcessor
      -> CommandProcessingResultAdapter
      -> CommandCapabilityExecutionCoordinator
      -> CapabilityResult

A lacuna imediata da Fase 2 e a integracao real desse pipeline ao Core concreto da aplicacao. Hoje, o Core inicializa e gerencia lifecycle basico, mas ainda nao expõe contrato operacional unico para receber entrada de comando e devolver CapabilityResult final via pipeline consolidado.

---

## 2. Objetivo

Definir o contrato arquitetural minimo para integrar o CommandCapabilityPipelineExecutor ao Core real do Sebastian IA, permitindo que o Core:

- receba CommandProcessingInput;
- acione o pipeline consolidado com CapabilityExecutionBundle valido;
- devolva CapabilityResult;
- propague falhas tipadas de forma previsivel.

---

## 3. Escopo

### Escopo desta SPEC

Esta SPEC define:

- o contrato de integracao entre Core e CommandCapabilityPipelineExecutor;
- a operacao publica do Core para executar um comando via pipeline;
- a forma de disponibilizacao das dependencias necessarias (executor e bundle);
- regras de validacao de entrada e contrato de saida;
- tratamento de erros no limite do Core;
- preservacao das fronteiras atuais entre modulos.

### Escopo do MVP

O MVP deve suportar, no minimo:

- entrada valida de comando recebida pelo Core;
- execucao do pipeline via unica operacao publica do Core;
- retorno de CapabilityResult em caso de sucesso;
- propagacao tipada de erros de Processor, Adapter, Coordinator e Executor;
- comportamento deterministico para mesma entrada e mesmo bundle.

---

## 4. Fora do escopo

Esta SPEC nao inclui:

- criacao de nova camada de orquestracao;
- mudancas internas em CommandProcessor, Adapter, Coordinator ou Executor;
- redesign do lifecycle do Core;
- alteracoes no contrato de CapabilityExecutionBundleBuilder;
- UI, Supabase, IA, LLM, memoria, RAG, rede ou integracoes externas;
- workflow de multiplos passos;
- persistencia em banco ou arquivo;
- filas, retries ou processamento distribuido;
- definicao da SPEC-026.

---

## 5. Responsabilidades do Core

O Core passa a ser responsavel por:

- expor operacao publica unica para execucao de comando via pipeline;
- validar contrato minimo da entrada recebida no limite do Core;
- acionar o CommandCapabilityPipelineExecutor com input e bundle ativos;
- devolver CapabilityResult ao chamador;
- propagar falhas tipadas sem mascaramento;
- manter papel de coordenador sistemico sem reimplementar etapas internas do pipeline.

O Core nao deve:

- duplicar logica interna de process, adapt ou execute;
- reconstruir manualmente o pipeline em cada chamada;
- absorver responsabilidade de binding/composer/gateway.

---

## 6. Responsabilidades do Pipeline Executor

O CommandCapabilityPipelineExecutor permanece responsavel por:

- executar ordem fixa process -> adapt -> execute;
- validar contratos minimos de input e bundle no seu limite;
- propagar falhas tipadas de suas dependencias;
- devolver CapabilityResult em sucesso.

Nao muda de responsabilidade nesta SPEC.

---

## 7. Fluxo de execucao

Fluxo principal:

1. Chamador envia CommandProcessingInput ao Core.
2. Core valida contrato minimo de entrada e disponibilidade de executor/bundle.
3. Core chama executor.execute(input, bundle).
4. Executor processa pipeline completo (process -> adapt -> execute).
5. Core recebe CapabilityResult e retorna ao chamador.

Fluxo de falha:

1. Qualquer etapa tipada falha (Core input, Processor, Adapter, Coordinator, Executor).
2. Erro tipado e propagado no limite do Core.
3. Nao ha conversao silenciosa para sucesso.

---

## 8. Contratos de entrada e saida

### 8.1 Entrada

Entrada publica do Core para esta operacao:

- input: CommandProcessingInput

Campos esperados (ja definidos):

- type: string nao vazia
- input: Readonly<Record<string, unknown>>
- generatedAt: string nao vazia
- conversation/session/configuration/temporary opcionais

Dependencia operacional obrigatoria:

- bundle: CapabilityExecutionBundle valido no contexto do Core

### 8.2 Saida

Saida publica da operacao:

- CapabilityResult

Campos esperados:

- status: 'succeeded'
- output: Readonly<Record<string, unknown>>
- generatedAt: string

---

## 9. Tratamento de erros

Regras:

- erros tipados do Core por entrada/dependencia invalida devem ser lancados explicitamente;
- erros tipados de Processor, Adapter, Coordinator e Executor devem ser propagados;
- erros nao-Error devem ser encapsulados em erro tipado do limite apropriado;
- proibido converter erro em sucesso parcial.

Categorias de falhas cobertas:

- contrato invalido de input no Core;
- indisponibilidade/contrato invalido de executor ou bundle;
- falhas tipadas internas do pipeline;
- falhas inesperadas encapsuladas com cause preservada.

---

## 10. Criterios de aceitacao

A implementacao desta SPEC sera considerada adequada quando:

- o Core expuser operacao publica unica para execucao via pipeline;
- a operacao acionar CommandCapabilityPipelineExecutor sem recompor manualmente etapas internas;
- input valido produzir CapabilityResult compativel com contratos atuais;
- falhas tipadas forem propagadas sem mascaramento;
- comportamento for deterministico para mesma entrada e mesmo bundle;
- fronteiras entre Core e pipeline permanecerem preservadas;
- nenhuma camada extra de orquestracao for introduzida.

---

## 11. Estrategia de testes

A implementacao futura deve incluir testes permanentes cobrindo, no minimo:

- execucao bem-sucedida do comando via API publica do Core;
- rejeicao tipada de input invalido no limite do Core;
- propagacao de erro tipado do Processor;
- propagacao de erro tipado do Adapter;
- propagacao de erro tipado do Coordinator/Executor;
- garantia de que o Core chama o Executor (sem recompor pipeline manualmente);
- determinismo para entradas identicas com mesmo bundle;
- ausencia de mutacao do input recebido pelo Core.

---

## 12. Riscos

Principais riscos:

- Core duplicar logica interna do pipeline;
- acoplamento excessivo do Core a detalhes internos de modulos do pipeline;
- introducao de camada desnecessaria de repasse;
- tratamento inconsistente de erros no limite do Core.

Mitigacoes:

- manter integracao por contrato unico Core -> Executor;
- limitar Core a validacao minima e delegacao;
- preservar APIs publicas existentes dos modulos;
- padronizar propagacao tipada de falhas.

---

## 13. Criterios de homologacao

A SPEC-025 sera homologada quando:

- a implementacao aderir integralmente a esta especificacao;
- testes permanentes da SPEC-025 passarem sem falhas;
- npm test passar sem falhas;
- npm run build passar sem falhas;
- npm run typecheck passar sem falhas;
- contratos publicos de Core e capability permanecerem consistentes;
- documentacao final estiver alinhada ao comportamento implementado.

---

## 14. Justificativa da sequencia arquitetural

A SPEC-025 e a proxima evolucao natural da Fase 2 porque conecta o pipeline consolidado (encerrado na Fase 1) ao Core real de execucao da aplicacao.

As SPECs anteriores ja definiram e homologaram os modulos internos do pipeline e sua execucao unificada. A lacuna imediata restante e estabelecer o contrato real no Core para consumir esse pipeline de ponta a ponta, sem novas camadas artificiais e sem ampliar escopo para integracoes externas.

## Status

Implementada - aguardando homologacao