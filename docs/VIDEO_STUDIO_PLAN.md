# SebastianIA — Plano de integração do Estúdio de Vídeos

## Decisão de arquitetura
SebastianIA continua sendo assistente pessoal multifuncional. O Estúdio de Vídeos é uma capacidade adicional; não substitui core, memória, conversas, agentes ou API HTTP.

## Estado verificado
- O README está desatualizado (menciona SPEC-010), enquanto o repositório contém SPEC-049 e componentes de agentes, conversa, memória e HTTP.
- O arquivo video-studio/storyboard.ts é apenas um planejador determinístico; não renderiza vídeo.
- Nenhum MP4, pipeline audiovisual ou teste de ponta a ponta foi validado nesta branch.

## Sequência de execução
1. Mapear o contrato de capabilities/agents e a autenticação do servidor HTTP. Atualizar documentação sem reescrever o núcleo.
2. Integrar o planejador de roteiro como capability independente, com validação de entradas e testes.
3. Definir interfaces VideoProvider, SpeechProvider e AssetStore, com adaptadores opcionais. Nunca expor chaves no frontend.
4. Implementar fila de jobs com status, erros, cancelamento, limites de duração, orçamento máximo e idempotência.
5. Conectar um provedor audiovisual existente somente após confirmar créditos e custos. Sem cobrança ou geração paga automática.
6. Montar vídeo vertical MP4 com voz, legendas e trilha licenciada/original; exportar 9:16.
7. Criar UI simples: ideia -> roteiro -> aprovação -> geração -> prévia -> download.
8. Validar com um episódio piloto completo; só depois considerar publicação em plataformas.

## Critérios de aceite
- Assistente pessoal e comandos anteriores continuam funcionando; testes de regressão verdes.
- Uma ideia vira um job rastreável com cenas, voz e arquivo MP4 real.
- Falhas de provedor são visíveis; não há promessas de vídeo gerado sem artefato.
- Custos e créditos são apresentados antes de qualquer geração paga.
- Identidade e consistência dos personagens são tratadas por referências autorizadas.
- Não publicar automaticamente nem usar personagens/músicas protegidos sem direitos.

## Escopo deste commit
Apenas planejamento e storyboard. Não há integração de geração de vídeo nem deploy.
