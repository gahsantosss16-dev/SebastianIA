# SPEC-047 - Correção Autônoma Baseada em Evidência

## 1. Contexto

A SPEC-046 deu ao Sebastian um ciclo cognitivo real (objetivo → plano → ação → observação → decisão → verificação → conclusão), mas sua única forma de "corrigir" exigia que o usuário já soubesse e fornecesse o texto exato a ser substituído (`goal.fix.searchText`/`replaceText`). Um pedido como "descubra por que esse teste está falhando e corrija" era reconhecido como autorizado a alterar arquivos, mas o ciclo simplesmente desistia: "não foi possível determinar uma correção segura e concreta automaticamente".

Este bloco elimina exatamente essa lacuna: o Sebastian agora extrai evidência real da própria falha (a mesma saída de validação que já capturava, mas até então descartava), descobre sozinho qual arquivo provavelmente está envolvido, formula uma hipótese concreta de correção, aplica-a, verifica, e - se a hipótese estava errada - reconsidera com base na nova evidência, dentro de um limite curto e determinístico.

## 2. Objetivo

Permitir que "Sebastian, descubra por que esse teste está falhando e corrija" resulte em uma correção real, sem que o usuário informe previamente arquivo, linha, texto antigo ou texto novo - usando exclusivamente evidência genuína (saída da validação, conteúdo de arquivos já lidos) e as mesmas Tools já homologadas, dentro da mesma política de autorização e do mesmo limite de passos já estabelecidos na SPEC-046.

## 3. Escopo

Entregue como vertical slice único:

- `FailureEvidenceParser` (`core/development/`): módulo puro e pequeno que extrai, da saída já capturada de uma validação, os valores `actual`/`expected` de uma falha de asserção (formato real do `node:assert`) e o arquivo do teste que falhou (formato real de `node --test`);
- extensão do `GoalExecutionOrchestrator` (SPEC-046, não substituído): quando um objetivo é `writeAuthorized` sem uma correção concreta pré-informada, ele agora lê o arquivo de teste que falhou, descobre arquivos candidatos a partir das próprias importações desse teste, forma uma hipótese (`actual` → `expected`) e tenta aplicá-la via `fs.replaceText` já homologado - reconsiderando com evidência fresca até um limite curto se a primeira tentativa não resolver;
- reordenação mínima no `DevelopmentModelProvider`: uma frase que combina investigação e correção ("descubra... e corrija") agora concede autorização de escrita, mesmo sem uma edição concreta informada;
- testes unitários, de integração e por subprocessos reais comprovando o comportamento com um bug real, não simulado.

## 4. Fora do Escopo

Indexador genérico, banco de código, embeddings, busca vetorial, language server, análise estática, varredura de todo o workspace, qualquer Tool nova (nenhuma foi necessária - ver seção 10), internet, LLM pago, Git mutável, commit/push automático, rollback destrutivo, autonomia irrestrita. Nenhuma alteração de comportamento das capacidades já homologadas nas SPEC-034 a SPEC-046.

## 5. Responsabilidade Funcional Única

Fazer o Sebastian formular e aplicar sua própria hipótese de correção a partir de evidência real, dentro do mesmo ciclo, da mesma política de autorização e do mesmo limite de passos já homologados na SPEC-046 - sem introduzir um segundo motor de execução, sem reimplementar Tools existentes, e sem que a descoberta dependa de mais frases-mágicas na entrada do usuário do que estritamente necessário.

## 6. De Onde Vem a Evidência

`LocalAuthorizedCommandTool` (SPEC-043, inalterada) já captura `stdout`/`stderr` de toda validação executada - o `GoalExecutionOrchestrator` da SPEC-046 simplesmente descartava esse conteúdo depois de extrair `succeeded`/`exitCode`. Este bloco só passou a **olhar** para esse texto já disponível. `FailureEvidenceParser.parseFailureEvidence` reconhece duas formas, ambas genuinamente produzidas por `node:assert`/`node --test` (comprovado por captura real, não hipotética):

- o objeto de erro estruturado que `node --test` já imprime (`actual: 5,` / `expected: 4,`);
- a linha simples equivalente (`5 !== 4`), como respaldo quando a saída estruturada não está presente;
- a linha `test at <arquivo>:<linha>:<coluna>` que `node --test` já imprime para toda falha, identificando o próprio arquivo de teste.

Valores não utilizáveis (`undefined`, `null`, `NaN`, booleanos, objetos/arrays multilinhas, ou quando `actual === expected`) são deliberadamente descartados - o parser nunca adivinha a partir de uma forma que não reconhece.

## 7. Como os Arquivos Candidatos São Descobertos

