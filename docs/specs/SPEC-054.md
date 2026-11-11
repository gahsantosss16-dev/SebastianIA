# SPEC-054 — Estabilidade: chamadas de reforço ao Gemini e investigações de vários passos

## Evidência (produção `14c85ea`, logs Node da Hostinger)
- 42 decisões: 30 respondidas (p50 2,2 s · p90 5,4 s · máx 6,9 s) e 12 cortadas em 8 s (29%); 7 de 8 novas tentativas ocorreram na primeira decisão do pedido; metade das novas tentativas também travou.
- Sem tokens de raciocínio ocultos (`totalTokens = promptTokens + outputTokens`); prompt p50 2.731 tokens. A latência é bimodal (resposta rápida ou travamento), não proporcional ao tamanho.
- A7/A10: com 4 decisões o modelo concluía pelo nome dos arquivos de workflow.

## Mudanças
1. **Chamada de reforço (hedging)** em toda chamada ao Gemini: se não houver resposta em 4 s e restarem ≥ 2,5 s do limite, uma cópia é enviada; vale o primeiro resultado gerado e a outra é cancelada. Se nenhuma gerar, o resultado da chamada original é devolvido (sem mascarar timeout/erro). Tokens extras só nas chamadas lentas.
2. **Orçamento de 6 decisões** (era 4), ainda limitado pelo prazo de 20 s por pedido.
3. **Instrução**: não concluir pelo nome do arquivo; quando uma listagem trouxer vários candidatos relevantes, ler cada um antes de concluir, ou dizer quais foram lidos.

4. **Arquivos lidos declarados**: depois de uma listagem, a resposta termina com "Arquivos lidos nesta consulta: …", gerado das chamadas reais de ferramenta; e o modelo não pode atribuir um comportamento ao projeto inteiro sem ter lido todos os candidatos (A7 respondeu a partir de 2 de 8 workflows).

## Preservado
Gemini `gemini-3.1-flash-lite`, guardas de escrita, autorização explícita, memória no Supabase, prazos e ancoragem da SPEC-053.
