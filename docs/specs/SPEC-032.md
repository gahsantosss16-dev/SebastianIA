# SPEC-032 - Local CLI Executable Contract

## 1. Contexto

A SPEC-030 implementou o adaptador de linha de comando e a SPEC-031 completou seu lifecycle com teardown deterministico.

O contrato documentado usa a sintaxe `sebastiania greeting [name]`, mas o pacote ainda nao declara um executavel chamado `sebastiania`. O entrypoint existe apenas como arquivo chamado pelos scripts `npm start` e `npm run dev`.

---

## 2. Objetivo

Tornar a CLI local um executavel formal do pacote, conectando o comando `sebastiania` ao artefato compilado existente e verificando o comportamento real do processo em sucesso e falha.

---

## 3. Escopo

Esta SPEC inclui:

- declarar `sebastiania` no campo `bin` do manifesto;
- apontar o comando para `dist/application/cli.js`;
- adicionar shebang Node ao entrypoint fonte;
- manter o lockfile coerente com o manifesto;
- testes permanentes do contrato de empacotamento;
- testes de processo real para sucesso e argumentos invalidos.

---

## 4. Fora do Escopo

Esta SPEC nao inclui:

- publicacao no npm;
- instalacao global automatica;
- mudancas no parser, resultado, erros ou exit codes da CLI;
- novos comandos ou capabilities;
- alteracoes no Core, composition root, pipeline ou lifecycle;
- empacotadores, instaladores ou binarios nativos;
- UI, Supabase, banco, rede, IA, LLM, memoria, RAG ou integracoes externas;
- alteracoes de ROADMAP;
- definicao da SPEC-033.

---

## 5. Responsabilidade Arquitetural

O manifesto do pacote passa a ser responsavel por expor o entrypoint operacional homologado como comando local instalavel.

O entrypoint permanece responsavel somente por:

- receber argumentos do processo;
- delegar ao runner da SPEC-030;
- aplicar o exit code retornado.

Nenhuma responsabilidade do adaptador, runtime ou Core e movida para a camada de empacotamento.

---

## 6. Contrato Executavel

Nome:

- `sebastiania`

Destino compilado:

- `./dist/application/cli.js`

Interpretador:

- Node resolvido por `#!/usr/bin/env node`.

Invocacao nominal:

- `sebastiania greeting [name]`.

---

## 7. Fluxo

1. Gerenciador de pacotes resolve `sebastiania` pelo campo `bin`.
2. Sistema operacional usa o shebang para iniciar Node.
3. Entry point recebe os argumentos.
4. Runner homologado executa a invocacao.
5. Processo emite stdout ou stderr e encerra com o codigo homologado.

---

## 8. Invariantes

- existe um unico comando de pacote chamado `sebastiania`;
- o destino aponta para o entrypoint compilado da CLI existente;
- source e artefato compilado preservam o shebang pelo build TypeScript;
- manifesto e lockfile descrevem o mesmo comando;
- nenhuma logica operacional e duplicada no manifesto ou entrypoint;
- sucesso continua usando stdout e exit code `0`;
- falha de argumentos continua usando stderr e exit code `1`.

---

## 9. Tratamento de Erros

- destino ausente ou divergente deve falhar nos testes de contrato;
- ausencia de shebang deve falhar nos testes de contrato;
- falhas operacionais continuam sendo serializadas pelo runner existente;
- a camada executavel nao captura nem substitui erros adicionais.

---

## 10. Criterios de Aceitacao

A implementacao sera adequada quando:

- `package.json` expuser `sebastiania` no campo `bin`;
- `package-lock.json` estiver coerente;
- o entrypoint tiver shebang Node;
- o processo fonte executar `greeting Gabriel` com stdout JSON e exit code `0`;
- o processo fonte rejeitar argumentos ausentes com stderr JSON e exit code `1`;
- build e typecheck permanecerem validos;
- nenhum comportamento das SPECs anteriores for modificado.

---

## 11. Estrategia de Testes

Testes permanentes devem cobrir:

- nome e destino do bin no manifesto;
- coerencia do bin no lockfile;
- shebang do entrypoint;
- processo real nominal com nome;
- JSON nominal compativel com `CapabilityResult`;
- processo real sem argumentos;
- stderr tipado e ausencia de stdout em falha;
- codigos de saida `0` e `1`.

---

## 12. Riscos e Mitigacoes

Riscos:

- destino `bin` divergir do `outDir`;
- shebang ser omitido no artefato;
- teste chamar apenas funcoes e nao validar o processo real;
- introduzir publicacao externa acidental.

Mitigacoes:

- declarar caminho compilado explicito;
- manter shebang no fonte TypeScript;
- testar subprocesso local;
- manter `private: true` e excluir publicacao do escopo.

---

## 13. Criterios de Homologacao

A SPEC-032 sera homologada quando:

- o contrato executavel estiver implementado;
- os testes permanentes da SPEC-032 passarem;
- `npm test` passar;
- `npm run build` passar;
- `npm run typecheck` passar;
- as SPECs anteriores permanecerem aderentes aos seus contratos.

---

## 14. Justificativa da Sequencia

As SPECs 030 e 031 implementaram todo o comportamento da CLI. A proxima responsabilidade operacional e tornar essa CLI enderecavel pelo nome publico que seu proprio contrato ja define. Trata-se de empacotamento local concreto, nao de nova funcionalidade ou abstracao.

---

## Status

Implementada e homologada
