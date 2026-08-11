# SPEC-038 - Persistent Local Memory Capability (Remember/Recall Vertical Slice)

## 1. Contexto

As SPECs 001 a 033 consolidaram a arquitetura fundamental do Core (comando, capability, execucao).

As SPECs 034 a 037 formalizaram os contratos de write-back de resultado (Memory), hidratacao de contexto (Memory), handoff Core -> Agente Especializado e invocacao Agente -> Ferramenta. Todos esses contratos foram implementados e homologados, mas com adapters concretos exclusivamente em memoria de processo (`InMemoryCommandContextHydrator`, `InMemoryCommandResultMemoryWriter`), sem nenhuma capability real que os tornasse uteis. A unica capability existente ate aqui era `greeting`, um eco trivial que nao exercita memoria nenhuma.

Isso deixa o Sebastian IA sem a capacidade minima descrita na VISION: "lembrar informacoes importantes". Uma execucao do executavel local nao sobrevive a proxima execucao - toda memoria e perdida ao encerrar o processo.

Esta SPEC nao formaliza mais uma fronteira arquitetural isolada. Ela entrega a primeira fatia vertical completa e utilizavel do produto, encadeando exatamente os contratos ja homologados (034-037) com adapters concretos persistentes, sem alterar nenhuma das interfaces publicas dessas SPECs.

---

## 2. Objetivo

Permitir que o usuario grave uma informacao via CLI (`sebastiania remember "..."`), encerre o processo, inicie uma nova execucao do Sebastian, e recupere essa informacao (`sebastiania recall`), com persistencia real em disco, fora do repositorio, isolada por diretorio configuravel.

---

## 3. Escopo

Esta SPEC agrupa, como uma unica entrega funcional coerente, tudo o que e necessario para o vertical slice descrito acima:

- adapter concreto de persistencia local em arquivo (`FileMemoryStore`), sem dependencia externa de runtime;
- resolucao do diretorio de dados do Sebastian IA seguindo convencao do sistema operacional, fora do repositorio, com caminho injetavel/configuravel via variavel de ambiente (`SEBASTIAN_DATA_DIR`) para isolamento completo em testes;
- adapter concreto do contrato de write-back (SPEC-034) que persiste em disco (`FileCommandResultMemoryWriter`);
- adapter concreto do contrato de hidratacao de contexto (SPEC-035) que le do mesmo armazenamento em disco e reconstroi os fatos memorizados (`FileCommandContextHydrator`);
- capability `remember`, que grava um fato como registro individual estruturado (identidade, conteudo, metadados temporais), reaproveitando o write-back automatico do Core;
- capability `recall`, que le os fatos previamente memorizados via hidratacao automatica do Core e responde de forma clara quando a memoria ainda esta vazia;
- extensao minima do roteamento de comando (`CommandProcessor`, `LocalCommandInvocationAdapter`) para suportar multiplos comandos de CLI (`greeting`, `remember`, `recall`) em vez de um unico comando fixo;
- composicao dessas implementacoes no runtime (`CorePipelineBootstrap`, `SebastianApplication`), com persistencia real ativada por padrao apenas no ponto de entrada do CLI;
- testes unitarios, de integracao e testes reais por subprocessos separados comprovando persistencia entre execucoes distintas do executavel.

---

## 4. Fora do Escopo

Esta SPEC nao inclui:

- LLM, Claude API, OpenAI API ou qualquer modelo de linguagem;
- RAG, embeddings, banco vetorial ou memoria semantica;
- Supabase ou qualquer sincronizacao em nuvem;
- UI ou interface web;
- ferramentas externas reais ou execucao de comandos do sistema;
- evolucao do Agente Especializado ou da Ferramenta alem do necessario (ambos seguem como pass-through, conforme homologado nas SPEC-036/037);
- classificacao inteligente ou qualquer forma de curadoria automatica de memoria;
- controle de concorrencia entre processos simultaneos escrevendo no mesmo arquivo;
- abstracoes preventivas para funcionalidades futuras.

---

## 5. Responsabilidade Funcional Unica

Transformar os contratos de memoria ja homologados (write-back e hidratacao) em uma capacidade real e persistente de "lembrar e recordar" fatos individuais, acessivel via CLI, sobrevivendo a encerramento e reinicio do processo.

---

## 6. Modelo de Dados

Cada memoria e um registro individual estruturado, sem semantica ou classificacao:

- `id`: identidade propria do registro (o `executionId` gerado pelo Core no momento da gravacao);
- `content`: conteudo textual do fato memorizado;
- `recordedAt`: metadado temporal de quando o fato foi registrado.

Nao ha memoria unica de conversa, nem embeddings, nem classificacao. O registro reaproveita a propria estrutura ja definida pelo contrato de write-back (SPEC-034): `executionId`, `commandType`, `commandGeneratedAt`, `resultGeneratedAt`, `resultStatus`, `output`, `metadata`.

