# SPEC-040 - Primeira Tool Real: Inspeção Local de Filesystem (Read-Only)

## 1. Contexto

A SPEC-039 entregou o Agent (`InMemorySpecializedAgent`) como decisor real de conversação, consultando um `ModelProvider` substituível para interpretar linguagem natural e influenciar o resultado efetivo do `Core`. Até ali, porém, o contrato Agent → Tool homologado na SPEC-037 permanecia estruturalmente presente mas funcionalmente vazio: `InMemorySpecializedTool` é um eco puro - devolve o próprio payload recebido, sem executar nenhuma ação real sobre o mundo.

O Sebastian IA precisa avançar de ENTENDER + LEMBRAR para ENTENDER + DECIDIR + AGIR. Isso exige que, pelo menos uma vez, a cadeia completa `Core → Memory hydration → Capability → Agent → Tool` produza um efeito real e perceptível pelo usuário - não apenas uma resposta textual derivada de memória interna.

## 2. Objetivo

Permitir que o usuário, em linguagem natural via CLI, peça ao Sebastian para listar o conteúdo de uma pasta ou ler o conteúdo de um arquivo, e receba de volta dados reais lidos do disco - com a decisão de usar a Tool tomada pelo Agent através do `ModelProvider`, dentro de uma raiz de filesystem explicitamente permitida, sem qualquer custo de API, rede ou credencial.

## 3. Escopo

Entregue como vertical slice único:

- duas operações read-only na `LocalFilesystemInspectionTool`: `fs.listDirectory` e `fs.readFile`;
- guarda de caminho (`LocalFilesystemPathGuard`) com canonicalização via `realpath`, rejeição de caminho absoluto, rejeição de traversal léxico antes de tocar o disco, e rejeição de escape via symlink após resolução real;
- `LocalToolDispatcher`: despacho mínimo por `toolId`, sem registry formal, preservando o comportamento de eco para todos os `toolId` pré-existentes;
- evolução mínima do `ModelProviderContract` com a decisão `useTool` e do `DevelopmentModelProvider` com dois marcadores determinísticos ("arquivos existem", "leia o arquivo");
- evolução do `InMemorySpecializedAgent` para, no ramo `converse`, invocar a Tool quando a decisão for `useTool` e traduzir seu resultado em `finalResult`;
- raiz de filesystem permitida (`allowedFilesystemRoot`) capturada pela composição da aplicação (`SebastianApplication`/`CorePipelineBootstrap`), com seam de injeção para testes, nunca derivada de texto do usuário;
- testes unitários, de integração e por subprocessos reais.

## 4. Fora do Escopo

- escrita, criação, remoção ou rename de arquivos/diretórios;
- listagem recursiva;
- execução de shell ou processos externos;
- parsing de binários (PDF, imagem etc.) ou qualquer tentativa de decodificação de conteúdo binário;
- sumarização semântica do conteúdo lido (nenhum LLM real nesta fase - "ler" não é "resumir com inteligência");
- LLM real, API paga, rede, credencial;
- raiz de filesystem configurável por texto do usuário em runtime;
- registry formal de Tools;
- qualquer Tool além da inspeção de filesystem.

## 5. Responsabilidade Funcional Única

Fazer a Tool, já prevista estruturalmente desde a SPEC-037, executar uma ação real e segura sobre o filesystem local quando o Agent - através do `ModelProvider` - decidir que ela é necessária, com o resultado dessa ação alcançando o usuário pela mesma via já homologada na SPEC-039 (`finalResult`), sem que o `Core`, a capability `converse` ou a CLI conheçam qualquer regra específica de filesystem.

## 6. Arquitetura

```
sebastiania "Quais arquivos existem na pasta docs/specs?"
  → CLI: fallback de texto livre → commandType "converse" (inalterado)
  → Core hidrata contexto
  → capability "converse" apenas repassa {text}, sem decidir Tool
  → Core → Agent.handoff() → DevelopmentModelProvider.interpret()
  → decisão: intent=useTool, toolId="fs.listDirectory", toolInput={path:"docs/specs"}
  → Agent invoca LocalToolDispatcher.invoke() → LocalFilesystemInspectionTool real
  → Tool resolve o caminho contra allowedFilesystemRoot, lê o diretório real
  → Agent traduz output.message em finalResult={message:"Arquivos em \"docs/specs\": ..."}
  → Core adota finalResult → resposta ao usuário e write-back
```

