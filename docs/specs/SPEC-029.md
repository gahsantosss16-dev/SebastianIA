# SPEC-029 - Local Application Composition Root

## 1. Contexto

A sequencia arquitetural ate a SPEC-028 consolidou processamento, capabilities, composicao do pipeline, bootstrap operacional e admissao de comandos por prontidao.

O entrypoint padrao ainda cria o `SebastianCore` sem providers ou bindings concretos. Assim, a arquitetura pode ser exercitada em testes, mas a aplicacao iniciada pelo projeto nao possui uma composicao operacional real capaz de executar um comando suportado.

A nova fase do Sebastian IA comeca conectando os contratos homologados a uma configuracao local concreta, sem introduzir integracoes externas.

---

## 2. Objetivo

Definir e implementar o composition root local da aplicacao, responsavel por:

- declarar o primeiro provider concreto;
- declarar o binding concreto correspondente;
- fornecer a capability local de saudacao para o command type `greeting` ja homologado;
- iniciar o runtime pelo bootstrap operacional da SPEC-027;
- disponibilizar no entrypoint um Core pronto para executar comandos reais.

---

## 3. Escopo

Esta SPEC inclui:

- provider local deterministico para `cap.greeting`;
- handler local de saudacao sem efeitos externos;
- binding `greeting -> cap.greeting`;
- factory publica de aplicacao que aceita nome, configuracao e logger ja suportados pelo Core;
- substituicao da inicializacao ad-hoc do entrypoint pelo composition root local;
- testes do fluxo real `entrypoint -> bootstrap -> Core -> pipeline -> capability`.

---

## 4. Fora do Escopo

Esta SPEC nao inclui:

- novos command types no `CommandProcessor`;
- alteracoes no pipeline ou em seus contratos;
- mudancas de lifecycle ou prontidao operacional;
- descoberta dinamica de providers;
- plugins de terceiros;
- UI, Supabase, banco, rede, IA, LLM, memoria, RAG ou integracoes externas;
- persistencia, filas, retries ou concorrencia;
- alteracoes de ROADMAP;
- definicao da SPEC-030.

---

## 5. Responsabilidade Arquitetural

### 5.1 Composition Root da Aplicacao

Passa a ser responsavel por escolher e conectar implementacoes concretas aos contratos existentes:

- providers ativos;
- bindings ativos;
- configuracao local do runtime;
- chamada unica ao bootstrap operacional.

Nao reimplementa:

- registry;
- bundle;
- coordinator;
- executor;
- lifecycle;
- validacao de prontidao.

### 5.2 Provider Local

E responsavel somente por expor a registration da capability `cap.greeting`, composta por descriptor e handler compativeis com os contratos homologados.

### 5.3 Entrypoint

Permanece responsavel por disponibilizar a instancia padrao da aplicacao, mas passa a obte-la exclusivamente pelo composition root local.

---

## 6. Fluxo Operacional

1. Entrypoint chama a factory da aplicacao.
2. Composition root fornece o provider local e o binding `greeting -> cap.greeting`.
3. Bootstrap da SPEC-027 compoe as dependencias pela SPEC-026.
4. Bootstrap cria, inicializa e inicia o `SebastianCore`.
5. Entrypoint exporta a instancia pronta.
6. `executeCommand` admite o comando conforme a SPEC-028.
7. Pipeline resolve e executa o handler local de saudacao.

---

## 7. Contratos

### 7.1 Factory da Aplicacao

Entrada opcional:

- `name`, compativel com o Core;
- `config`, compativel com o Core;
- `logger`, compativel com o Core.

Saida:

- uma instancia de `SebastianCore` completamente ativada pelo bootstrap operacional.

### 7.2 Capability Local de Saudacao

Descriptor:

- id: `cap.greeting`;
- handlerId: `handler.greeting.local`;
- nome e versao locais estaveis.

Entrada:

- payload de comando `greeting`;
- campo opcional `name` do tipo string.

Saida:

- objeto com `message`;
- `Hello, <name>!` quando `name` for string nao vazia;
- `Hello!` quando o nome nao for fornecido ou for invalido.

---

## 8. Invariantes

- o composition root chama somente o bootstrap homologado;
- provider e binding concretos sao definidos uma unica vez;
- nenhuma dependencia parcial e fornecida ao Core;
- o handler nao altera invocation ou input;
- a mesma entrada produz a mesma saudacao;
- a instancia padrao esta inicializada, iniciada e pronta;
- nenhum fallback cria Core sem pipeline.

---

## 9. Tratamento de Erros

- falhas de provider, binding, composicao, criacao ou ativacao permanecem tipadas pelos limites homologados;
- o composition root nao captura nem converte falhas em sucesso;
- proibido substituir provider ou binding invalido por configuracao vazia;
- proibido iniciar Core ad-hoc quando o bootstrap falhar.

---

## 10. Criterios de Aceitacao

A implementacao sera adequada quando:

- existir um composition root local explicito;
- o entrypoint padrao utilizar esse composition root;
- o runtime padrao estiver integralmente pronto;
- um comando `greeting` percorrer o pipeline real e executar `cap.greeting`;
- o resultado for deterministico;
- a arquitetura das SPECs 025 a 028 for reutilizada sem duplicacao;
- nenhum contrato anterior tiver seu comportamento modificado.

---

## 11. Estrategia de Testes

Testes permanentes devem cobrir:

- provider local expõe registration valida;
- composition root retorna Core inicializado e iniciado;
- configuracao aceita pelo Core e preservada;
- comando `greeting` executa pelo runtime local;
- saudacao com nome;
- saudacao generica sem nome valido;
- determinismo para entradas identicas;
- ausencia de mutacao do input;
- instancia exportada pelo entrypoint esta pronta e executa o comando real.

---

## 12. Riscos e Mitigacoes

Riscos:

- duplicar o bootstrap no composition root;
- adicionar regra de negocio ao pipeline;
- iniciar Core sem dependencias em caso de falha;
- introduzir integracao externa prematuramente.

Mitigacoes:

- delegar integralmente ao bootstrap da SPEC-027;
- manter a saudacao isolada no handler concreto;
- propagar falhas sem fallback;
- limitar a primeira composicao a recursos locais.

---

## 13. Criterios de Homologacao

A SPEC-029 sera homologada quando:

- o composition root local estiver implementado;
- o entrypoint padrao usar o runtime operacional composto;
- os testes permanentes da SPEC-029 passarem;
- `npm test` passar;
- `npm run build` passar;
- `npm run typecheck` passar;
- as SPECs anteriores permanecerem aderentes aos seus contratos.

---

## 14. Justificativa da Nova Fase

A fase anterior encerrou a construcao e protecao do caminho arquitetural de comandos. A primeira responsabilidade pratica nao e criar outra abstracao, mas escolher uma configuracao concreta e executavel para a aplicacao.

O composition root local inaugura essa fase ao transformar contratos abstratos em um runtime padrao funcional, ainda inteiramente local e verificavel.

---

## Status

Implementada e homologada