---

## 7. Fluxo Ponta a Ponta

```
sebastiania remember "texto"
  -> CLI roteia para o comando "remember"
  -> Core hidrata contexto (memoria de fatos anteriores, se houver)
  -> capability "remember" retorna { fact: "texto" }
  -> Core despacha handoff Core -> Agente -> Ferramenta (pass-through, SPEC-036/037)
  -> Core grava write-back no arquivo local (SPEC-034, FileCommandResultMemoryWriter)
  -> processo termina

sebastiania recall
  -> CLI roteia para o comando "recall"
  -> Core hidrata contexto lendo o arquivo local (SPEC-035, FileCommandContextHydrator)
  -> capability "recall" le os fatos hidratados e responde com a lista ou com
     mensagem clara de memoria vazia
  -> Core despacha handoff Core -> Agente -> Ferramenta (pass-through)
  -> Core grava write-back do proprio recall (nao interfere nos fatos lidos)
```

---

## 8. Persistencia

- Formato: arquivo JSON unico (`memory.json`) fora do repositorio, no diretorio de dados do usuario.
- Localizacao padrao por sistema operacional: `%APPDATA%\SebastianIA` (Windows), `~/Library/Application Support/SebastianIA` (macOS), `$XDG_DATA_HOME/sebastiania` ou `~/.local/share/sebastiania` (Linux).
- Escrita atomica via arquivo temporario + rename, evitando corrupcao em caso de interrupcao.
- Caminho sobrescrevivel via variavel de ambiente `SEBASTIAN_DATA_DIR`, usada para isolar testes e evitar contaminar a memoria real do usuario.
- `SebastianApplication`/`CorePipelineBootstrap` mantem o comportamento padrao em memoria (nao persistente) quando nenhum diretorio de dados e informado explicitamente, preservando o comportamento homologado de todo o restante do sistema (embeddors, testes, entrypoint `core/index.ts`). Apenas o composition root do CLI local resolve e injeta o diretorio real por padrao.

---

## 9. Invariantes

- os contratos `CommandContextHydrator` e `CommandResultMemoryWriter` (SPEC-034/035) permanecem inalterados;
- os contratos de handoff e invocacao (SPEC-036/037) permanecem inalterados e sem logica adicional;
- nenhuma memoria e persistida dentro do repositorio;
- a persistencia e determinista para a mesma sequencia de operacoes;
- a leitura de uma memoria vazia nunca lanca excecao - retorna estado explicito e claro;
- os adapters em memoria (`InMemoryCommandContextHydrator`, `InMemoryCommandResultMemoryWriter`) continuam sendo o padrao para qualquer composicao que nao informe explicitamente um diretorio de dados.

---

## 10. Criterios de Aceitacao

- `sebastiania remember "texto"` grava um fato e encerra com sucesso;
- uma nova execucao separada do processo (`sebastiania recall`) recupera o fato gravado anteriormente;
- `sebastiania recall` sobre uma memoria vazia retorna mensagem clara, sem erro;
- nenhuma escrita ocorre na memoria real do usuario durante a suite de testes (isolamento via `SEBASTIAN_DATA_DIR`);
- todos os testes, build e typecheck permanecem verdes;
- nenhum contrato homologado das SPEC-001 a SPEC-037 e alterado em sua interface publica.

---

## 11. Estrategia de Testes

- unitarios: `FileMemoryStore` (leitura/escrita/namespace/erros tipados), `FileCommandResultMemoryWriter`, `FileCommandContextHydrator`, resolucao de diretorio de dados;
- integracao: composicao do `CorePipelineBootstrap` com `memoryFilePath`, capability `remember`/`recall` via `SebastianApplication` com `dataDir` isolado em diretorio temporario;
- ponta a ponta por subprocessos reais: dois `spawnSync` distintos e independentes (processo 1 grava, processo 2 recupera) apontando para o mesmo diretorio temporario isolado, comprovando persistencia real entre execucoes do executavel.

---

## 12. Justificativa Arquitetural

Esta SPEC nao introduz uma nova fronteira arquitetural. Ela substitui, de forma aditiva e opcional, os adapters concretos por tras dos contratos ja homologados nas SPEC-034 e SPEC-035, e adiciona a primeira capability real que os exercita. O roteamento de CLI e o `CommandProcessor` sao estendidos minimamente (de um comando fixo para uma lista curta de comandos suportados) porque essa extensao e um pre-requisito objetivo para que `remember`/`recall` alcancem a pipeline de capability - sem essa extensao as capabilities autorizadas nesta entrega seriam inalcancaveis. Nenhuma abstracao especulativa foi criada: o modelo de registro reaproveita a propria estrutura do contrato de write-back existente, em vez de introduzir um esquema de memoria paralelo.

## Status

Implementada e homologada
