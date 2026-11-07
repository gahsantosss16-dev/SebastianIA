# Estúdio local: execução da Issue #7

O SebastianIA continua um assistente pessoal. Nenhum arquivo em `core/` foi alterado. A aplicação registra `cap.video.storyboard` e o endpoint usa o Gateway, Registry e BundleBuilder existentes. A lista de comandos do núcleo permanece intacta.

## Requisitos do servidor

- Node e dependências já usados pelo projeto.
- FFmpeg com libx264, AAC, subtitles/libass, zoompan; ffprobe.
- eSpeak NG com voz `pt-br` e fonte DejaVu Sans.

Não há SDK novo, chamada de rede no renderizador, chave no cliente, assinatura ou fallback pago. O custo **externo** estimado é US$ 0. CPU, armazenamento e energia da infraestrutura existente continuam sendo consumidos. Instalar esses binários em outro servidor exige autorização do responsável.

## Executar

```sh
npm run typecheck
npm run build
npm test
npm run video:pilot
```

`video:pilot` inicia um servidor temporário, cria um roteiro pela API autenticada, confirma US$ 0, aprova, acompanha os cinco estágios e baixa MP4 e SRT pelo endpoint real. Verifica H.264 720×1280, áudio AAC não silencioso e decodificação integral. Não usa o provider cognitivo nem APIs pagas. Os resultados ficam em `examples/video-studio/`. A credencial temporária fica somente em memória.

No servidor normal, `npm run start:online` mantém o comportamento anterior e habilita `/studio`. Entre no assistente e use o link **Estúdio de vídeos**. A sessão HttpOnly existente autentica prévia, status e download. É necessário aprovar o roteiro antes de gerar. Não há publicação em redes sociais.

## API

Todas as rotas `/api/video/jobs` exigem `Authorization: Bearer …` ou sessão web válida. Operações com cookie que alteram estado também exigem mesma origem. Nunca coloque a credencial em URL.

| Método | Rota | Resultado |
| --- | --- | --- |
| POST | `/api/video/jobs` | `{idea, durationSeconds?}` → roteiro, custo e ID; sem renderização |
| GET | `/api/video/jobs` | Lista de jobs persistidos |
| GET | `/api/video/jobs/:id` | Status, cena, erro ou URLs autenticadas |
| POST | `/api/video/jobs/:id/render` | `{approved:true}` → fila local; reenvio não duplica geração |
| GET | `/api/video/jobs/:id/video.mp4` | Prévia com HTTP Range; `?download=1` baixa o arquivo |
| GET | `/api/video/jobs/:id/captions.srt` | Legendas para download |

Estados: `awaiting_approval → queued → rendering → completed | failed`. Arquivos só ficam disponíveis depois da verificação por ffprobe e renomeação final. Falhas não resultam em URLs de download. Jobs interrompidos por reinício são marcados como falha, sem geração automática. Há um render por vez, no máximo três jobs ativos e cem registros por diretório. O piloto não modifica os dados reais do assistente.

Os jobs ficam em `<diretório de dados existente>/video-studio/<uuid>/`. Para liberar o limite, com o processo parado, arquive diretórios completos e reinicie. Os intermediários são preservados para diagnóstico. O diretório deve ser gravável pelo usuário do processo. Nenhum caminho de arquivo recebido do cliente é aceito.

## Limites honestos desta entrega

É uma animação ilustrada original, com movimento de câmera, cinco cenas, legendas gravadas no vídeo e narração sintética portuguesa do eSpeak NG. Não é animação cinematográfica ou voz neural. A história usa um modelo de comédia fixo com Beto, Lia e a planta; a ideia muda a abertura. A interface informa essa limitação. Não promete produzir qualquer roteiro arbitrário nem imitar personagens protegidos.

Duração inteira de 15 a 60 segundos; ideia de 1 a 240 caracteres. Narração é sintetizada por cena e acelerada apenas dentro de um limite; textos longos para a duração escolhida falham de forma visível. Cada bloco de legenda é sintetizado como um trecho WAV próprio; seus limites usam a duração medida e o tempo aplicado. Não há alinhamento fonético palavra a palavra. Sem trilha de terceiros.

Em servidor sem os binários locais, o assistente continua funcionando e a geração retorna um erro explícito. Esta branch não instala nada na Hostinger e não faz merge/deploy. O MP4 piloto e as evidências devem ser revisados antes de homologação e eventual publicação. A PR #6 foi usada como base, preservando seu histórico.

## Execução validada em 7 de novembro de 2026

O usuário autorizou explicitamente o eSpeak NG gratuito. Foi instalado por extração local dos pacotes Debian oficiais em `/workspace/.tools/espeak-ng`, com suas bibliotecas obrigatórias libespeak-ng, libpcaudio e libsonic. O wrapper `bin/espeak-ng` aponta as bibliotecas e os dados de voz locais; `--voices=pt` confirmou `Portuguese_(Brazil)`, selecionado pelo renderizador com `-v pt-br`. Nenhuma instalação global, assinatura ou gasto.

Para reproduzir **neste ambiente**:

```sh
PATH="/workspace/.tools/espeak-ng/bin:$PATH" npm run video:pilot
PATH="/workspace/.tools/espeak-ng/bin:$PATH" SEBASTIAN_VIDEO_E2E=1 npm test
```

Para usar o servidor normal com essa instalação local, aplique o mesmo prefixo ao comando de inicialização existente. Outros ambientes precisam disponibilizar os binários documentados; este trabalho não os instala automaticamente na hospedagem.

O piloto e as evidências estão em [examples/video-studio](../examples/video-studio/README.md). A validação detectou e corrigiu o zoom que reiniciava por quadro; o movimento agora usa o contador de quadros de saída. A reprodução real no Chromium confirmou áudio, seek e finalização. O eSpeak tem timbre robótico; alternativas gratuitas propostas, sem instalação, são narração própria ou Piper com um modelo pt-BR de licença adequada. Preservados todos os arquivos de `core/`, o assistente pessoal e os contratos de produção anteriores. Sem merge na main.
