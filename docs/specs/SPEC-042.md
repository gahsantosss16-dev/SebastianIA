# SPEC-042 - Workspace de Projeto e Escrita Controlada

## 1. Contexto

A SPEC-040 entregou a primeira ação real do Sebastian (leitura read-only de filesystem), e a SPEC-041 entregou a primeira forma de organização persistente (tarefas), ambas reutilizando integralmente a arquitetura `Core → Memory hydration → Capability → Agent → ModelProvider → Tool`. O Sebastian entende, decide, lê e organiza - mas ainda não consegue produzir nenhum artefato real dentro do projeto do usuário, nem responder com uma identidade mínima de "onde estou".

O objetivo maior do produto não é uma IA genérica, e sim um assistente competente no ambiente e nos projetos do próprio usuário. Este bloco fecha o ciclo leitura↔escrita já preparado desde a SPEC-040 e dá ao Sebastian uma primeira noção de "workspace atual", sem introduzir infraestrutura nova.

## 2. Objetivo

Permitir que o usuário, dentro de um projeto autorizado (a mesma `allowedFilesystemRoot` já homologada), peça em linguagem natural para: identificar o workspace atual, inspecionar sua estrutura e ler arquivos (já entregues, reaproveitados sem alteração), criar uma nota/arquivo de texto novo, e acrescentar conteúdo a uma nota/arquivo existente - com a mesma proteção de contenção já homologada e sem qualquer custo de API, rede ou credencial.

## 3. Escopo

Entregue como vertical slice único:

- três novas operações na `LocalFilesystemInspectionTool`, existente desde a SPEC-040: `fs.createTextFile`, `fs.appendTextFile`, `fs.describeWorkspace`;
- extensão do `LocalToolDispatcher` para rotear os três novos `toolId`s, preservando o comportamento de eco para todos os demais;
- três reconhecimentos determinísticos mínimos no `DevelopmentModelProvider`: identidade do workspace, criação de nota, acréscimo a nota;
- contexto persistente do projeto: reaproveitamento explícito e sem alteração do mecanismo de fatos (`remember`/`recall`/`converse`) já homologado - nenhum novo discriminador, nenhuma nova store;
- testes unitários, de integração e por subprocessos reais cobrindo o vertical slice completo, incluindo segurança de escrita.

## 4. Fora do Escopo

- apagar, sobrescrever integralmente, renomear, mover ou executar arquivos;
- `chmod`, shell, execução de processo;
- escrita binária;
- indexação pesada, embeddings, RAG, banco vetorial;
- cópia automática do conteúdo dos arquivos do projeto para a memória;
- prazos, lembretes, notificações, categorização;
- comandos de histórico de tarefas (já fora de escopo desde a SPEC-041);
- alteração de comportamento de `greeting`, `remember`, `recall`, `converse` (fatos e tarefas), `fs.listDirectory` ou `fs.readFile`.

## 5. Responsabilidade Funcional Única

Fazer o Sebastian produzir artefatos reais e controlados dentro do workspace autorizado do usuário - não apenas ler -, e responder com uma identidade mínima e determinística desse workspace, sem introduzir nenhuma nova fronteira arquitetural, nenhum pipeline paralelo, e sem que o Core, a CLI ou a capability `converse` conheçam qualquer regra do domínio de workspace/filesystem.

## 6. Modelo de Workspace e de Contexto do Projeto

O "workspace" **é** a `allowedFilesystemRoot` já homologada na SPEC-040 - não existe um conceito de workspace separado, nem descoberta irrestrita do computador. A identidade do workspace (`fs.describeWorkspace`) é derivada exclusivamente de informação já disponível localmente, sem serviço externo:

- nome: o nome da própria pasta raiz permitida (`basename` da raiz canonicalizada);
- tamanho: contagem de itens no nível superior da raiz.

**Contexto persistente do projeto**: a pergunta "o que você sabe sobre este projeto?" é respondida pelo mecanismo de fatos já homologado (`remember`/`recall`/`converse`, SPEC-038/039), sem qualquer discriminador ou store novos. "Sebastian, lembra que este projeto usa TypeScript" já persiste e é recuperável exatamente como qualquer outro fato - não há necessidade de duplicar essa capacidade para o domínio de projeto, e fazê-lo violaria a diretriz explícita de não criar um banco separado nem RAG. Isso é reutilização deliberada, não uma lacuna.

