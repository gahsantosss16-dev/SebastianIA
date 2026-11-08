# Homologação segura — sebastian_app

Branch: `codex/sebastian-persistent-memory`, base `2ba9f04`.
Projeto de desenvolvimento: `smtyixukyexezjumouvw` (conta SebastianIA).

## Verificado nesta execução

- Projeto `ACTIVE_HEALTHY`.
- `sebastian_app`: LOGIN e INHERIT habilitados; sem superuser ou bypass de RLS.
- Herança efetiva de `sebastian_runtime`, USAGE no schema e SELECT/INSERT/UPDATE
  na tabela de memória. Sem DELETE.
- Existe exatamente um segredo chamado `sebastian_app_dev_password` no Vault.
  Somente existência/metadados foram consultados; a senha não foi lida nem exportada.
- O executor não tem secrets ou variáveis de runtime configuradas para o banco.
- O snapshot de rede não tem VPN nem destinos TCP autorizados. O teste Node de
  CONNECT para `db.smtyixukyexezjumouvw.supabase.co:5432`, pelo endpoint TCP
  `proxy:8088`, retornou `ECONNREFUSED` no proxy. Não alcançou o servidor remoto.

Portanto, a autenticação direta Node → Supabase e o TLS remoto **ainda não foram
comprovados**. A existência da senha no Vault e o acesso OAuth do conector não
configuram a autenticação PostgreSQL do processo Node.

## Configuração que falta e onde realizá-la

Configure no **ambiente/executor de homologação**, nas configurações de secrets,
variáveis de processo e rede — não em main, Hostinger ou produção.

| Configuração | Onde | Valor/conteúdo esperado |
| --- | --- | --- |
| `SEBASTIAN_SUPABASE_DATABASE_URL` | Secret do processo Node no executor | URL PostgreSQL completa do banco dev; usuário `sebastian_app`; senha obtida do segredo Vault por um operador autorizado, com codificação de URL; host `db.smtyixukyexezjumouvw.supabase.co`, porta `5432`, banco `postgres`, opção `sslmode=verify-full` |
| `SEBASTIAN_STORE_DRIVER` | Variável de runtime do executor | `supabase` |
| `SEBASTIAN_SUPABASE_CA_FILE` | Variável de runtime + certificado montado no executor, se a cadeia exigir CA própria | Caminho legível para a CA confiável fornecida pelo projeto Supabase. Não é a chave privada TLS. Nunca desabilitar a verificação do certificado |
| Rota TCP PostgreSQL | Configuração de rede/VPN e suporte do executor, ou firewall/saída de um host de homologação apropriado | Conectividade autorizada ao hostname acima na porta 5432; restaurar/prover o transporte TCP, atualmente recusado pelo proxy |
| `SEBASTIAN_API_TOKEN` | Secret estável do processo, **somente ao subir a aplicação HTTP completa** | Token privado exclusivo de homologação; não é a senha PostgreSQL e não é necessário ao comando de diagnóstico |

O secret deve ser disponibilizado ao processo como valor real, não como um
placeholder de credencial HTTP substituído apenas pelo proxy. Não envie senha,
URL completa ou saída do Vault no chat, em argumentos de comandos, Git ou logs.
O nome do segredo Vault, sozinho, não é um valor de conexão. Não conceda ao
`sebastian_app` acesso ao Vault para tentar resolver essa inicialização.

No Supabase, consulte **Connect → Direct connection** para os parâmetros e
[Database Settings → SSL Configuration](https://supabase.com/dashboard/project/smtyixukyexezjumouvw/database/settings)
para a CA. O endereço direto pode exigir IPv6. O diagnóstico também aceita
Session Pooler IPv4 com `SEBASTIAN_SUPABASE_CONNECTION_MODE=session-pooler`,
`SEBASTIAN_SUPABASE_SESSION_POOLER_HOST=aws-1-us-west-2.pooler.supabase.com`
confirmado pelo usuário no painel e login
`sebastian_app.smtyixukyexezjumouvw`, na porta 5432. Não deduz o hostname pela
região e não escolhe um fallback automaticamente. Consulte a
[verificação específica do Session Pooler](postgres-session-pooler.md).
Liberar um destino na lista HTTP não habilita raw TCP neste executor.
O [procedimento isolado](run-isolated-postgres-homologation.md) prepara a execução
em outro ambiente, usando senha em arquivo de secret e sem novas tentativas no
proxy atual.

O template [.env.homologation.example](../.env.homologation.example) não contém
credenciais. Prefira injeção pelo gerenciador de secrets. Se usar um arquivo
privado no host de homologação, mantenha-o fora do repositório, com permissão
0600, e carregue-o no processo sem imprimir seu conteúdo. O aplicativo não faz
fetch automático do Vault nem carrega arquivos `.env` por conta própria.

## Diagnóstico preparado

Com as variáveis já injetadas de forma segura:

```sh
npm run check:postgres:homologation
```

O comando é somente leitura. Ele valida destino e usuário antes de abrir a
conexão, usa o mesmo driver/configuração TLS da aplicação, verifica permissões
de memória, confirma `current_user` e consulta o TLS da própria conexão em
`pg_stat_ssl`. Aceita TLS 1.2/1.3. Nunca imprime URL, senha, CA, erros brutos ou
linhas de dados.

- Código de saída 0: conexão, identidade, TLS e readiness aprovados.
- Código de saída 2: configuração ausente ou inválida; nenhuma conexão aberta.
- Código de saída 1: falha de conexão/TLS/identidade/permissões/fechamento;
  somente um código de diagnóstico seguro é exibido.

Resultado atual, com o ambiente sem secret:

```json
{"status":"blocked","missing":["SEBASTIAN_SUPABASE_DATABASE_URL"]}
```

Depois de aprovar o diagnóstico, executar `test:postgres` nas fases `write`,
`read` e `isolation`, com identificador sintético novo, conforme
[integração PostgreSQL](postgres-memory-integration.md). O diagnóstico somente
leitura não substitui essa prova de escrita/recuperação com o novo login.

## Testes desta alteração

- `npm run typecheck` e `npm run build` aprovados.
- `npm test`: **1.016 aprovados**, zero falhas, cancelamentos ou ignorados (138,8 s).
- Quatro testes do diagnóstico aprovados: secret ausente, destino/usuário/porta
  incorretos, flags de downgrade SSL e CA ausente. A saída é verificada para não
  conter URL nem o marcador sintético de credencial.
- PostgreSQL 17 local temporário com certificado/credencial efêmeros: TLS com CA
  confiável aceito; identidade incorreta, texto claro e certificado não confiável
  rejeitados. Nenhuma credencial real do Supabase foi usada nesse teste local.
- Nenhuma migração, escrita remota de memória ou alteração de role foi executada.
  Produção, Hostinger e main permaneceram intactos.