Nenhum novo mecanismo de busca foi criado. Uma única leitura (`fs.readFile`, já homologada) do arquivo de teste identificado pela evidência é suficiente: `extractImportedRelativePaths` extrai as próprias declarações `require(...)`/`from '...'` relativas desse arquivo e as resolve contra o diretório do teste. Nunca uma varredura do workspace - um teste que não importa nada relevante simplesmente não produz candidatos, e a investigação relata isso honestamente em vez de adivinhar. A descoberta é limitada a `MAX_CANDIDATE_FILES = 3`.

## 8. Hipótese e Aplicação

Uma hipótese é a tupla `(arquivo candidato, actual, expected)`. O orquestrador tenta, em ordem, `fs.replaceText(candidato, actual, expected)` em cada candidato - reaproveitando integralmente a segurança já homologada da SPEC-043/044 (exige exatamente uma ocorrência exata do texto; recusa se o arquivo já tiver alterações não commitadas; escrita atômica). Um candidato que não contém o valor `actual` é simplesmente recusado pela própria Tool (`searchTextNotFound`) e o próximo é tentado - o mecanismo de descoberta de "qual arquivo" e "isso se aplica aqui" é, na prática, a própria Tool de edição já existente, não uma lógica nova e paralela.

## 9. Verificação e Reconsideração

Depois de aplicar uma hipótese, a mesma validação do objetivo é executada de novo (VERIFY, já homologado na SPEC-046). Só há duas saídas:

- **passou**: `status: 'completed'`, evidência final (`git.diff`) reunida, a hipótese aplicada é relatada no `message`;
- **ainda falha**: a alteração **não é revertida** - ela é preservada, e uma nova evidência é extraída da *nova* saída de falha (que pode revelar `actual`/`expected` diferentes agora que o código mudou). Uma segunda hipótese, genuinamente fundamentada nessa evidência fresca, é tentada contra os mesmos candidatos - nunca uma repetição cega da primeira tentativa.

O laço de reconsideração é limitado a `MAX_FIX_ATTEMPTS = 2`. Esgotadas as tentativas sem sucesso, o resultado é `status: 'failed'`, `reason: 'verificationFailed'`, com todas as edições aplicadas preservadas para revisão - nunca esperado, nunca escondido, nunca revertido automaticamente. Isso reforça, sem alterar, o princípio já estabelecido na SPEC-046: **ação executada ≠ objetivo concluído**.

## 10. Ferramentas Reutilizadas e Ausência de Ferramenta Nova

Reutilizadas sem alteração: `fs.readFile`, `fs.replaceText`, `git.status`, `git.diff`, `validation.*` (todas já homologadas desde a SPEC-040/043/044). `fs.readFile` passou a integrar a lista de toolIds sempre permitidos (`READ_ONLY_TOOL_IDS`) do `GoalExecutionOrchestrator`, exatamente com a mesma justificativa que já vale para `git.status`/`git.diff`: ler é investigação, nunca alteração.

**Nenhuma Tool nova foi criada.** A extração de evidência e a descoberta de candidatos são funções puras (`FailureEvidenceParser`), não uma nova fronteira de execução - elas processam texto que a Tool de validação já devolvia, e o resultado da descoberta só é usado para parametrizar a mesma `fs.replaceText` já existente.

## 11. Autorização (Reforça, Não Amplia, a SPEC-046)

- **Só investigação** ("descubra por que está falhando"): a mesma evidência é extraída e usada para produzir um diagnóstico mais útil (nomeando o arquivo candidato e o valor esperado/obtido), mas o ciclo nunca invoca `fs.replaceText` - `goal.authorization` continua `readOnly`, e essa é a única coisa que controla se a fase de correção autônoma sequer é tentada.
- **Investigação + correção** ("descubra... e corrija"/"conserte"): a palavra de correção é o que concede `writeAuthorized` - independentemente de qual marcador aparece primeiro na frase, verificado explicitamente por reordenação no `DevelopmentModelProvider`.
- **Continuação genérica** ("continua"/"resolve"/"pode seguir" isoladas): continuam nunca produzindo uma `GoalDefinition` por si sós - inalterado desde a SPEC-046, comprovado por teste de regressão.
- **Ações sensíveis**: continuam estruturalmente inatingíveis - o conjunto fixo de toolIds que o orquestrador conhece nunca inclui Git mutável, commit, push, deploy ou exclusão.

## 12. Correção Mínima e Escopo Controlado

A hipótese é sempre uma única substituição textual exata (a mesma disciplina "uma ocorrência exata" já homologada) no candidato onde ela se aplica - nunca uma reescrita, nunca múltiplos arquivos simultâneos por hipótese, nunca refatoração. Um arquivo que não é importado pelo teste que falhou nunca é sequer tentado, mesmo que compartilhe coincidentemente o mesmo valor textual (comprovado por teste dedicado com um arquivo não relacionado contendo o mesmo literal "errado").

## 13. Continuidade e Memória (Reuso, Não Duplicação)