## 7. Arquitetura

```
sebastiania "Em qual projeto estou?"
  → CLI fallback → converse → Core hidrata → Agent → DevelopmentModelProvider
  → decisão useTool, toolId="fs.describeWorkspace"
  → LocalToolDispatcher → LocalFilesystemInspectionTool.describeWorkspace()
  → finalResult={message:'Você está no workspace "projeto", com N itens na raiz.'}

sebastiania "Crie uma nota chamada pendencias.md com: revisar autenticação"
  → mesma cadeia → decisão useTool, toolId="fs.createTextFile", toolInput={path, content}
  → LocalFilesystemInspectionTool.createTextFile(): resolve o diretório-pai contra a
    allowed root (mesma LocalFilesystemPathGuard da SPEC-040), cria com flag exclusivo "wx"
  → finalResult={message:'Nota "pendencias.md" criada.'}

sebastiania "Acrescente na nota pendencias.md: revisar deploy"
  → decisão useTool, toolId="fs.appendTextFile"
  → resolve o alvo com a MESMA resolvePathWithinAllowedRoot já usada por fs.readFile
    (o alvo precisa existir - isso por si só garante "nunca cria implicitamente")
  → finalResult={message:'Conteúdo acrescentado a "pendencias.md".'}
```

O Agent não precisou de nenhuma alteração: `handleToolUse` já era genérico o suficiente (decisão `useTool` → invoca a Tool → relê `output.message` → `finalResult`) para suportar as três novas operações sem tocar em `core/agent/InMemorySpecializedAgent.ts`.

## 8. Operações Reais Adicionadas

### `fs.createTextFile`
Cria um arquivo de texto novo dentro da raiz permitida. **Nunca sobrescreve**: usa a flag exclusiva do sistema operacional (`wx`), tornando a verificação de existência e a escrita atômicas - não há janela de corrida entre "checar que não existe" e "criar". Se o diretório-pai não existir, é tratado como "não encontrado" (a mesma resolução de caminho da leitura é reaproveitada para o diretório-pai). Diretório-pai não é criado implicitamente.

### `fs.appendTextFile`
Acrescenta conteúdo a um arquivo de texto já existente. Reaproveita **sem nenhuma alteração** a mesma resolução de caminho usada por `fs.readFile` (que já exige que o alvo exista) - por construção, nunca cria implicitamente. Recusa acrescentar a um arquivo binário (mesma detecção por byte nulo já usada na leitura) e nunca trunca o conteúdo existente.

### `fs.describeWorkspace`
Somente leitura, sem input de caminho: devolve nome da raiz e contagem de itens do nível superior.

## 9. Proteções de Escrita

Toda escrita reutiliza integralmente a política de contenção já homologada na SPEC-040 (`LocalFilesystemPathGuard`): rejeição de caminho absoluto, rejeição de traversal léxico antes de qualquer acesso a disco, e rejeição de escape via symlink/junction após resolução real (`realpath`) - aplicada tanto ao alvo (`appendTextFile`) quanto ao diretório-pai do alvo (`createTextFile`). Nenhuma lógica de contenção nova foi escrita; a mesma função (`resolvePathWithinAllowedRoot`) é invocada para os três casos (leitura, diretório-pai de criação, alvo de acréscimo).

## 10. Limites

- conteúdo de criação: máximo 256 KiB, rejeitado por inteiro (nunca truncado) se ultrapassar;
- acréscimo: soma do conteúdo existente com o novo não pode ultrapassar 256 KiB - rejeitado por inteiro antes de qualquer escrita, arquivo original preservado intacto;
- ambos os limites reaproveitam o mesmo teto já usado para leitura (`fs.readFile`), unificando a noção de "tamanho seguro de arquivo de texto" em uma única constante.

## 11. Erros Esperados

Todos resultam em resposta amigável, nunca em crash ou exit code de erro - reaproveitando o mesmo padrão `outcome: 'rejected'` já homologado na SPEC-040:

