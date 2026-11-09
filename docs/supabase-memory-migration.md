# Migração segura da memória para PostgreSQL

Implementação: `core/memory/FileToPostgresMemoryMigration.ts`, acionada em `application/http.ts`.

- **Driver `file` com `SEBASTIAN_SUPABASE_DATABASE_URL` definido:** depois que o servidor já está
  atendendo, um preflight em segundo plano valida login, TLS do cliente, gravação e leitura num
  namespace `validation-hostinger-preflight:*` e executa um `dry-run` da migração. Uma falha só é
  registrada no log e não afeta a disponibilidade.
- **Driver `supabase` com `SEBASTIAN_MEMORY_MIGRATION=copy`:** antes de atender, copia o retrato
  final de `memory.json`. Primeiro grava um backup imutável `memory.backup-<data>-<id>.json`
  (nunca sobrescreve outro arquivo) e confere que ele é idêntico byte a byte. Depois insere só as
  chaves ausentes, pela chave natural `(namespace, record_key)`, com `ON CONFLICT DO NOTHING`, e
  relê cada registro inserido para comparar com o arquivo. Linhas já existentes e diferentes nunca
  são sobrescritas: são contadas como `conflicts`. Se a verificação falhar, o servidor não inicia
  (fail closed).
- `memory.json` nunca é modificado. Rodar de novo não duplica nada. Os relatórios mostram apenas
  nomes de namespace e contagens.
- `web-session.json` (sessões de login) não é migrado: depois da ativação, é preciso entrar de novo.

Reversão: voltar `SEBASTIAN_STORE_DRIVER=file` restaura o comportamento anterior com o
`memory.json` intacto. O que foi gravado depois da ativação fica só no banco; para levar esses
registros de volta ao arquivo, congele as gravações e reconcilie por chave antes de reabrir.

Nunca coloque credenciais em Git ou em logs. A senha vai em `PGPASSWORD`, fora da URL.
