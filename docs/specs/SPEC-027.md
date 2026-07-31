# SPEC-027 - Core Operational Runtime Bootstrap

## 1. Contexto

A SPEC-025 integrou o pipeline de comandos ao `SebastianCore` por meio de `executeCommand(input)`.

A SPEC-026 definiu o contrato unico de composicao das dependencias desse pipeline, produzindo `CorePipelineDependencies` validas antes da execucao de comandos.

Permanece uma lacuna na fronteira de inicializacao da aplicacao: a composicao das dependencias e a criacao do Core existem como contratos separados, mas ainda nao ha um contrato operacional unico que garanta que o runtime real seja criado, inicializado e iniciado somente com dependencias previamente compostas.

Sem essa fronteira, um entrypoint pode instanciar e iniciar um Core sem pipeline operacional, apesar de a composicao correta ja estar disponivel.

---

## 2. Objetivo

Definir o contrato arquitetural minimo de bootstrap do runtime operacional do Core, coordenando, uma unica vez por inicializacao:

1. composicao das dependencias do pipeline pelo contrato da SPEC-026;
2. criacao do `SebastianCore` com essas dependencias;
3. inicializacao e inicio do Core em ordem deterministica;
4. entrega de uma instancia pronta para executar comandos.

---

## 3. Escopo

### Escopo desta SPEC

Esta SPEC define:

- uma fronteira unica de bootstrap do runtime do Core;
- a responsabilidade de conectar o composer da SPEC-026 ao factory/construtor homologado do `SebastianCore`;
- a ordem `compose -> create -> initialize -> start`;
- o contrato de entrada e saida do bootstrap operacional;
- falha tipada e atomica quando composicao, criacao ou ativacao falhar;
- garantia de que nenhuma instancia parcialmente ativada seja entregue ao chamador.

### Escopo do MVP

O MVP deve suportar, no minimo:

- receber a configuracao local necessaria ao Core e a entrada de composicao da SPEC-026;
- compor `CorePipelineDependencies` exatamente uma vez;
- injetar as dependencias compostas ao criar o `SebastianCore`;
- executar `initialize()` e `start()` exatamente uma vez e na ordem definida;
- retornar uma instancia pronta para `executeCommand(input)`;
- rejeitar o bootstrap de forma tipada quando qualquer etapa falhar.

---

## 4. Fora do escopo

Esta SPEC nao inclui:

- alteracoes no fluxo interno `process -> adapt -> execute`;
- mudancas em providers, registry, bindings, bundle, coordinator ou executor;
- recomposicao de dependencias dentro de `executeCommand`;
- redesign do lifecycle geral do Core ou do `LifecycleManager`;
- shutdown, restart, hot reload, retries ou recuperacao automatica;
- singleton global obrigatorio ou container de aplicacao;
- UI, Supabase, banco, rede, IA, LLM, memoria, RAG ou integracoes externas;
- descoberta dinamica de providers;
- alteracoes de ROADMAP;
- definicao ou implementacao da SPEC-028.

---

## 5. Responsabilidades Arquiteturais

### 5.1 Bootstrap do Runtime

Passa a ser responsavel por:

- receber toda a entrada obrigatoria antes de iniciar o Core;
- delegar a composicao do pipeline ao contrato unico da SPEC-026;
- criar o Core com as dependencias completas;
- ativar o Core na ordem homologada;
- retornar somente uma instancia operacional pronta;
- preservar e classificar falhas ocorridas na fronteira de bootstrap.

Nao assume:

- regras internas de composicao do pipeline;
- processamento ou execucao de comandos;
- responsabilidades internas de lifecycle;
- resolucao de integracoes externas.

### 5.2 Composer do Pipeline

Permanece responsavel exclusivamente por:

- montar e validar registry, bundle, bindings, coordinator e executor;
- retornar `CorePipelineDependencies` completas;
- falhar antes da criacao do Core quando a composicao for invalida.

### 5.3 SebastianCore

Permanece responsavel por:

- seu estado e operacoes de lifecycle ja existentes;
- expor `executeCommand(input)`;
- delegar comandos ao executor com o bundle injetado.

O Core nao passa a compor suas proprias dependencias.

---

## 6. Fluxo Arquitetural

Fluxo nominal:

1. Chamador fornece configuracao do Core, providers e bindings.
2. Bootstrap do runtime valida a entrada minima.
3. Bootstrap delega a composicao ao contrato da SPEC-026.
4. Composer devolve `CorePipelineDependencies` validas.
5. Bootstrap cria o `SebastianCore` com essas dependencias.
6. Bootstrap chama `initialize()`.
7. Bootstrap chama `start()`.
8. Bootstrap devolve o Core pronto para `executeCommand(input)`.

Fluxo de falha:

1. Uma etapa de validacao, composicao, criacao, inicializacao ou inicio falha.
2. O bootstrap interrompe as etapas seguintes.
3. Uma falha tipada de bootstrap e lancada com a causa original preservada.
4. Nenhuma instancia parcial e retornada ao chamador.

---

## 7. Contratos

