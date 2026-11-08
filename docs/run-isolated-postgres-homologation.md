# Homologação PostgreSQL em outro ambiente

Projeto dev `smtyixukyexezjumouvw`, branch `codex/sebastian-persistent-memory`.

| Parâmetro confirmado pelo usuário no painel | Valor |
| --- | --- |
| Session Pooler IPv4 | `aws-1-us-west-2.pooler.supabase.com` |
| Porta / banco | `5432` / `postgres` |
| Login no pooler | `sebastian_app.smtyixukyexezjumouvw` |
| Papel real no banco | `sebastian_app` |
| Origem da senha técnica | Vault: `sebastian_app_dev_password` |

A conexão remota ainda não foi comprovada. Não houve novas tentativas pelo
proxy desta conversa, anteriormente recusado. O hostname está confirmado;
a rota TCP e a entrega do secret ao processo continuam pendentes neste executor.

## 1. Preparar outro executor

Usar VM/job Linux isolado, fora de produção e Hostinger, com Docker atual e
usuário não-root com acesso ao Docker. O administrador deve autorizar DNS e
saída TCP da rede do job/contêiner para o hostname acima, porta 5432. HTTPS
permitido não habilita PostgreSQL. Não substituir o hostname por IP na URL:
preservar SNI e validação de certificado.

Os comandos com rede são para esse **outro ambiente autorizado**, não para
contornar o proxy atual. Não usar host networking, outro proxy ou túnel sem
autorização para tentar contornar a restrição.

Em um checkout separado:

```bash
set +x
set -euo pipefail
umask 077
test "$(id -u)" -ne 0

git clone --single-branch --branch codex/sebastian-persistent-memory \
  https://github.com/gahsantosss16-dev/SebastianIA.git SebastianIA-homologation
cd SebastianIA-homologation
git rev-parse HEAD

docker build -f Dockerfile.homologation -t sebastiania-pg-homologation:dev .
docker network create sebastian-homologation
```

A rede Docker não concede autorização de saída por si só; as regras do executor
precisam estar aplicadas. O build requer acesso autorizado ao registro de imagens
e npm. Se o proxy HTTPS de build exigir CA própria, acrescentar
`--secret id=proxy_ca,src=/caminho/ca-do-proxy.crt` ao build. Essa CA é usada
somente no passo de instalação e não é copiada para a imagem. Não fornecer a
senha do banco durante o build.

A imagem seleciona somente os scripts de diagnóstico e seus dois módulos de
memória, além de package/lockfile e tsconfig. O dockerignore específico usa uma
lista de inclusão. `.env`, `.git`, dados locais e credenciais não entram na
imagem. Ela não contém a aplicação HTTP/CLI e não publica portas.

## 2. Fornecer o secret ao job

Um operador autorizado deve sincronizar a senha **de `sebastian_app`**, armazenada
no Vault, com o gerenciador de secrets desse job. O gerenciador deve materializar
um arquivo fora do checkout, legível pelo UID do executor, com modo **0400 ou
0600**, sem permissões de grupo/outros. Não escrever a senha em scripts, Git,
argumentos, histórico ou logs. Não usar a senha administrativa.

Configurar somente o caminho, sem credencial:

```bash
export SEBASTIAN_PASSWORD_FILE_HOST=/run/secrets/sebastian_app_dev_password
```

O arquivo contém só a senha; um único LF/CRLF final é aceito. O runner codifica
caracteres reservados e monta a URL exclusivamente em memória. Sobrescreve uma
URL anterior e remove `PGPASSWORD` do ambiente filho para impedir fallback
administrativo. Não consulta o Vault em runtime nem concede acesso ao Vault ao
usuário técnico.

Se a cadeia do pooler exigir CA própria, montar a CA confiável do endpoint:

```bash
export SEBASTIAN_CA_FILE_HOST=/run/secrets/ca-confiavel-do-pooler.crt
```

Sem essa variável, usa o trust store do Node. Não presumir que a CA do endpoint
direto seja a cadeia correta do pooler. Não desabilitar a validação TLS ou de
hostname.

## 3. Preparar sem rede e executar uma vez na rede autorizada

Em Bash, definir:

```bash
run_homologation() {
  local network="$1"
  shift
  local ca_args=()
  if [[ -n "${SEBASTIAN_CA_FILE_HOST:-}" ]]; then
    ca_args+=(
      --mount "type=bind,src=${SEBASTIAN_CA_FILE_HOST},dst=/run/secrets/pooler-ca.crt,readonly"
      -e SEBASTIAN_SUPABASE_CA_FILE=/run/secrets/pooler-ca.crt
    )
  fi
  docker run --rm --network "$network" \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
    --user "$(id -u):$(id -g)" \
    --cap-drop ALL --security-opt no-new-privileges \
    --pids-limit 128 --memory 512m --cpus 1 --log-driver none \
    --mount "type=bind,src=${SEBASTIAN_PASSWORD_FILE_HOST:?},dst=/run/secrets/sebastian_app_dev_password,readonly" \
    -e SEBASTIAN_SUPABASE_PASSWORD_FILE=/run/secrets/sebastian_app_dev_password \
    "${ca_args[@]}" \
    sebastiania-pg-homologation:dev "$@"
}

run_homologation none --prepare-only
```