A decisão de qual Tool usar pertence exclusivamente ao Agent (via `ModelProvider`). O `Core` continua reconhecendo `finalResult` de forma genérica, exatamente como na SPEC-039, sem qualquer acoplamento a `commandType` ou a vocabulário de filesystem.

## 7. Contrato `ModelProvider`: decisão `useTool`

```ts
interface ModelInterpretationUseToolDecision {
  readonly intent: 'useTool';
  readonly toolId: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
}
```

Adicionada à união `ModelInterpretationDecision`, ao lado de `remember` e `respond`, sem alterar a forma dessas duas.

## 8. `DevelopmentModelProvider`: reconhecimento mínimo

Dois marcadores determinísticos adicionais, no mesmo espírito de `"lembra que"`:

- `"arquivos existem"` → `useTool` com `toolId: "fs.listDirectory"`; ausência de caminho após o marcador resolve para `"."` (a própria raiz permitida);
- `"leia o arquivo"` → `useTool` com `toolId: "fs.readFile"`; ausência de caminho após o marcador não produz uma decisão de Tool, caindo no fluxo de resposta genérica pré-existente.

Isso é reconhecimento de adapter de desenvolvimento, não NLU. Um `ModelProvider` real substitui esta implementação inteira atrás do mesmo contrato estruturado, sem exigir mudança em Core, Memory, Capability ou Tool.

## 9. `InMemorySpecializedAgent`: uso de Tool em `converse`

No ramo já existente de conversação (SPEC-039), uma nova bifurcação: quando a decisão do `ModelProvider` é `useTool`, o Agent invoca `SpecializedTool.invoke()` com o `toolId`/`toolInput` decididos e traduz o campo `message` do resultado da Tool - já seguro para exibição - em `finalResult.message`. Uma falha inesperada da Tool (`status: 'failed'`) propaga como falha de handoff, preservando a semântica de falha já existente para os outros `toolId`. Para `greeting`, `remember`, `recall` e para `converse` sem decisão `useTool`, o comportamento é idêntico ao da SPEC-039.

## 10. `LocalFilesystemInspectionTool`: operações e segurança

Implementa `SpecializedTool` com duas operações, roteadas por `toolId`:

- `fs.listDirectory`: lista as entradas de um diretório, um nível apenas, ordenadas por nome;
- `fs.readFile`: lê o conteúdo integral de um arquivo, como texto UTF-8.

Toda condição esperada é reportada como um resultado `completed` com `outcome: 'rejected'` e uma mensagem segura para o usuário - nunca como exceção ou leitura parcial silenciosa:

- caminho absoluto (`absolutePathRejected`) - rejeitado incondicionalmente, mesmo que nominalmente caísse dentro da raiz;
- caminho fora da raiz permitida, por traversal léxico ou por escape via symlink (`outsideRoot`);
- caminho inexistente (`notFound`);
- alvo do tipo errado para a operação (`notADirectory`, `notAFile`);
- arquivo acima de 256 KiB (`fileTooLarge`) - rejeitado por inteiro, nunca lido parcialmente;
- conteúdo binário, detectado por byte nulo (`binaryFile`);
- diretório com mais de 500 entradas (`listingLimitExceeded`) - rejeitado por inteiro, nunca listado parcialmente.

`status: 'failed'` fica reservado para falhas de I/O genuinamente inesperadas, não previstas pela guarda.

### 10.1 Guarda de caminho (`LocalFilesystemPathGuard`)

A raiz permitida é canonicalizada uma vez via `realpath`. Cada caminho requisitado passa por:

1. rejeição imediata se absoluto;
2. verificação léxica de contenção (via `path.relative`, nunca por prefixo textual - o que evita a armadilha `C:\projeto` vs `C:\projeto-malicioso`) antes de qualquer acesso a disco, capturando traversal sintático mesmo contra alvos inexistentes;
3. resolução real via `realpath` do caminho já validado lexicalmente, capturando `notFound` para o que não existe;
4. nova verificação de contenção sobre o caminho já resolvido, capturando escape via symlink cujo alvo real sai da raiz.

## 11. `LocalToolDispatcher`: despacho mínimo

