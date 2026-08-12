# SPEC-043 - Executor de Desenvolvimento Controlado

## 1. Contexto

As SPEC-040/041/042 deram ao Sebastian leitura de filesystem, tarefas persistentes e escrita controlada (criar/acrescentar), sempre confinadas à `allowedFilesystemRoot` já homologada e reaproveitando integralmente `Core → Memory hydration → Capability → Agent → ModelProvider → Tool`. O Sebastian entende, age e organiza dentro de um workspace - mas ainda não conseguia editar código de forma cirúrgica, inspecionar o estado do Git, nem executar validações do próprio projeto.

Este bloco dá o primeiro passo em direção a um assistente que trabalha de verdade nos projetos do usuário: entender o repositório, modificar código de forma controlada, inspecionar Git e executar validações autorizadas - sem shell arbitrário, sem Git mutável, sem provider de IA real.

## 2. Objetivo

Permitir que, dentro do workspace autorizado, o usuário peça em linguagem natural para: consultar o estado e o diff reais do repositório Git; substituir um trecho exato de texto em um arquivo permitido; e executar uma validação previamente autorizada pela composição da aplicação (ex.: os próprios `npm test`/`npm run build`/`npm run typecheck` do Sebastian IA) - tudo com resultado real, limites de segurança e zero custo de API.

## 3. Escopo

Entregue como vertical slice único:

- `fs.replaceText`: substituição de texto exato, uma única ocorrência, escrita atômica (temp file + rename), com proteção contra edição de arquivo já modificado no Git;
- `git.status`/`git.diff`: inspeção Git somente-leitura, confinada à allowed root, sem qualquer subcomando mutável;
- `LocalAuthorizedCommandTool`: execução de comandos pré-autorizados pela composição (nunca pelo texto do usuário), sem shell, com timeout e limite de saída capturada;
- três reconhecimentos determinísticos mínimos adicionais no `DevelopmentModelProvider`;
- testes unitários, de integração e por subprocessos reais, em repositórios/workspaces Git temporários e isolados.

## 4. Fora do Escopo

`git add`/`commit`/`push`/`pull`/`checkout`/`reset`/`restore`/`clean`/`merge`/`rebase`/`stash`, criação de branch, alteração de config Git, shell arbitrário, `npm install`, deploy, acesso de rede, provider real de IA, múltiplos agentes, edição multi-arquivo autônoma, plano autônomo, aprovação automática de alterações, rollback Git automático, comando de execução sugerido livremente pelo modelo. Nenhuma alteração de comportamento de `greeting`, `remember`, `recall`, `converse` (fatos e tarefas), workspace, `fs.listDirectory`, `fs.readFile`, `fs.createTextFile`, `fs.appendTextFile`, `fs.describeWorkspace`.

## 5. Responsabilidade Funcional Única

Dar ao Sebastian a capacidade de operar como um primeiro executor de desenvolvimento controlado - entender o repositório, editar código de forma segura, inspecionar Git e rodar validações autorizadas -, sem que o Core, a CLI ou a capability `converse` conheçam Git, npm, ou qualquer comando concreto, e sem introduzir um caminho de texto do usuário para shell.

## 6. Arquitetura

```
sebastiania "Altere o arquivo src/exemplo.ts substituindo X por Y"
  → converse → Agent → DevelopmentModelProvider → useTool "fs.replaceText"
  → LocalToolDispatcher → LocalFilesystemInspectionTool.replaceText()
    → exige exatamente 1 ocorrência de X
    → se Git: recusa se o arquivo já tiver alterações não commitadas
    → escreve via temp file + rename (nunca parcialmente escrito)
  → finalResult={message:'Arquivo "..." atualizado.'}

sebastiania "Qual é o estado deste repositório?"
  → useTool "git.status" → LocalGitInspectionTool → `git status --porcelain=v1 --branch -- .`
  → finalResult com branch real e arquivos alterados reais

sebastiania "Execute os testes do projeto"
  → useTool "validation.test" → LocalToolDispatcher (prefixo "validation.")
  → LocalAuthorizedCommandTool → executa o comando pré-registrado, sem shell
  → finalResult com exit code e resumo real de stdout/stderr
```

