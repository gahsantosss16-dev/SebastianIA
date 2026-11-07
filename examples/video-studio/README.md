# Primeiro MP4 real — Issue #7

[Assistir / baixar o MP4](https://github.com/gahsantosss16-dev/SebastianIA/raw/refs/heads/feat/issue-7-real-mp4/examples/video-studio/pilot.mp4) · [Legendas SRT](pilot.srt) · [Roteiro](storyboard.json)

**Beto, o robô que serviu café para uma planta**: 30 segundos, vertical 9:16, H.264 720×1280 a 24 fps, voz eSpeak NG em português brasileiro, áudio AAC e legendas gravadas no vídeo. Cinco ilustrações originais com movimento de câmera, sem personagens ou músicas de terceiros. Custo externo: **US$ 0**, sem assinatura, API paga ou publicação automática.

Abra `pilot.mp4` em seu reprodutor ou `index.html` em um navegador junto ao arquivo. O link acima também permite baixar o MP4 pela branch da PR #8. O arquivo é um artefato piloto versionado; os vídeos gerados na aplicação permanecem protegidos pela autenticação existente.

## Evidências reais

- `verification.json`: download por HTTP autenticado, bloqueio sem credencial (401), áudio não silencioso em todas as cinco cenas, movimento de câmera medido sem incluir as legendas, imagens distintas, codecs, duração e decodificação completa pelo FFmpeg.
- `timing.json`: cada legenda corresponde ao seu próprio trecho WAV sintetizado. Os limites são calculados pela duração medida e pelo tempo aplicado; conferência matemática com tolerância de 2 ms antes da codificação AAC. Não é alinhamento fonético palavra a palavra.
- `browser-verification.json`: Chromium reproduziu até `ended`, decodificou áudio audível via Web Audio, conferiu resolução, duração e seek na rota autenticada. Nenhum erro de JavaScript/CSP.
- `studio-desktop.png`, `studio-mobile.png`: interface real com prévia e download, sessão autenticada, sem rolagem horizontal no celular.
- `pilot-poster.png`: quadro extraído do MP4 final. `probe.json`: inspeção ffprobe. `SHA256SUMS`: integridade dos arquivos principais.

A voz do eSpeak NG tem timbre robótico e não equivale a uma voz humana ou neural. Para melhorar sem serviço pago, pode-se gravar a própria narração ou avaliar Piper com um modelo pt-BR e licença adequada. Qualquer instalação adicional depende de autorização; nenhuma dessas alternativas foi instalada. A estética é uma ilustração simples com zoom, não animação cinematográfica de personagens.

## Reproduzir

Com FFmpeg, ffprobe, eSpeak NG e DejaVu Sans disponíveis no PATH:

```sh
npm run video:pilot
SEBASTIAN_VIDEO_E2E=1 npm test
```

No ambiente desta execução, o eSpeak NG foi instalado localmente por extração dos pacotes oficiais Debian, sem sudo. Prefixe os comandos com `PATH="/workspace/.tools/espeak-ng/bin:$PATH"`. A voz usada é `pt-br`, confirmada em `--voices=pt`. Nenhum binário do sintetizador foi incorporado ao repositório.

O piloto usa o servidor HTTP e o renderizador de produção, cria/aprova/acompanha o job e baixa o resultado com uma credencial temporária somente em memória. Os dados reais do assistente não são alterados. Veja o [runbook](../../docs/VIDEO_STUDIO_RUNBOOK.md).

A conferência de navegador é reproduzível por `node scripts/verify-video-browser.mjs` com Chromium e Playwright já instalados. Ela serve o MP4 real previamente gerado pelas rotas autenticadas de produção e compara seu SHA-256 ao arquivo entregue. Não exige outra geração e não instala nada. Se o Playwright estiver fora do projeto, informe o caminho do módulo em `SEBASTIAN_PLAYWRIGHT_MODULE`; o executável do Chromium pode ser indicado em `SEBASTIAN_CHROMIUM_PATH`.
