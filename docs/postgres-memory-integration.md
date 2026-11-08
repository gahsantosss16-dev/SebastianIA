# Driver PostgreSQL — integração e evidências

Base: `865b7e8`, branch `codex/sebastian-persistent-memory`.
Destino de desenvolvimento: `smtyixukyexezjumouvw`, conta Supabase **SebastianIA**.

## Composição entregue

`createMemoryStoreRuntime` seleciona `file` ou `supabase` por
`SEBASTIAN_STORE_DRIVER`. O HTTP e o CLI aguardam readiness antes de aceitar
trabalho e fecham o pool após as operações. Erros de configuração, conexão,
leitura e escrita não selecionam o arquivo como alternativa.

Core/bootstrap, registro de conversas, projetos/tarefas e conhecimento recebem
a mesma instância de `AsyncMemoryStore`. Os nomes dos adaptadores
`FileCommandContextHydrator` e `FileCommandResultMemoryWriter` foram mantidos
por compatibilidade; ambos já operam sobre a interface assíncrona.

As sessões web no perfil Supabase usam registros individuais em `web-sessions`:
armazenam digest, criação e expiração, nunca o cookie ou token bruto. Logout
persiste uma revogação (`expiresAt: 0`) da sessão correspondente. O mesmo token
privado de API deve permanecer configurado entre reinícios para preservar a
validação HMAC dos cookies. O driver file conserva o arquivo legado de sessões.

Duas correções necessárias à recuperação e ao isolamento:

- O replay das operações usa `updatedAt`, sem depender da ordem retornada pelo backend.
- A chave de escrita dos resultados inclui a conversa quando presente. Timestamps
  idênticos em conversas diferentes não sobrescrevem os registros. O payload mantém
  `executionId`; registros antigos continuam legíveis.

## Esquema aplicado

O banco foi inspecionado antes da alteração: schema `sebastian` ausente,
nenhuma tabela de aplicação e nenhuma migração registrada. Foi aplicada somente
`20261108172233_sebastian_memory`, por `apply_migration`, no projeto acima.
O arquivo inicial, ainda não aplicado, foi renomeado para o identificador
retornado pelo Supabase; não há duas migrações criando a mesma estrutura.

A migração cria `sebastian.memory_records`, com chave primária
`(namespace, record_key)`, JSON preservado como texto, validação de objeto JSON,
timestamps, RLS e revogação de acesso para `public`, `anon` e `authenticated`.
A chave primária já fornece o índice necessário. O papel sem login
`sebastian_runtime` recebe apenas `USAGE`, `SELECT`, `INSERT` e `UPDATE`, com
política explícita no schema privado. Uma identidade de conexão dedicada deve
receber esse papel por provisionamento seguro; nenhuma senha foi criada no
Supabase nesta execução.

Nenhum arquivo de memória existente foi importado. Nenhuma configuração de
produção, main, Hostinger, Video AI ou EDIT IA PRO foi alterada.

## Verificação real

O script reproduzível é `scripts/validate-postgres-memory.ts`, exposto como
`npm run test:postgres`. Ele usa namespaces sintéticos exclusivos e exige fase,
identificador e diretório de estado explícitos. A fase `write` encerra seu
processo; `read` inicia outro processo, sem reutilizar memória do anterior.
A fase `isolation` testa duas conversas com o mesmo comando/timestamp.

| Caminho | Evidência |
| --- | --- |
| `PostgresMemoryStore` → conector → PostgreSQL Supabase | SQL real de gravação, upsert e recuperação; o bridge transporta consultas/resultados, sem simular o banco |
| `pg.Pool` → PostgreSQL 17 temporário | Mesmas fases com login que herda somente `sebastian_runtime`; gravação e recuperação em processos separados |
| Entrada HTTP compilada → PostgreSQL temporário | Servidor reiniciado; sessão e conversa recuperadas; nenhum `memory.json` ou `web-session.json`; pool encerrado normalmente |
| CLI compilado → PostgreSQL temporário | `remember` e `recall` em processos diferentes, com recuperação do fato |

