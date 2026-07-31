# SPEC-031 - Local Invocation Runtime Teardown

## 1. Contexto

A SPEC-030 criou a invocacao operacional local que valida argumentos, constroi o runtime pela SPEC-029, executa um comando e traduz o resultado para o processo.

Cada invocacao cria uma instancia completa de `SebastianCore`, mas o adaptador nao encerra explicitamente essa instancia. O processo depende do termino implicito do Node, deixando incompleto o lifecycle `initialize -> start -> shutdown` ja disponibilizado pelo Core.

---

## 2. Objetivo

Garantir encerramento deterministico do runtime criado pela invocacao local, chamando `shutdown()` exatamente uma vez apos toda tentativa de execucao iniciada, tanto em sucesso quanto em falha.

---

## 3. Escopo

Esta SPEC inclui:

- exigir de cada runtime local os contratos `executeCommand` e `shutdown`;
- executar shutdown apos comando bem-sucedido;
- executar shutdown apos falha do comando;
- preservar a falha original quando shutdown for bem-sucedido;
- falha tipada quando apenas shutdown falhar;
- falha tipada combinada quando execucao e shutdown falharem;
- preservar separadamente as causas de execucao e shutdown;
- manter inalterado o contrato stdout, stderr e exit code da SPEC-030.

---

## 4. Fora do Escopo

Esta SPEC nao inclui:

- alteracoes em `SebastianCore.shutdown()`;
- redesign do lifecycle;
- sinais de processo, cancelamento ou interrupcao concorrente;
- multiplos comandos no mesmo runtime;
- retries de shutdown;
- persistencia ou telemetria;
- UI, Supabase, banco, rede, IA, LLM, memoria, RAG ou integracoes externas;
- alteracoes de ROADMAP;
- definicao da SPEC-032.

---

## 5. Responsabilidade Arquitetural

O adaptador de invocacao local e proprietario do runtime que cria. Por isso, passa a ser responsavel por encerrar essa mesma instancia antes de devolver resultado ou propagar falha.

Nao assume:

- implementacao interna do shutdown;
- recuperacao do runtime;
- composicao ou lifecycle fora da invocacao local;
- encerramento de instancias criadas por outros chamadores.

---

## 6. Fluxos

### 6.1 Sucesso

1. Argumentos sao validados.
2. Runtime e criado.
3. Comando e executado com sucesso.
4. `shutdown()` e chamado exatamente uma vez.
5. Resultado original e devolvido ao runner.
6. Runner escreve stdout e retorna `0`.

### 6.2 Falha de Execucao

1. Runtime e criado.
2. Execucao falha.
3. `shutdown()` e chamado exatamente uma vez.
4. Se shutdown concluir, a falha original e propagada sem substituicao.

### 6.3 Falha de Shutdown

- se a execucao tiver concluido, deve ser lancada falha tipada de shutdown com causa preservada;
- se a execucao tambem tiver falhado, deve ser lancada falha tipada combinada, preservando separadamente a causa primaria de execucao e a causa de shutdown.

---

## 7. Contratos de Erro

### 7.1 LocalCommandRuntimeShutdownError

Representa falha de shutdown apos execucao bem-sucedida e preserva a causa original do shutdown.

### 7.2 LocalCommandExecutionAndShutdownError

Representa falha dupla e expoe:

- `cause`: falha original da execucao;
- `shutdownCause`: falha original do shutdown.

Valores lancados que nao sejam `Error` tambem devem ser preservados nesses campos.

---

## 8. Invariantes

- argumentos invalidos nao criam nem encerram runtime;
- runtime criado e encerrado no maximo uma vez;
- shutdown nunca ocorre antes da tentativa de execucao;
- resultado so e devolvido depois de shutdown bem-sucedido;
- falha de execucao nao impede tentativa de shutdown;
- falha de shutdown nunca e ocultada;
- falha primaria de execucao nunca e descartada;
- o mesmo runtime criado e o mesmo runtime encerrado;
- nenhuma etapa interna do Core ou pipeline e duplicada.

---

## 9. Criterios de Aceitacao

A implementacao sera adequada quando:

- sucesso executar e encerrar na ordem correta;
- falha de execucao ainda encerrar o runtime;
- shutdown ocorrer exatamente uma vez;
- falha de execucao for preservada quando shutdown concluir;
- falha isolada de shutdown for tipada;
- falha dupla preservar ambas as causas;
- runner continuar emitindo stdout apenas em sucesso integral;
- runner emitir stderr e exit code `1` em falha de shutdown;
- o runtime real terminar com estado `shutDown`.

---

## 10. Estrategia de Testes

Testes permanentes devem cobrir:

- ordem `executeCommand -> shutdown`;
- shutdown unico apos sucesso;
- shutdown unico apos falha de execucao;
- preservacao da falha de execucao;
- falha tipada de shutdown apos sucesso;
- falha combinada com ambas as causas;
- causas nao-`Error` preservadas;
- nenhum shutdown para argumentos invalidos;
- runner sem stdout quando shutdown falhar;
- runtime real marcado como encerrado apos invocacao;
- determinismo para o mesmo conjunto de dependencias.

---

## 11. Riscos e Mitigacoes

Riscos:

- `finally` substituir silenciosamente a falha de execucao;
- shutdown duplicado;
- devolver resultado antes do encerramento;
- modificar lifecycle interno do Core.

Mitigacoes:

- tratar separadamente os dois caminhos de erro;
- centralizar uma unica chamada de shutdown por caminho;
- devolver somente apos shutdown concluido;
- usar exclusivamente o metodo publico existente.

---

## 12. Criterios de Homologacao

A SPEC-031 sera homologada quando:

- o teardown deterministico estiver implementado no adaptador local;
- os testes permanentes da SPEC-031 passarem;
- `npm test` passar;
- `npm run build` passar;
- `npm run typecheck` passar;
- as SPECs anteriores permanecerem aderentes aos seus contratos.

---

## 13. Justificativa da Sequencia

A SPEC-030 abriu o ciclo operacional da invocacao local. A responsabilidade imediatamente seguinte e fechar esse mesmo ciclo de forma explicita. O teardown pertence ao adaptador que cria a instancia e nao exige nova camada, recurso externo ou mudanca no Core.

---

## Status

Implementada e homologada
