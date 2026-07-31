# SPEC-033 - Local Executable Artifact Preparation

## 1. Contexto

A SPEC-032 declarou o comando de pacote `sebastiania` apontando para `dist/application/cli.js`.

O diretorio `dist` e um artefato ignorado pelo Git e so existe depois de `npm run build`. Assim, uma arvore limpa pode conter um manifesto valido, mas nao possuir o arquivo que `npm start` e o campo `bin` precisam executar.

---

## 2. Objetivo

Garantir que o artefato executavel local seja preparado automaticamente nos dois limites que dependem dele:

- preparacao do pacote;
- inicio da aplicacao.

---

## 3. Escopo

Esta SPEC inclui:

- lifecycle `prepare` delegando ao build homologado;
- lifecycle `prestart` delegando ao mesmo build;
- garantia de que `npm start` nao dependa de build manual anterior;
- garantia de que preparacao/instalacao local produza o destino do campo `bin`;
- testes permanentes do contrato de scripts;
- verificacao do artefato compilado e de seu shebang apos build.

---

## 4. Fora do Escopo

Esta SPEC nao inclui:

- alteracoes no compilador ou `outDir`;
- novo pipeline de build;
- publicacao no npm;
- instalacao global automatica;
- bundling, minificacao ou binario nativo;
- mudancas no comando, parser, runtime ou teardown;
- UI, Supabase, banco, rede, IA, LLM, memoria, RAG ou integracoes externas;
- alteracoes de ROADMAP;
- definicao da SPEC-034.

---

## 5. Responsabilidade Arquitetural

O lifecycle do pacote passa a ser responsavel por materializar o artefato compilado antes de limites que o consomem.

### 5.1 prepare

Deve executar `npm run build` durante a preparacao local do pacote.

### 5.2 prestart

Deve executar `npm run build` imediatamente antes de `npm start`.

Ambos reutilizam o build existente e nao duplicam comandos do TypeScript.

---

## 6. Fluxos

### 6.1 Inicio Local

1. Usuario executa `npm start -- greeting [name]`.
2. npm executa `prestart`.
3. `prestart` executa o build existente.
4. TypeScript produz `dist/application/cli.js` com shebang.
5. `start` executa o artefato compilado.

### 6.2 Preparacao do Pacote

1. npm aciona `prepare`.
2. `prepare` executa o build existente.
3. O destino declarado em `bin` passa a existir.

---

## 7. Invariantes

- existe uma unica definicao efetiva de build;
- `prepare` e `prestart` apenas delegam a `npm run build`;
- `start` continua executando o mesmo entrypoint homologado;
- nenhum artefato `dist` e versionado;
- build continua preservando o shebang;
- falha de build impede start ou prepare;
- nenhum fallback executa fonte TypeScript em producao.

---

## 8. Tratamento de Erros

- falha do build deve ser propagada pelo lifecycle npm;
- `start` nao deve executar quando `prestart` falhar;
- `prepare` nao deve ocultar falha de compilacao;
- proibido continuar com artefato anterior quando o build atual falhar.

---

## 9. Criterios de Aceitacao

A implementacao sera adequada quando:

- `package.json` definir `prepare` como `npm run build`;
- `package.json` definir `prestart` como `npm run build`;
- o script `start` permanecer inalterado;
- o build produzir o destino declarado em `bin`;
- o artefato compilado preservar o shebang Node;
- testes, build e typecheck permanecerem validos;
- nenhum comportamento homologado da CLI for modificado.

---

## 10. Estrategia de Testes

Testes permanentes devem cobrir:

- contrato exato do script `prepare`;
- contrato exato do script `prestart`;
- preservacao do script `start`;
- coerencia entre destino `bin` e artefato compilado;
- existencia do artefato apos build;
- shebang do artefato compilado;
- execucao nominal do artefato compilado.

---

## 11. Riscos e Mitigacoes

Riscos:

- duplicar a linha de compilacao em varios scripts;
- executar artefato obsoleto;
- alterar o entrypoint de start;
- versionar `dist` acidentalmente.

Mitigacoes:

- delegar ambos os lifecycles a `npm run build`;
- reconstruir antes de todo start;
- preservar o script start homologado;
- manter `dist/` no `.gitignore`.

---

## 12. Criterios de Homologacao

A SPEC-033 sera homologada quando:

- os lifecycles de preparacao estiverem implementados;
- os testes permanentes da SPEC-033 passarem;
- `npm test` passar;
- `npm run build` passar;
- `npm run typecheck` passar;
- as SPECs anteriores permanecerem aderentes aos seus contratos.

---

## 13. Justificativa da Sequencia

A SPEC-032 definiu qual artefato e executavel. A responsabilidade imediatamente seguinte e garantir que esse artefato exista sempre que o pacote ou o comando de start precisarem dele. Trata-se de lifecycle de pacote concreto, sem nova camada de aplicacao.

---

## Status

Implementada e homologada