As verificações cobrem conversas e títulos, histórico completo, isolamento de
conversas/projetos, fatos permanentes, seleção de projeto e auditoria, recuperação
de uma tarefa sintética, fontes/chunks e busca de conhecimento, múltiplas sessões,
logout persistido, upserts concorrentes, chave repetida e rejeição real da
constraint de objeto JSON. O teste da tarefa não invoca um executor de alterações.

A suíte local cobre também conexão PostgreSQL recusada sem fallback, persistência
aguardada antes da confirmação, corrupção, falhas HTTP e fechamento assíncrono.
Typecheck, build e a suíte completa são executados antes do commit.

## Resultado registrado nesta execução

- `npm run typecheck`: aprovado.
- `npm run build`: aprovado.
- `npm test`: **1.012 aprovados**, zero falhas, cancelamentos ou testes ignorados (135,2 s).
- Supabase real: fases `write`, `read` e `isolation` aprovadas; 105 solicitações SQL
  respondidas pelo bridge, com erros reais de constraint propagados ao teste.
- PostgreSQL 17 local com `pg.Pool` e papel mínimo: três fases aprovadas, além
  da entrada HTTP compilada e de dois processos CLI independentes.
- O banco remoto mantém **20 registros sintéticos em 10 namespaces**, todos
  prefixados por `validation-20261108-pg-integration:`. Há zero registros nos
  namespaces operacionais. Uma das duas sessões sintéticas está revogada.
  Esses dados de validação foram mantidos para auditoria; não são memória do usuário.
- Verificação final de privilégios: RLS ativo; `anon` sem USAGE no schema;
  `authenticated` sem SELECT na tabela; `sebastian_runtime` com SELECT/INSERT/UPDATE
  e sem DELETE.

As definições dos projetos e suas políticas continuam vindo das fontes canônicas
configuradas. O banco persiste vínculo com a conversa, auditoria e estado das
tarefas; não substitui checkouts nem arquivos de políticas.

## Reproduzir com conexão direta de desenvolvimento

Configure em um ambiente seguro, sem registrar valores em Git ou logs:

- `SEBASTIAN_STORE_DRIVER=supabase` para o servidor/CLI.
- `SEBASTIAN_SUPABASE_DATABASE_URL`: URL do banco de desenvolvimento, usando login dedicado.
- `SEBASTIAN_SUPABASE_CA_FILE`: opcional, caminho para a CA confiável do projeto quando a cadeia não estiver no trust store do Node.

Conexões remotas exigem TLS com validação do certificado. Parâmetros da URL não
podem desabilitar essa validação. Há limites de conexão e execução de consulta.
O ambiente também precisa autorizar a rota TCP do host/porta escolhido.

Execute com um identificador novo:

```sh
npm run test:postgres -- --phase=write --run-id=validation-<id-unico> --state-dir=/tmp/sebastian-validation
npm run test:postgres -- --phase=read --run-id=validation-<id-unico> --state-dir=/tmp/sebastian-validation
npm run test:postgres -- --phase=isolation --run-id=validation-<id-unico> --state-dir=/tmp/sebastian-validation
```

No caminho do conector, `--sql-bridge-dir=<diretorio>` requer um operador que
execute cada request no projeto autorizado e devolva as linhas/erros reais.
Sem resposta do PostgreSQL, o teste falha por timeout. Essa ferramenta de
validação não é um transporte ou fallback do servidor.

## Limites e pendências reais

- A conexão direta **Node → Supabase** ainda depende de URL de desenvolvimento,
  login dedicado, CA quando necessária e rota TCP autorizada no executor. O
  ambiente desta execução não forneceu secret de banco nem autorização TCP para
  o host remoto. A conexão OAuth do conector não fornece essas credenciais ao Node.
  A prova SQL via conector e a prova de `pg.Pool` local são distintas; não se
  declara o servidor conectado operacionalmente ao Supabase por causa delas.
- As sessões expiradas/revogadas permanecem como registros inativos; limpeza de
  retenção requer manutenção administrativa separada. O runtime não tem DELETE.
- O advisor apontou permissões em `public.rls_auto_enable()` fora do schema desta
  integração. A migração não cria essa função nem altera suas permissões. Ver
  [anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
  e [authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- Cutover/importação de memória antiga e implantação não foram executados.
  O plano permanece em `docs/supabase-memory-migration.md`.
