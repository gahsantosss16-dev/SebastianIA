# CLAUDE.md — SebastianIA

## 1. Custos e Infraestrutura

O SebastianIA deve priorizar evitar novos gastos.

Custos já contratados e inevitáveis de infraestrutura podem ser utilizados, mas qualquer novo serviço pago, API paga, modelo pago, assinatura, infraestrutura adicional ou custo recorrente deve ser tratado como exceção.

Antes de introduzir novo custo, parar, justificar tecnicamente e solicitar autorização explícita.

Sempre priorizar reutilizar infraestrutura, serviços e recursos já disponíveis.

## 2. Deploy

O deploy do SebastianIA na Hostinger é automático após git push para o repositório/branch configurado.

Não solicitar deploy manual, acesso à Hostinger, credenciais ou nova configuração de automação quando o git push for suficiente.

Só investigar ou solicitar intervenção manual na Hostinger se houver evidência concreta de falha do deploy automático.

## 3. Preservação da Arquitetura Existente

Não substituir arquitetura, provider, modelo, persistência, fluxo cognitivo, entrypoint, configuração de runtime ou contratos existentes apenas por preferência técnica.

Primeiro identificar e preservar o comportamento já homologado.

Alterações arquiteturais relevantes devem ser propostas antes de implementadas.

Não criar arquitetura paralela para resolver problema localizado.

## 4. Compatibilidade do Runtime

Respeitar a arquitetura e os contratos atualmente adotados pelo projeto, incluindo ESM/TypeScript e o runtime já configurado.

Não alterar versão de Node, estratégia de módulos, scripts de inicialização, build ou entrypoint sem causa comprovada e autorização quando a mudança puder afetar produção.

## 5. SPECs e Funcionalidades Homologadas

Funcionalidades e SPECs já implementadas e homologadas são contrato de regressão.

Uma tarefa nova não está autorizada a remover, enfraquecer ou reinterpretar comportamento anterior fora do escopo solicitado.

Correções devem preservar testes e contratos existentes sempre que aplicáveis.

## 6. Escopo Mínimo

Para tarefas pontuais, ler e alterar somente os arquivos necessários.

Não realizar refatoração ampla, limpeza geral, reorganização de pastas, atualização geral de dependências ou "melhorias oportunísticas" durante outra tarefa.

Qualquer problema lateral encontrado deve ser reportado separadamente, sem ampliar automaticamente o escopo.

## 7. Diagnóstico Antes de Alteração

Não corrigir por suposição.

Primeiro obter evidência suficiente da causa.

Se a causa não puder ser demonstrada rapidamente, aplicar a regra já existente de Controle de Quota, Proporcionalidade e Limite de Investigação: parar, resumir evidências e solicitar autorização antes de expandir.

## 8. Validação

Antes de considerar uma alteração concluída, executar os testes diretamente relacionados e as validações mínimas já existentes no projeto.

Não corrigir testes removendo cobertura ou relaxando expectativa apenas para fazê-los passar.

Falhas preexistentes devem ser diferenciadas de regressões produzidas pela tarefa.

## 9. Commit e Push

Não fazer commit ou push automaticamente salvo quando a tarefa ou autorização do usuário determinar isso.

Quando houver autorização para publicar, manter commits coerentes e limitados ao escopo da tarefa.

Não misturar alterações não relacionadas.

## 10. SebastianIA Não Deve Ser Simplificado Funcionalmente

O objetivo é evoluir o SebastianIA preservando sua capacidade e conhecimento, não reduzir funcionalidades para facilitar implementação.

Simplificar a solução técnica é desejável quando mantém o requisito integral; simplificar ou remover o requisito funcional não é.

---

## Controle de Quota, Proporcionalidade e Limite de Investigação

Priorizar sempre soluções breves, objetivas, imediatas e proporcionais ao problema.

Quota, tokens, tempo de execução e créditos externos são recursos limitados e devem ser tratados como parte explícita do custo da tarefa.

Quando uma correção simples não apresentar solução rapidamente, não continuar investigando indefinidamente.

É obrigatório:

