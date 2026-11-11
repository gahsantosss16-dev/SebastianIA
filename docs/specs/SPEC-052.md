# SPEC-052 — Correções da homologação real da SPEC-051

## 1. Status

Implementada; publicação e homologação real registradas no relatório da sessão. Não homologada até aprovação.

## 2. Evidência (produção, 11/11/2026, `b845449`, Gemini `gemini-3.1-flash-lite`)

1. **Resposta inventada após 429** (A9): `decide` recebeu HTTP 429, o fluxo caiu na conversa sem ferramentas e o modelo afirmou que a última alteração "foi feita por mim, Sebastian".
2. **Argumentos misturados** (A5–A7, A10, B3): com o schema único de argumentos, o modelo enviava a `github.readFile`/`listTree` os campos `content`/`message`/`branch` de `upsertFile`; cada passo gastava uma decisão extra e tarefas de vários passos estouravam o orçamento.
3. **Reserva substituindo o modelo** (C2): uma conclusão do modelo sem ferramenta foi trocada pela rota determinística de leitura de arquivo num pedido de escrita.
4. **Resumo de documento longo** (B3): síntese rejeitada como não ancorada; o arquivo bruto foi devolvido.
5. **Confirmação enganosa**: "cancela" sem proposta pendente respondeu "Cancelado"; "sim, pode executar" não autorizava.

## 3. Correções

1. Com projeto ativo, sem fatos memorizados relevantes, e o motor de ferramentas indisponível (429/timeout), a resposta é uma limitação explícita; a conversa sem ferramentas não é consultada.
2. O schema de decisão do Gemini traz `toolArgumentsByTool`: um objeto por ferramenta, com seus próprios campos e obrigatórios. Só a entrada da ferramenta escolhida vira `toolArguments`; as demais são descartadas. A tentativa estreitada (SPEC-051) permanece.
3. A rota determinística nunca substitui a resposta do modelo: numa conclusão sem evidência ela só acrescenta uma observação e o modelo decide de novo; numa decisão bloqueada só é usada se for da mesma ferramenta que o modelo escolheu. Com o modelo indisponível, continua como reserva baseada em evidência.
4. A ancoragem continua exigindo as palavras observadas, na ordem; ignora apenas maiúsculas, espaços, marcadores Markdown e aspas tipográficas, e recusa trechos com menos de 3 caracteres. Rejeições registram o motivo estrutural (sem conteúdo).
5. Sem proposta pendente, "cancela"/"pode executar" respondem que nada foi cancelado/executado. Respostas curtas formadas só por palavras afirmativas ("sim, pode executar", "ok, autorizo") autorizam; qualquer instrução extra ou negação não autoriza.

## 4. Preservado

Gemini atual, catálogo fechado, validação de argumentos, vínculo ao projeto ativo, escrita só no LUMARKIS em branch `sebastian/` com autorização explícita por operação, sem merge/PR automático.
