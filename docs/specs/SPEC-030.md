# SPEC-030 - Local Command-Line Invocation Adapter

## 1. Contexto

A SPEC-029 criou o composition root local e tornou o entrypoint capaz de construir um `SebastianCore` operacional com a capability concreta `greeting`.

O processo iniciado por `npm start`, entretanto, apenas constroi o runtime e termina. Ainda nao existe uma fronteira local que receba uma intencao do usuario, converta-a para `CommandProcessingInput`, execute o Core homologado e apresente o resultado.

---

## 2. Objetivo

Implementar o primeiro adaptador operacional de entrada da aplicacao: uma interface de linha de comando local e deterministica para executar `greeting` pelo pipeline real.

---

## 3. Escopo

Esta SPEC inclui:

- contrato de argumentos `greeting [name]`;
- adaptacao dos argumentos para `CommandProcessingInput`;
- geracao de `generatedAt` no limite da invocacao;
- execucao por uma instancia criada pelo composition root da SPEC-029;
- serializacao JSON do `CapabilityResult` em stdout;
- serializacao de falhas em stderr;
- codigo de saida `0` para sucesso e `1` para falha;
- atualizacao dos scripts `start` e `dev` para o entrypoint operacional local;
- dependencias substituiveis de relogio e runtime somente para testes deterministas.

---

## 4. Fora do Escopo

Esta SPEC nao inclui:

- novos command types ou capabilities;
- alteracoes no composition root, Core, pipeline ou lifecycle;
- prompt interativo, REPL ou interface grafica;
- parsing generico de comandos;
- persistencia ou historico;
- UI web, Supabase, banco, rede, IA, LLM, memoria, RAG ou integracoes externas;
- alteracoes de ROADMAP;
- definicao da SPEC-031.

---

## 5. Responsabilidade Arquitetural

### 5.1 Adaptador de Invocacao Local

E responsavel por:

- validar argumentos recebidos do processo;
- converter argumentos validos para o contrato publico do Core;
- criar o runtime exclusivamente pelo composition root homologado;
- executar exatamente um comando;
- converter resultado ou falha para o contrato do processo.

Nao e responsavel por:

- compor providers ou bindings;
- processar comandos internamente;
- resolver ou executar capabilities diretamente;
- modificar lifecycle;
- aplicar fallback quando o runtime falhar.

---

## 6. Contrato de Entrada

Sintaxe suportada:

`sebastiania greeting [name]`

Regras:

- o primeiro argumento deve ser exatamente `greeting`;
- o segundo argumento e opcional e representa `input.name`;
- argumentos adicionais sao rejeitados;
- ausencia do command type e rejeitada;
- o adaptador nao inventa outro command type como fallback.

---

## 7. Contrato de Saida

Sucesso:

- executa uma unica vez `SebastianCore.executeCommand`;
- escreve uma linha JSON com o `CapabilityResult` em stdout;
- nao escreve em stderr;
- retorna exit code `0`.

Falha:

- escreve uma linha JSON em stderr contendo, no minimo, `name` e `message`;
- inclui `code` quando a falha expuser codigo tipado;
- nao escreve resultado em stdout;
- retorna exit code `1`.

---

## 8. Fluxo Operacional

1. Entry point recebe `process.argv` sem os argumentos do executavel e script.
2. Adaptador valida `greeting [name]`.
3. Adaptador cria `CommandProcessingInput` com timestamp do relogio local.
4. Composition root cria o Core operacional.
5. Adaptador chama `executeCommand` uma unica vez.
6. Resultado e serializado em stdout.
7. O processo recebe codigo de saida coerente.

---

## 9. Tratamento de Erros

- argumentos invalidos devem produzir erro tipado do adaptador local;
- falhas do composition root, bootstrap, Core ou pipeline devem manter sua identidade ao atravessar o runner;
- o limite executavel pode serializar a falha, mas nao converte falha em sucesso;
- valores lancados que nao sejam `Error` devem ser normalizados para uma mensagem segura;
- proibido criar Core sem pipeline como fallback.

---

## 10. Invariantes

- uma invocacao executa no maximo um comando;
- argumentos invalidos impedem a criacao do runtime;
- o runtime e criado somente pelo composition root da SPEC-029;
- o input adaptado nao e mutado;
- o relogio e consultado exatamente uma vez por comando valido;
- mesma entrada e mesmo relogio produzem resultado equivalente;
- stdout e stderr nao se misturam.

---

## 11. Criterios de Aceitacao

A implementacao sera adequada quando:

- `npm start -- greeting Gabriel` executar o pipeline local real;
- a saudacao nominal for emitida como JSON;
- saudacao sem nome continuar suportada;
- argumentos invalidos falharem antes da criacao do runtime;
- falhas operacionais resultarem em stderr e exit code `1`;
- o adaptador reutilizar integralmente a SPEC-029;
- nenhum comportamento homologado for modificado.

---

## 12. Estrategia de Testes

Testes permanentes devem cobrir:

- adaptacao de `greeting` sem nome;
- adaptacao de `greeting` com nome;
- rejeicao de comando ausente;
- rejeicao de command type desconhecido;
- rejeicao de argumentos excedentes;
- relogio consultado uma unica vez;
- runtime nao criado para argumentos invalidos;
- execucao unica no caminho nominal;
- stdout JSON e exit code `0` em sucesso;
- stderr JSON e exit code `1` em falha;
- normalizacao de throwable nao-Error;
- determinismo com relogio fixo;
- compatibilidade com o composition root real.

---

## 13. Riscos e Mitigacoes

Riscos:

- duplicar logica do Core no adaptador;
- acoplar o pipeline a argumentos de processo;
- misturar logs operacionais com o JSON de saida;
- iniciar runtime para entrada invalida.

Mitigacoes:

- limitar o adaptador a validacao, traducao e delegacao;
- manter o contrato de processo fora do Core;
- usar logger silencioso no runtime da CLI;
- validar argumentos antes do composition root.

---

## 14. Criterios de Homologacao

A SPEC-030 sera homologada quando:

- o adaptador e o entrypoint local estiverem implementados;
- os testes permanentes da SPEC-030 passarem;
- `npm test` passar;
- `npm run build` passar;
- `npm run typecheck` passar;
- as SPECs anteriores permanecerem aderentes aos seus contratos.

---

## 15. Justificativa da Sequencia

A SPEC-029 tornou o runtime concreto. A responsabilidade imediatamente seguinte e permitir uma invocacao externa local desse runtime. A linha de comando e a menor fronteira operacional real possivel, nao exige infraestrutura externa e utiliza o caminho homologado completo sem criar nova camada de dominio.

---

## Status

Implementada e homologada
