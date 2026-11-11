# SPEC-053 — Estabilização: evidência aproveitada, menos chamadas, sem afirmações sem prova

## Evidência (produção 11/11/2026, `683a957`, `gemini-3.1-flash-lite`)
- A7/A10: o ciclo atingia 4 decisões com ferramentas bem-sucedidas e descartava a evidência.
- B1: a síntese separada levou 20 s (timeout) e a resposta virou a lista bruta.
- B3: a síntese citou um trecho ausente do documento; o arquivo bruto era devolvido.
- Observação de 2.000 caracteres insuficiente para resumir documentos.
- Proxy da Hostinger corta requisições em ~30 s.
- Testes: após uma ferramenta falhar, a conclusão do modelo era exibida sem validação (resumo inventado de arquivo não lido).

## Mudanças
1. **Conclusão ancorada direta**: a decisão final traz `evidence` (trechos literais). Se todos os trechos estiverem nas observações (`EvidenceGrounding`), a resposta é usada sem chamada de síntese; senão, a síntese é a segunda tentativa ancorada; por último, a evidência real, rotulada e limitada a 900 caracteres.
2. **Evidência nunca descartada**: ao esgotar o orçamento de decisões ou o prazo interno (18 s), o ciclo responde a partir das observações já obtidas.
3. **Prazo e síntese**: síntese limitada a 10 s; prazo interno de 18 s com evidência em mãos, abaixo do corte do proxy.
4. **Observações de até 6.000 caracteres**.
5. **Ferramenta falhou ⇒ só fatos das ferramentas**: se as ferramentas escolhidas pelo modelo falharam, a conclusão só é exibida se ancorada nas mensagens reais delas; caso contrário, a resposta reproduz essas mensagens.
6. **Tokens**: cada chamada registra `promptTokens`, `outputTokens`, `thoughtTokens`, `totalTokens` (`usageMetadata` do Gemini), apenas números.
7. **Projetos**: menção solta não resolvida não é seleção (só "use o X" com nome desconhecido é recusado); sem projetos cadastrados a camada de projetos não intercepta (CLI).
8. **Suíte**: as 10 falhas preexistentes foram resolvidas (4 por correção de código, 6 por fixtures desatualizadas frente a recursos homologados).

## Preservado
Gemini atual, catálogo fechado, validação de argumentos, escrita só no LUMARKIS em `sebastian/` com autorização explícita por operação.