O `InMemorySpecializedAgent` não sofreu nenhuma alteração: `handleToolUse` já era genérico o bastante (decisão `useTool` → invoca a Tool → relê `output.message` → `finalResult`) para as três novas famílias de operação.

## 7. Edição Textual Controlada (`fs.replaceText`)

Reaproveita a mesma `LocalFilesystemPathGuard` já homologada (o alvo precisa existir - mesma resolução que `fs.readFile`/`fs.appendTextFile`). Fluxo: ler → validar tipo/tamanho/binário → contar ocorrências exatas do texto de busca (0 → `searchTextNotFound`; >1 → `multipleOccurrences`; exatamente 1 → prossegue) → validar tamanho do resultado → **consultar Git status do arquivo especificamente** (`git status --porcelain=v1 -- <path>`) e recusar com `fileAlreadyModified` se já houver alterações não commitadas → escrever em arquivo temporário no mesmo diretório e `rename` atômico. Nenhuma escrita ocorre antes de todas as validações passarem; se o workspace não for um repositório Git (ou `git` não estiver disponível), a proteção é ignorada e a edição prossegue normalmente - documentado como limitação aceita, não como falha.

## 8. Git Read-Only (`git.status`, `git.diff`)

`LocalGitCommandRunner` é o único ponto que invoca `git`: executável fixo, array de argumentos (nunca texto interpolado), `shell: false`, timeout de 10s, `cwd` sempre a allowed root. Apenas dois subcomandos existem: `status --porcelain=v1 --branch -- .` e `diff -- .` - o sufixo `-- .` confina ambos à allowed root mesmo quando ela é uma subpasta de um repositório maior, evitando que status/diff revelem alterações fora da área permitida. "Não é um repositório Git" (ou `git` ausente) é reportado como `outcome: 'rejected'` amigável, nunca como erro. `git.diff` limita a saída a 64 KiB com truncamento explicitamente sinalizado (nunca silencioso).

## 9. Execução de Validações Autorizadas (`LocalAuthorizedCommandTool`)

Não é um `shell.run` genérico: só executa comandos que a composição registrou previamente, indexados pelo próprio `toolId` (ex.: `validation.test`). Um `toolId` não registrado é recusado como resultado seguro (`notAuthorized`), nunca executado. `executable`/`args` são sempre um array estruturado vindo da configuração confiável - nunca do texto do usuário - executado com `spawnSync(..., { shell: false })`, comprovado por teste que nenhum metacaractere de shell é interpretado. Timeout configurável (60s por padrão) mata o processo e é reportado como `timedOut`; stdout/stderr são capturados e truncados a 64 KiB cada, nunca devolvidos sem limite.

**Fronteira de confiança documentada**: autorizar `validation.test` é autorizar a execução dos scripts que aquele projeto já define (ex.: `npm test` pode rodar qualquer coisa que o `package.json` do usuário definir como script de teste). Esta SPEC não tenta isolar ou sandboxear o que esses scripts fazem - a autorização em si, feita pela composição da aplicação, é o controle.

**Decisão de portabilidade sem shell**: no Windows, `npm`/`npm.cmd` não pode ser invocado com `shell: false` (limitação do próprio Node/SO para arquivos `.cmd`), e usar `shell: true` reintroduziria interpretação de metacaracteres pelo shell. Por isso, o conjunto padrão de validações do próprio Sebastian IA (`application/SebastianApplication.ts`) usa `process.execPath` com a flag nativa `node --run <script>` (Node 22+), que lê `package.json` diretamente e nunca precisa de shell, em qualquer plataforma.

## 10. `DevelopmentModelProvider`: reconhecimento mínimo

Seis marcadores/padrões adicionais, todos determinísticos: `"altere o arquivo X substituindo Y por Z"` (regex simples) → `fs.replaceText`; presença simultânea de `"estado"` e `"repositório"` → `git.status`; `"alterações atuais"` → `git.diff`; `"execute os testes"` / `"execute o build"` / `"execute o typecheck"` → `validation.test` / `validation.build` / `validation.typecheck`. Os três últimos usam constantes (`VALIDATION_TEST_TOOL_ID` etc.) exportadas por `LocalAuthorizedCommandTool.ts` como convenção sugerida, não como algo especial-caseado dentro da Tool - qualquer workspace pode registrar `toolId`s de validação completamente diferentes.