* não deduzir sucessivamente sem evidência;
* não transformar hipótese em fato;
* não explorar o repositório inteiro para resolver problema localizado;
* não reler arquivos, documentação, dependências ou partes do sistema já analisadas sem necessidade comprovada;
* não realizar auditorias amplas quando a tarefa é pontual;
* não investigar várias hipóteses em paralelo sem evidência que justifique isso;
* não executar buscas extensas "até encontrar alguma coisa";
* não fazer sucessivas correções especulativas;
* não transformar uma funcionalidade pequena em investigação arquitetural;
* não insistir numa abordagem técnica apenas porque trabalho já foi investido nela;
* não consumir milhares ou dezenas de milhares de tokens numa tarefa pequena porque a primeira abordagem falhou;
* não consumir créditos de serviços externos repetidamente para diagnóstico sem autorização explícita;
* não ampliar escopo silenciosamente.

Falhar uma abordagem não autoriza aumentar indefinidamente a investigação.

Se uma solução breve e fundamentada não for encontrada após investigação curta e direcionada, PARAR.

Antes de continuar, retornar ao usuário de forma curta e objetiva:

* o que foi comprovado;
* o que continua desconhecido;
* a hipótese principal, explicitamente identificada como hipótese;
* qual evidência falta;
* quais arquivos exatos precisariam ser consultados;
* qual é a ação mínima proposta;
* estimativa qualitativa do impacto/complexidade caso seja necessário ampliar a investigação.

Aguardar autorização antes de ampliar a investigação.

Se perceber durante a execução que o consumo está ficando desproporcional ao tamanho da tarefa, interromper antes de continuar consumindo quota, mesmo que ainda exista investigação possível.

A complexidade técnica da solução deve ser proporcional ao requisito funcional.

Se uma funcionalidade simples estiver exigindo infraestrutura, dependências, arquitetura ou investigação excessivamente complexas, parar e reconsiderar a abordagem.

Antes de sofisticar a solução, procurar uma alternativa mais simples que cumpra integralmente o requisito, preserve segurança e integridade dos dados e seja mais fácil de manter.

Uma implementação já iniciada não cria obrigação de continuar naquela arquitetura. Se ela se mostrar desproporcional, frágil ou incompatível com o ambiente real, parar, reportar e propor simplificação.

A ordem preferencial de trabalho deve ser:

evidência → causa comprovada → solução mínima → validação

Evitar o ciclo:

hipótese → exploração extensa → tentativa → nova hipótese → nova tentativa → nova exploração

Reutilizar obrigatoriamente todo conhecimento já disponível e relevante:

* diagnósticos anteriores;
* arquivos já identificados;
* resultados de testes;
* logs já obtidos;
* decisões arquiteturais já tomadas;
* contexto fornecido pelo usuário;
* implementações homologadas;
* soluções comprovadamente funcionais existentes nos próprios projetos ou nos outros projetos quando tecnicamente aplicáveis.

Não refazer investigação já realizada.

Quando houver uma solução comprovadamente funcional semelhante em Neuro Hub Pro, LSB ou SebastianIA, consultá-la de forma pontual, somente nos arquivos necessários, antes de reconstruir a solução do zero.

Isso não autoriza auditoria cruzada ampla entre os projetos.

Antes de instalar nova dependência, criar infraestrutura, trocar arquitetura, adicionar serviço externo, gerar custo recorrente ou introduzir solução significativamente mais complexa, parar e solicitar autorização, salvo quando isso já tiver sido explicitamente autorizado na tarefa.

Segurança, integridade dos dados e requisitos funcionais não podem ser sacrificados apenas para economizar quota. O objetivo é eliminar desperdício, não eliminar investigação necessária.

Em resumo:

resolver o problema da forma mais simples que funcione corretamente; investigar somente o necessário; parar quando a investigação deixar de ser proporcional; e pedir autorização antes de transformar uma tarefa pequena em uma tarefa grande.

---

## Tag Obrigatória Após Homologação

Toda alteração funcional, correção ou conjunto coerente de alterações que tenha sido:

* commitado;
* enviado ao repositório remoto com `git push`;
* homologado com sucesso;

deve receber tag de homologação obrigatoriamente, apontando exatamente para o commit/HEAD homologado.

A tag deve ser criada somente após a homologação, nunca apenas porque houve um commit.

Quando houver vários commits intermediários antes da homologação, criar uma tag no estado final homologado, não uma tag para cada commit.

Regras:

* nome descritivo e data quando apropriado;
* apontar exatamente para o commit homologado;
* executar `git push origin <tag>`;
* nunca mover, sobrescrever ou reutilizar tag de homologação anterior;
* preservar todas as tags anteriores;
* se a homologação falhar, não criar tag.

Fluxo permanente:

alteração → validação técnica → commit → push → homologação → tag → push da tag.
