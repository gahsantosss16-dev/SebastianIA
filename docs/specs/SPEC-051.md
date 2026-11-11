# SPEC-051 — Interpretação pelo modelo primeiro, regras determinísticas como guardas

## 1. Status

Implementada em branch isolada, aguardando homologação. Não publicada.

## 2. Evidência que motivou a mudança (produção, 11/11/2026)

Homologação manual com 16 mensagens reais (testes A, B e C). Provedor ativo: Gemini `gemini-3.1-flash-lite` (log de inicialização da Hostinger). 3 de 16 pedidos foram concluídos corretamente.

Causas comprovadas por código e pelos logs Node da Hostinger:

1. **Bloqueio antes do modelo** — `ProjectConversationContext` tratava qualquer trecho curto após "no/na/do/da" como nome de projeto e recusava a mensagem como "Projeto desconhecido ou ambíguo" (A1, A9, B1, C1), ou devolvia só a identificação do projeto (A4).
2. **Roteamento determinístico antes do modelo** — padrões por frase (`deterministicIntent`) decidiam a ferramenta: perguntas de estrutura e de commit viraram `github.getProject` (A3, A6); uma pergunta sobre uma branch virou a lista de commits da main, e a síntese atribuiu esses commits à branch (A8, declaração falsa); qualquer caminho de arquivo virou leitura, mesmo em pedidos de escrita (C2, C3).
3. **Argumentos invisíveis ao modelo** — o menu de ferramentas enviado ao modelo não continha os nomes dos argumentos, e o schema do Gemini declarava `toolArguments` sem propriedades. O modelo escolhia a ferramenta certa e era recusado com `cognitiveInvalidToolArguments` (A5, A7, A10).
4. **Ancoragem rígida** — a síntese era rejeitada (`ungroundedSynthesis`) quando o trecho citado diferia da observação apenas em espaços ou quebras de linha, e o arquivo bruto era devolvido (B3).

## 3. Decisão arquitetural

- **O modelo interpreta primeiro.** `CognitiveOperationalOrchestrator.execute` consulta `decide()` antes de qualquer rota determinística.
- **Rotas determinísticas viram reserva.** Elas só fornecem evidência quando a interpretação do modelo é inutilizável e nenhuma ferramenta rodou: modelo indisponível, resposta inválida, bloqueio por guarda, ou conclusão sem evidência quando uma rota se aplicaria (o modo de falha em que o modelo alegava "sem acesso").
- **Menção solta de projeto não decide.** `ProjectReply.deferrable` marca respostas derivadas de menção (e não de comando explícito "use o X", identidade ou regras). Com intérprete cognitivo configurado, a mensagem completa segue para o modelo; sem ele, o comportamento anterior é mantido.
- **O modelo recebe o contrato real das ferramentas.** `CognitiveToolDescriptor` passa a expor `requiredArguments`, `optionalArguments` e `optionalNumberArguments`; o schema de decisão do Gemini declara essas propriedades (`decisionSchemaFor`).
- **Correção guiada em vez de desistência.** Ferramenta inexistente ou argumentos fora da política geram uma observação de correção para a próxima decisão, dentro do orçamento de 4 decisões. A correção nunca entra nas observações usadas para síntese.

## 4. Guardas preservadas

- Catálogo fechado de ferramentas e validação estrita de argumentos (`argumentsMatchPolicy`).
- Vínculo ao projeto ativo — agora aplicado só às ferramentas cuja política aceita `projectId` (antes, `github.listProjects` era sempre recusado com projeto ativo).
- Escrita no GitHub: somente LUMARKIS, somente branch `sebastian/`, proposta + autorização explícita a cada operação, sem merge, PR automático ou escrita na main.
- Classificador de autorização inalterado (frases explícitas).
- Ancoragem da síntese mantida; a comparação apenas ignora diferenças de espaço.

## 5. Fora do escopo

Troca de modelo, novas ferramentas, consulta ao Supabase, mudanças de interface, deploy e alterações no banco real.

## 6. Homologação automatizada

`tests/application/HomologationRegression20261111.integration.test.ts` reproduz as 16 mensagens com a composição de produção e o estado real do LUMARKIS, usando um modelo-oráculo que só pode enviar os argumentos anunciados no menu. O mesmo arquivo, executado contra o código anterior, reproduz as falhas observadas em produção; com esta SPEC, todos os cenários passam.

Os testes que exigiam `decide()` não chamado foram atualizados para o novo contrato: o modelo é consultado primeiro, dentro do orçamento de decisões; as verificações funcionais (ferramenta, evidência, resposta) foram mantidas.

## 7. Riscos conhecidos

- Mais chamadas ao modelo por pedido de GitHub (tipicamente `decide` + `decide` + `synthesize`), com maior latência e uso de cota do Gemini.
- O oráculo valida a arquitetura, não a competência do `flash-lite`; a homologação real em produção continua necessária.
