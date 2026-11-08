# Migração segura da memória para PostgreSQL

Esta etapa não executa migração em produção. Faça uma janela controlada: pare
as gravações, copie `memory.json` e `web-session.json` para backup imutável,
valide ambos com `JSON.parse`, importe, compare contagens por namespace e só
então habilite `SEBASTIAN_STORE_DRIVER=supabase`.

O importador deve usar a chave natural `(namespace, record_key)` e `INSERT ..
ON CONFLICT .. UPDATE`; portanto pode ser reexecutado sem duplicar registros.
Registros gravados depois do corte não podem ser recuperados apenas trocando o
driver de volta: para rollback, congele escritas, exporte as linhas novas do
banco, reconcilie-as no arquivo por chave e valide contagens antes de reabrir.

Nunca coloque `SEBASTIAN_SUPABASE_DATABASE_URL` no cliente, em Git ou em logs.
O banco é acessado exclusivamente pelo processo Node com credencial de mínimo
privilégio para o schema privado `sebastian`.