Sem registry formal: `fs.listDirectory` e `fs.readFile` vão para `LocalFilesystemInspectionTool`; qualquer outro `toolId` (`tool.greeting`, `tool.remember`, `tool.recall`, ou qualquer `toolId` futuro não-filesystem) vai para o `InMemorySpecializedTool` pré-existente, preservando seu comportamento de eco sem alteração.

## 12. Raiz de filesystem permitida

`allowedFilesystemRoot` é uma opção nova em `SebastianApplicationOptions` e em `CorePipelineBootstrapInput`, capturada pela composição da aplicação. Quando omitida, resolve para `process.cwd()` no momento da composição - nunca a partir de texto do usuário. A CLI e o `Core` não têm conhecimento desse conceito; apenas a composição (camada de aplicação) e a Tool o conhecem.

## 13. Invariantes

- `Core` nunca importa nem referencia `LocalFilesystemInspectionTool`, `allowedFilesystemRoot` como conceito de regra, ou qualquer vocabulário de filesystem;
- a capability `converse` não decide qual Tool usar - continua repassando `{text}` sem interpretação;
- a decisão de uso de Tool pertence exclusivamente ao Agent, através do `ModelProvider`;
- nenhum contrato de `SpecializedTool`, `SpecializedAgent` ou `Capability` muda de forma;
- `greeting`, `remember`, `recall` e `converse` sem decisão `useTool` continuam funcionando sem regressão;
- nenhuma escrita, criação, remoção ou execução ocorre através da Tool;
- zero dependência externa, zero chamada de rede, zero credencial.

## 14. Critérios de Aceitação

- `sebastiania "Quais arquivos existem na pasta X?"` retorna a listagem real de `X`, dentro da raiz permitida;
- `sebastiania "Leia o arquivo X"` retorna o conteúdo real de `X`, dentro do limite de 256 KiB;
- caminho absoluto, traversal e symlink escapando da raiz são rejeitados com mensagem segura, sem crash e sem exit code de erro;
- arquivo acima de 256 KiB, arquivo binário e diretório acima de 500 entradas são rejeitados com mensagem clara, sem leitura/listagem parcial;
- `greeting`, `remember`, `recall` e `converse` (memorização e resposta) continuam funcionando sem regressão de comportamento;
- `allowedFilesystemRoot` omitido resolve para `process.cwd()`;
- todos os testes, build e typecheck permanecem verdes;
- zero custo de API, zero chamada de rede, zero credencial.

## 15. Estratégia de Testes

- unitários: `LocalFilesystemPathGuard` (caminho permitido, raiz por "." vazio, absoluto, traversal léxico, traversal para diretório-irmão real, distinção root vs diretório com prefixo textual semelhante, não encontrado, symlink escapando via junction); `LocalFilesystemInspectionTool` (listagem, listagem vazia, leitura, não encontrado, tipo errado em ambas operações, arquivo grande demais, arquivo binário, limite de listagem, `toolId` não suportado, payload inválido); `LocalToolDispatcher` (roteamento fs.\* vs fallback, regressão do eco); `DevelopmentModelProvider` (os dois novos marcadores, determinismo, regressão dos marcadores existentes); `InMemorySpecializedAgent` (invocação da Tool com `toolId`/`toolInput` decididos, propagação de falha inesperada);
- integração: `CorePipelineBootstrap`/`SebastianApplication` compondo `allowedFilesystemRoot` explícito e por default (`process.cwd()`), `SebastianCore.executeCommand()` ponta a ponta com a capability `converse` real, incluindo confinamento à raiz permitida;
- ponta a ponta por subprocessos reais (`spawnSync` contra o executável compilado, com `cwd` apontando para uma raiz de fixture isolada): listagem real, leitura real, rejeição segura de traversal, e regressão de `greeting`/`remember`/`recall` compartilhando o mesmo processo real.

## 16. Justificativa Arquitetural

Esta SPEC não introduz uma nova fronteira nem um pipeline paralelo. Ela preenche, com a menor extensão suficiente, uma lacuna que já existia estruturalmente desde a SPEC-037: o contrato Agent → Tool existia, mas nunca havia sido usado para uma ação real. A raiz permitida, o guard de caminho e os limites de tamanho garantem que essa primeira ação real seja auditável, confinada e reversível por construção (somente leitura), servindo de base defensável para futuras Tools sem repetir o design de segurança do zero.

## Status

Implementada e homologada.