### 7.1 Entrada do Bootstrap

Entrada minima esperada:

- entrada completa de composicao homologada pela SPEC-026;
- nome e configuracao local opcionais ja aceitos pelo Core;
- logger opcional compativel com o contrato existente;
- factories substituiveis somente quando necessarias para teste de fronteira, sem alterar o fluxo nominal.

Providers e bindings obrigatorios nao podem ser omitidos nem substituidos por valores padrao silenciosos.

### 7.2 Saida do Bootstrap

Saida obrigatoria:

- uma instancia de `SebastianCore` que:
  - recebeu `CorePipelineDependencies` completas na criacao;
  - concluiu `initialize()`;
  - concluiu `start()`;
  - esta pronta para executar comandos pelo contrato da SPEC-025.

### 7.3 Invariantes

- cada chamada de bootstrap compoe dependencias uma unica vez;
- a ordem operacional e sempre `compose -> create -> initialize -> start`;
- `start()` nunca ocorre se `initialize()` falhar;
- o Core nunca e criado se a composicao falhar;
- nenhuma dependencia parcial e injetada;
- nenhuma instancia parcial e retornada;
- a mesma entrada e as mesmas factories produzem comportamento funcional equivalente;
- o bootstrap nao executa comandos durante a inicializacao.

---

## 8. Tratamento de Erros

Falhas da fronteira operacional devem ser tipadas por etapa:

- entrada de bootstrap invalida;
- falha de composicao das dependencias;
- falha de criacao do Core;
- falha de inicializacao do Core;
- falha de inicio do Core.

Regras:

- erros tipados da SPEC-026 devem ser preservados como causa da falha de composicao;
- falhas de factory ou lifecycle devem preservar a causa original;
- valores lancados que nao sejam `Error` devem ser encapsulados;
- nenhuma falha pode ser convertida em sucesso parcial;
- proibido criar um Core sem pipeline como fallback;
- proibido continuar para a etapa seguinte depois de uma falha.

---

## 9. Criterios de Aceitacao

A implementacao desta SPEC sera considerada adequada quando:

- existir um contrato unico e explicito para criar o runtime operacional do Core;
- o contrato reutilizar o composer da SPEC-026 sem duplicar sua logica;
- o Core for criado com dependencias completas antes de `initialize()` e `start()`;
- a ordem das etapas for deterministica e verificavel;
- somente uma instancia totalmente ativada for retornada;
- falhas em qualquer etapa forem tipadas e preservarem suas causas;
- `executeCommand(input)` funcionar na instancia retornada;
- nenhuma responsabilidade homologada nas SPECs anteriores for alterada.

---

## 10. Estrategia de Testes

A implementacao futura deve incluir testes permanentes cobrindo, no minimo:

- bootstrap nominal retorna `SebastianCore` inicializado e iniciado;
- dependencias da SPEC-026 sao compostas exatamente uma vez;
- dependencias compostas sao injetadas na mesma instancia retornada;
- ordem `compose -> create -> initialize -> start`;
- falha de composicao impede a criacao do Core;
- falha de inicializacao impede `start()` e impede retorno parcial;
- falha de inicio impede retorno parcial;
- causas originais sao preservadas em cada categoria de falha;
- comportamento deterministico para a mesma entrada;
- execucao real por `executeCommand(input)` na instancia retornada.

---

## 11. Riscos

Principais riscos:

- duplicar no bootstrap a logica interna do composer;
- manter entrypoints que iniciem o Core sem dependencias;
- esconder falhas de ativacao com fallback parcial;
- misturar bootstrap operacional com integracoes externas;
- transformar a unidade em um novo gerenciador de lifecycle.

Mitigacoes:

- delegar integralmente a composicao a SPEC-026;
- limitar o bootstrap a coordenar criacao e ativacao;
- falhar cedo e de forma tipada;
- retornar somente uma instancia completamente pronta;
- preservar os contratos existentes do Core e do pipeline.

---

## 12. Criterios de Homologacao

A SPEC-027 sera homologada quando:

- o contrato de bootstrap operacional estiver implementado sem alterar responsabilidades anteriores;
- o runtime real do Core for criado com dependencias compostas;
- os testes permanentes da SPEC-027 passarem sem falhas;
- `npm test` passar sem falhas;
- `npm run build` passar sem falhas;
- `npm run typecheck` passar sem falhas;
- as SPECs 025 e 026 permanecerem aderentes aos seus contratos.

---

## 13. Justificativa da Sequencia Arquitetural

A SPEC-027 e a proxima evolucao natural porque fecha a lacuna entre duas capacidades ja homologadas:

- o Core sabe executar comandos com dependencias injetadas;
- o composer sabe produzir essas dependencias de forma valida.

A responsabilidade ainda ausente e tornar essa composicao parte obrigatoria da criacao do runtime operacional, antes de qualquer ativacao. Trata-se de uma fronteira nova de inicializacao da aplicacao, e nao de uma extensao do pipeline ou de um redesign de lifecycle.

---

## Status

Implementada - aguardando homologacao