Nenhuma lógica de memória foi tocada. O resultado de uma investigação/correção autônoma continua fluindo pelo mesmo mecanismo `memoryExtras`/`conversationTurn` já homologado na SPEC-045, através do mesmo `finalResult.goalExecution` já homologado na SPEC-046 - uma mensagem curta como "E o que estava causando aquilo?" continua funcionando exatamente como já funcionava para qualquer outro objetivo, sem nenhum código novo específico para isso.

## 14. Limite Contra Loops (Reforça o da SPEC-046)

O mesmo `MAX_GOAL_EXECUTION_STEPS`, agora `14` (antes `6`) para acomodar o pior caso realista do novo ciclo (inspecionar + validar + ler o teste + até `MAX_CANDIDATE_FILES` tentativas de edição + verificar, repetido até `MAX_FIX_ATTEMPTS` vezes, mais o diff final) - ainda pequeno, ainda inteiramente limitado, centralizado como constante exportada, nunca espalhado como número mágico. `MAX_CANDIDATE_FILES = 3` e `MAX_FIX_ATTEMPTS = 2` são os dois novos limites, igualmente centralizados. Testado diretamente (limite atingido no meio da descoberta, sem invocar mais nada).

## 15. Critérios de Aceitação

- "Sebastian, descubra por que esse teste está falhando e corrija", contra um projeto real com um bug real, resulta em uma edição real, uma verificação real, e um relatório de sucesso comprovado - sem que oldText/newText tenham sido fornecidos;
- a mesma frase sem "e corrija" nunca altera nenhum arquivo, mesmo identificando a mesma causa;
- um arquivo não relacionado, mesmo compartilhando o valor "errado" por coincidência, nunca é alterado;
- uma primeira hipótese que não resolve o problema é preservada, não revertida, e uma segunda hipótese fundamentada em evidência nova é tentada;
- uma correção que nunca passa na verificação é relatada como `failed`, nunca como sucesso;
- nenhuma execução ultrapassa o limite de passos;
- uma mensagem posterior relacionada aproveita o contexto persistido da execução anterior;
- todas as capacidades homologadas nas SPEC-034 a SPEC-046 continuam funcionando sem alteração de comportamento;
- todos os testes, build e typecheck permanecem verdes; zero custo de API, zero rede, zero credencial.

## 16. Estratégia de Testes

Unitários (`FailureEvidenceParser`): extração de `actual`/`expected` estruturado e em formato simples, valores inutilizáveis descartados, diffs multilinhas ignorados em vez de adivinhados, ausência de forma reconhecível tratada como ausência de evidência, extração/resolução de importações relativas do arquivo de teste, deduplicação. Unitários (`GoalExecutionOrchestrator`): descoberta e correção autônoma bem-sucedida em uma única tentativa; diagnóstico somente-leitura usando a mesma evidência sem jamais editar; escopo controlado (candidato não relacionado nunca é alterado); reconsideração com uma segunda hipótese fundamentada em evidência nova, preservando a primeira edição; esgotamento de tentativas relatado como falha preservando as edições; ausência de evidência utilizável ou de candidatos tratada honestamente; arquivo de teste ilegível não derruba o objetivo inteiro; teto de candidatos e limite de passos comprovados deterministicamente. `DevelopmentModelProvider`: múltiplas formulações distintas concedendo autorização de escrita quando investigação e correção se combinam, múltiplas formulações distintas permanecendo somente-leitura quando não há verbo de correção, ausência de regressão nos reconhecimentos já homologados. Integração (`SebastianApplication`, repositório Git temporário real, bug real, teste `node:test` real falhando, arquivo não relacionado real): diagnóstico sem edição, correção autônoma completa com verificação, ausência de autorização preservando o arquivo, continuidade após a correção. Ponta a ponta (subprocesso real contra o executável compilado): descoberta e correção autônomas completas, incluindo a prova de que o arquivo não relacionado permanece intocado.

## 17. Nota de Infraestrutura de Teste (Não uma Limitação do Sebastian)

Como a própria suíte de testes deste projeto roda sob `node --test`, um `node --test` aninhado (disparado pela Tool de validação de um fixture) herdaria `NODE_TEST_CONTEXT`/`NODE_TEST_WORKER_ID` do processo pai e seria silenciosamente ignorado pelo próprio mecanismo de detecção de recursão do Node - um comportamento real do Node, não do Sebastian. Os fixtures de integração e ponta a ponta deste bloco incluem um pequeno script de encapsulamento, em Node puro, que limpa essas duas variáveis antes de delegar ao `node --test` real e inalterado - o texto que o Sebastian efetivamente analisa continua sendo a saída genuína e não modificada do `node --test`. A homologação manual (seção 18 do pedido), executada fora de qualquer processo `node --test`, não precisa desse encapsulamento.

## Status

Implementada e homologada.