Esperado na preparação offline:

```json
{"status":"prepared","endpointConfirmed":true,"secretLoaded":true,"tlsRequired":true,"connectionAttempted":false}
```

Isso não autentica nem valida a senha no banco. O runner recusa arquivo sem
proteção, host divergente e `NODE_TLS_REJECT_UNAUTHORIZED=0`, usando erros fixos
sem conteúdo secreto. Corrigir eventual erro de preparação antes de abrir rede.

Somente após preparação aprovada e saída TCP autorizada no outro executor:

```bash
run_homologation sebastian-homologation
```

O runner chama internamente **`npm run check:postgres:homologation`**. No processo
filho ele injeta `session-pooler`, host confirmado e URL montada em memória.
O driver exige TLS com validação de certificado e hostname. A consulta confirma
`current_user = sebastian_app`, TLS do backend e permissões do schema.
O TLS Node → pooler é validado pelo driver; `pg_stat_ssl` no banco descreve a
conexão do pooler ao backend. Não faz migrações nem gravações de memória.

O processo tem limite de tempo. Apenas JSON do diagnóstico é retornado; não
repassa stdout/stderr bruto do npm, URL ou senha. O contêiner é removido ao
terminar; o filesystem é somente leitura, exceto `/tmp` efêmero. O secret deve
ser desmontado/revogado pelo gerenciador quando o job terminar.

Sem Docker, em um job Linux isolado com Node 24 e dependências instaladas pelo
lockfile, também é possível injetar `SEBASTIAN_SUPABASE_PASSWORD_FILE` e executar
`npm run run:postgres:homologation -- --prepare-only`, seguido de
`npm run run:postgres:homologation` somente na rota autorizada.

## 4. Interpretar e registrar o resultado

Aprovação exige exit code **0** e:

```json
{"status":"passed","mode":"session-pooler","identityVerified":true,"tlsVerified":true,"schemaReady":true,"writesPerformed":false}
```

- `prepared`: apenas preparação offline, sem comprovação de conexão.
- `blocked`, exit 2: secret/configuração ausente ou insegura. Corrigir montagem,
  permissões ou destino, sem publicar o conteúdo.
- `failed`, exit 1: conexão/TLS/identidade/permissões não aprovados. Falha de rede
  não demonstra rejeição do papel. Falha TLS exige conferir CA/hostname, nunca
  desabilitar verificação. `28P01` indica rejeição de autenticação: conferir por
  meio seguro a correspondência entre a senha do papel e o secret.

Não repetir falhas automaticamente. Registrar só JSON seguro, código de saída e
revisão do código. Persistindo um erro de tenant/usuário com configuração correta,
pedir suporte Supabase sobre Supavisor, sem elevar o papel nem usar administrador.
Após aprovação, uma etapa separada pode testar gravação/recuperação em namespaces
sintéticos. Este procedimento de leitura não declara memória operacional.

A alternativa ao pooler é usar `sebastian_app` diretamente em host com IPv6 e
saída TCP autorizada para o endpoint direto, mantendo TLS validado. Produção,
Hostinger e main não precisam ser alterados.


## Validação desta preparação

- `npm run typecheck` e `npm run build`: aprovados.
- `npm test`: **1.025 aprovados**, zero falhas, cancelamentos ou ignorados (143,9 s).
- Imagem final construída e executada sem rede como usuário não-root, com
  filesystem somente leitura e secret sintético montado: preparação aprovada.
- Inventário da imagem verificado: somente os três scripts e dois módulos de
  memória selecionados; sem `.env`, `.git` ou aplicação HTTP/CLI.
- A chamada interna real a `npm run check:postgres:homologation` foi exercitada
  no contêiner sem rede, usando CA inexistente para provocar uma falha anterior
  à conexão. O runner propagou exit 1 e somente JSON seguro, como esperado.
- Credenciais sintéticas temporárias foram removidas. A senha do Vault não foi
  lida, nenhuma senha administrativa foi utilizada e não houve tentativa de
  conexão pelo proxy PostgreSQL atual ou pelo pooler remoto.

`prepared` nos testes offline não equivale a `passed` do diagnóstico remoto.
O resultado Node → Session Pooler continua pendente da execução no outro
ambiente com saída TCP autorizada e secret técnico real.
