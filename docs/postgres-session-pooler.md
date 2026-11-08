# Session Pooler IPv4 — SebastianIA

Base: `dbb7dfc`, branch `codex/sebastian-persistent-memory`.
Projeto: `smtyixukyexezjumouvw`, conta SebastianIA, região `us-west-2`.

**A conexão Node → Supabase ainda não foi estabelecida.** O teste do transporte
TCP do executor retornou `ECONNREFUSED` em `proxy:8088`, antes de alcançar um
servidor Supabase. Não é evidência de rejeição do usuário pelo pooler e não
permite concluir que trocar IPv6 por IPv4 resolverá esse bloqueio local.

## Compatibilidade e formato do usuário

A [documentação de conexão](https://supabase.com/docs/guides/database/connecting-to-postgres#pooler-session-mode)
indica Session Pooler compartilhado (Supavisor) em IPv4, porta **5432**, para
clientes persistentes. A porta 6543 corresponde ao transaction mode.

O [exemplo oficial com papel Prisma personalizado](https://supabase.com/docs/guides/database/prisma)
orienta substituir o usuário por `<DB-USER>.<PROJECT-REF>` e usar a senha daquele
papel, inclusive na URL de Session Pooler. Isso confirma suporte documentado a
papéis personalizados, sem pressupor autenticação efetiva neste projeto.
A recomendação de [papéis distintos por serviço](https://supabase.com/docs/guides/database/postgres/roles)
é compatível com manter `sebastian_app` restrito. As permissões de migração do
exemplo Prisma não são requisitos da aplicação e não foram copiadas.

| Componente | Configuração esperada |
| --- | --- |
| Usuário enviado ao pooler | `sebastian_app.smtyixukyexezjumouvw` |
| Papel real no PostgreSQL, após autenticação | `sebastian_app` |
| Senha | A senha desse papel, armazenada sob `sebastian_app_dev_password` no Vault |
| Host | Exatamente o hostname de **Connect → Session pooler** do projeto |
| Porta / banco | `5432` / `postgres` |
| TLS | Certificado e hostname validados; TLS 1.2/1.3; nunca `rejectUnauthorized=false` |

Não criar um papel PostgreSQL com o sufixo do projeto. O sufixo é usado no
roteamento do pooler. Não conservar o usuário `postgres.<project-ref>` da URL
padrão do painel nem utilizar sua senha administrativa.

## Evidências e limites

- LOGIN e INHERIT de `sebastian_app` estão habilitados, sem prazo de expiração.
- CONNECT no banco, USAGE no schema e SELECT/INSERT/UPDATE na memória confirmados.
- O papel herda `sebastian_runtime`, sem superuser/bypass de RLS e sem DELETE.
- O conector não fornece o endpoint do pooler; não há ferramenta de navegador
  disponível nesta execução para ler o painel. O hostname exato foi solicitado
  separadamente, sem pedir URL completa ou senha. A região não determina o
  prefixo do host; nenhum `aws-0`/`aws-1` foi assumido como endpoint deste projeto.
- O ambiente continua sem secret `SEBASTIAN_SUPABASE_DATABASE_URL`, sem variável
  do host do pooler, sem VPN/destino TCP configurado. O transporte TCP do proxy
  recusou conexão. Não houve handshake TLS ou autenticação no pooler.
- A função interna `pgbouncer.get_auth` existe, mas sua chamada foi negada ao
  papel do conector. Essa proteção não é um teste de login de `sebastian_app`.
  Não foi concedida permissão nem extraído hash/senha desse mecanismo.
- Não foi lida a senha do Vault. Nenhuma senha administrativa foi usada;
  nenhuma migração, alteração de role ou escrita remota de memória ocorreu.

## Preparação e próximo teste

Nas configurações seguras do **executor de homologação**:

1. Disponibilizar saída TCP autorizada para o endpoint real do pooler na porta
   5432. O administrador do executor deve restaurar/prover o transporte TCP;
   a lista HTTP sozinha não resolve. Alternativamente, executar o teste em um
   host de homologação com saída IPv4 autorizada.
2. Configurar `SEBASTIAN_SUPABASE_CONNECTION_MODE=session-pooler` e
   `SEBASTIAN_SUPABASE_SESSION_POOLER_HOST` com o hostname confirmado no painel.
3. Injetar `SEBASTIAN_SUPABASE_DATABASE_URL` como secret de processo, usando o
   login qualificado acima, a senha dedicada codificada como URL, o mesmo host,
   porta 5432, banco postgres e `sslmode=verify-full`. O Vault não injeta esse
   secret no Node automaticamente. Não passar o valor por chat ou argumentos.
4. Para a aplicação, manter `SEBASTIAN_STORE_DRIVER=supabase`. Se necessária CA
   própria, montar a CA confiável do endpoint e configurar
   `SEBASTIAN_SUPABASE_CA_FILE`. Não presumir que a CA do endpoint direto seja
   também a cadeia correta para o pooler; preservar verificação de hostname.
5. Executar `npm run check:postgres:homologation`. Ele verifica a configuração,
   usa o driver real e confirma `current_user = sebastian_app`, TLS e readiness,
   sem imprimir credenciais nem dados. As variáveis de modo/host restringem o
   diagnóstico; o driver da aplicação usa a URL explicitamente configurada.

Resultado atual no modo pooler, sem essas variáveis:

```json
{"status":"blocked","missing":["SEBASTIAN_SUPABASE_DATABASE_URL","SEBASTIAN_SUPABASE_SESSION_POOLER_HOST"]}
```

Após a conexão aprovada, executar as fases reais `write`, `read` e `isolation`
de `npm run test:postgres` com namespace sintético novo. Testes de formato de URL
não comprovam autenticação, e o conector SQL não substitui a conexão Node/pg.

## Se a autenticação dedicada falhar depois que a rede funcionar

- Conferir endpoint, projeto, porta 5432 e o sufixo exato no login. Um erro de
  tenant/usuário não comprova senha errada.
- Em falha de autenticação, conferir por meio seguro a correspondência entre
  a senha definida para `sebastian_app` e o secret Vault. A existência do secret
  não comprova essa correspondência. Não substituir pela senha administrativa.
- Se a configuração estiver correta e o Supavisor não resolver o papel, pedir
  ao suporte Supabase a verificação da descoberta/autenticação/cache do papel
  para esse projeto, com endpoint, horário e código de erro sem credenciais.
  Não alterar manualmente funções internas nem elevar o papel a bypass de RLS,
  superuser ou acesso ao Vault para tentar fazê-lo conectar.
- Alternativa segura: conectar diretamente como `sebastian_app` em um executor
  de homologação com IPv6 e saída TCP para `db.smtyixukyexezjumouvw.supabase.co:5432`,
  mantendo TLS validado e os mesmos privilégios mínimos. Produção, Hostinger e
  main não precisam ser alterados.

## Validação da alteração

- `npm run typecheck` e `npm run build`: aprovados.
- `npm test`: **1.020 aprovados**, zero falhas, cancelamentos ou ignorados (144,4 s).
- Regressões do diagnóstico cobrem host explicitamente configurado, login
  qualificado, rejeição de administrador/usuário sem sufixo/outro projeto,
  porta 6543, hostname divergente, downgrade TLS e ausência de fallback.
- Os testes de configuração param antes da rede (por exemplo, com CA de teste
  inexistente). Não simulam nem comprovam autenticação no pooler.
- Teste vivo do transporte do executor: `ECONNREFUSED` em `proxy:8088`.
  Nenhuma credencial foi enviada e nenhum handshake remoto foi realizado.
