# Evidências da Issue #7

- `studio-desktop.png`, `studio-mobile.png`: interface real em Chromium; sessão autenticada, roteiro e aprovação de US$ 0, sem erros de JavaScript ou CSP e sem rolagem horizontal no celular.
- O piloto audiovisual é reproduzível com `npm run video:pilot` após disponibilizar os binários documentados no [runbook](../../docs/VIDEO_STUDIO_RUNBOOK.md).

**Pendência nesta revisão:** o eSpeak NG não está instalado no ambiente. A autorização para instalar essa dependência gratuita foi solicitada conforme `CLAUDE.md`. Não há MP4 validado nesta revisão; screenshots não substituem o critério de aceite da Issue #7.

O teste audiovisual opt-in é `SEBASTIAN_VIDEO_E2E=1 node --import tsx --test tests/studio/LocalVideoRenderer.integration.test.ts`. Ele gera o MP4 por HTTP autenticado, verifica áudio não silencioso, codecs, resolução, duração, SRT e decodificação completa. Deve ser executado após a instalação autorizada; não exige API paga.