## 11. Limites e Segurança

- edição: mesmo teto de 256 KiB já usado por leitura/criação/acréscimo; uma única ocorrência exigida por padrão; escrita atômica; proteção contra arquivo já modificado no Git;
- Git: somente dois subcommandos fixos, nunca mutáveis; diff limitado a 64 KiB com truncamento sinalizado; confinado à allowed root;
- validações: apenas comandos pré-registrados pela composição; nunca shell; timeout de 60s por padrão; stdout/stderr limitados a 64 KiB cada; `cwd` sempre a allowed root; nenhuma execução em background; nenhuma elevação de privilégio; nenhuma rede introduzida pelo Sebastian.

## 12. Resultados das Tools e Memory

Cada resultado já chega como `finalResult.message`, pronto e limitado (ação executada, arquivo alterado, exit code, resumo de stdout/stderr, status Git) - o mesmo mecanismo de write-back já homologado desde a SPEC-039 persiste apenas esse resumo já produzido pelo pipeline, nunca um stdout/diff bruto e ilimitado; a limitação acontece inteiramente dentro da Tool, antes de qualquer persistência.

## 13. Critérios de Aceitação

- `"Qual é o estado deste repositório?"` retorna branch e arquivos alterados reais (ou recusa amigável fora de um repositório Git);
- `"Mostre as alterações atuais"` retorna o diff real (ou mensagem clara de "sem alterações");
- `"Altere o arquivo X substituindo Y por Z"` edita de verdade quando há exatamente uma ocorrência, e recusa com segurança para zero, mais de uma ocorrência, arquivo inexistente/binário/grande demais, traversal, caminho absoluto, symlink escapando da raiz, ou arquivo já modificado no Git - preservando o arquivo original em todos os casos de recusa;
- `"Execute os testes/o build/o typecheck"` executa de verdade uma validação pré-autorizada e reporta exit code e resumo reais; um `toolId` de validação não registrado é recusado com segurança;
- nenhum argumento de linguagem natural chega a um shell; nenhuma escrita/execução ocorre fora da allowed root;
- `greeting`, `remember`, `recall`, `converse` (fatos e tarefas), workspace e as Tools de filesystem da SPEC-042 continuam funcionando sem regressão;
- todos os testes, build e typecheck permanecem verdes; zero custo de API, zero rede, zero credencial.

## 14. Estratégia de Testes

Repositórios/workspaces Git temporários e isolados em todos os níveis (nunca projetos reais do usuário para escrita). Unitários: `LocalGitCommandRunner` (repo real, não-repo, escopo por pathspec); `LocalGitInspectionTool` (limpo, sujo, sem Git, confinamento à allowed root); `LocalAuthorizedCommandTool` (sucesso, falha real, não autorizado, timeout, truncamento, prova de ausência de injeção de shell, erro inesperado); `LocalFilesystemInspectionTool.replaceText` (sucesso, não encontrado, ambíguo, arquivo inexistente/binário/grande demais, traversal, absoluto, symlink, proteção Git suja, edição normal com/sem Git). Integração: vertical slice completo A-F (estado limpo → editar → status → diff → validação autorizada → resultado real) e G-I (alteração prévia → tentativa de edição → recusa por dirty-file) através de `CorePipelineBootstrap`/`SebastianApplication`, incluindo prova de que o conjunto padrão de validações do próprio Sebastian IA roda de verdade sem shell. Ponta a ponta por subprocessos reais contra o executável compilado, incluindo uma validação real (`build`) do próprio projeto.

## 15. Justificativa Arquitetural

Este bloco não introduz um "developer agent" paralelo nem múltiplos agentes. Ele estende a mesma Tool de filesystem já homologada (mais uma operação de escrita, reaproveitando o mesmo guard de caminho) e adiciona duas Tools novas seguindo exatamente o mesmo padrão já estabelecido (toolId-based dispatch pelo `LocalToolDispatcher`, decisão `useTool` genérica do Agent, resultado seguro e limitado). Git e execução de comandos são tratados com o mesmo rigor de segurança já aplicado a filesystem: superfície mínima e explícita (dois subcomandos Git fixos; comandos de validação só os pré-registrados), nunca uma porta genérica para texto do usuário virar comando de sistema.

## Status

Implementada e homologada.