- criar sobre um arquivo já existente → recusado, arquivo original intacto;
- acrescentar a um caminho inexistente → recusado, nada é criado;
- acrescentar a um diretório ou a um arquivo binário → recusado;
- conteúdo de criação ou resultado de acréscimo acima do limite → recusado, nada é escrito;
- traversal, caminho absoluto, symlink escapando da raiz → recusado, idêntico ao já testado para leitura.

## 12. Invariantes

- Core, CLI e a capability `converse` continuam sem qualquer conhecimento de workspace ou de regras de filesystem;
- a decisão de qual operação usar pertence exclusivamente ao Agent, através do `ModelProvider`;
- nenhum contrato de `SpecializedTool`, `SpecializedAgent`, `Capability` ou do formato de `memory.json` é alterado;
- `fs.listDirectory`, `fs.readFile`, `remember`, `recall`, `converse` (fatos e tarefas) e `greeting` continuam funcionando sem regressão;
- zero dependência externa, zero chamada de rede, zero credencial.

## 13. Critérios de Aceitação

- `sebastiania "Em qual projeto estou?"` responde com o nome real da raiz permitida e a contagem real de itens;
- `sebastiania "Quais arquivos existem?"` e `sebastiania "Leia o arquivo X"` continuam funcionando sem alteração;
- `sebastiania "Crie uma nota chamada X com: Y"` cria um arquivo real com o conteúdo `Y`, sem sobrescrever um `X` já existente;
- `sebastiania "Acrescente na nota X: Y"` acrescenta `Y` a um `X` já existente, preservando o conteúdo anterior, e nunca cria `X` implicitamente;
- tentativas de escrita fora da raiz permitida (traversal, absoluto, symlink) são recusadas com mensagem segura;
- `sebastiania "Sebastian, lembra que ..."` seguido de `sebastiania "O que você sabe sobre este projeto?"`, em processos separados, continua funcionando via o mecanismo de fatos já existente;
- todos os testes, build e typecheck permanecem verdes;
- zero custo de API, zero chamada de rede, zero credencial.

## 14. Estratégia de Testes

- unitários: `LocalFilesystemInspectionTool` (criação, criação em subdiretório existente, nunca sobrescreve, diretório-pai ausente, limite de conteúdo, traversal/absoluto/symlink na criação, acréscimo preservando conteúdo anterior, nunca cria implicitamente, recusa diretório/binário, limite de acréscimo, symlink no acréscimo, identidade do workspace); `LocalToolDispatcher` (roteamento dos três novos `toolId`s); `DevelopmentModelProvider` (os três novos marcadores, conteúdo vazio cai no fallback); `InMemorySpecializedAgent` (uma decisão `useTool` de escrita relidando corretamente, provando que nenhuma mudança no Agent foi necessária);
- integração: `CorePipelineBootstrap`/`SebastianApplication` com o vertical slice completo (identidade → listagem → leitura → criação → acréscimo → releitura → recusa de sobrescrita → recusa de acréscimo ausente) entre instâncias `SebastianCore`/`SebastianApplication` separadas compartilhando o mesmo `allowedFilesystemRoot`, mais contenção de escrita (traversal, symlink) no nível do `Core`, mais convivência com o mecanismo de fatos para "contexto do projeto";
- ponta a ponta por subprocessos reais (`spawnSync` contra o executável compilado, `cwd` apontando para uma raiz de fixture isolada): identidade, criação lida por processo separado, acréscimo lido por processo separado, recusa de sobrescrita, recusa de acréscimo ausente, recusa de escrita fora da raiz, e regressão de `greeting`/`recall`/tarefas convivendo no mesmo workspace.

## 15. Justificativa Arquitetural

Este bloco não introduz nenhuma fronteira nova. Ele completa, com a menor extensão suficiente, o que a SPEC-040 já havia preparado estruturalmente: a mesma Tool, o mesmo guard de caminho, o mesmo dispatcher, o mesmo Agent genérico. Escrita é tratada como uma extensão da mesma disciplina de segurança já homologada (mesma função de contenção, mesmo teto de tamanho, mesmo padrão de rejeição amigável) em vez de um novo subsistema. Contexto de projeto é tratado como reuso deliberado do mecanismo de fatos já homologado, evitando duplicar o que já existe - exatamente como a diretriz desta etapa pediu: menor caminho correto, sem abstração sem benefício funcional.

## Status

Implementada e homologada.
