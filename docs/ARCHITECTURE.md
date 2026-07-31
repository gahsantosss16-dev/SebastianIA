# ARCHITECTURE

Versão: 1.1

---

# Visão Geral

Sebastian IA é composto por módulos independentes.

Cada módulo possui uma responsabilidade única.

O Core coordena todos eles.

---

# Fase 1 — Core Foundation

A Fase 1 — Core Foundation está concluída e homologada.

Os módulos implementados e validados incluem infraestrutura de core, eventos, container, lifecycle, plugins, erros, health, configuração, memória, conversação, contexto, comando e capability.

A SPEC-014 foi concluída e homologada, encerrando oficialmente a camada de Capability Resolver.

---

# Core

Responsável por:

- compreender objetivos;
- planejar;
- tomar decisões;
- coordenar módulos.

Nunca executa tarefas diretamente.

---

# Memory

Responsável por:

- armazenar conhecimento;
- lembrar decisões;
- recuperar contexto;
- aprender.

---

# Models

Responsável por:

- comunicar-se com modelos de IA;
- selecionar o modelo mais adequado;
- trocar de modelo quando necessário.

---

# Tools

Responsável por:

- Git;
- VS Code;
- Windows;
- Navegador;
- Supabase;
- Banco de Dados;
- APIs;
- Arquivos.

---

# Agents

Especialistas em tarefas específicas.

Exemplos:

- Git Agent
- Code Agent
- Browser Agent
- Database Agent
- Document Agent
- Communication Agent

---

# Projects

Cada projeto possui contexto próprio.

Exemplos:

- Sebastian IA
- Neuro Hub Pro
- LSB Service

Nenhum projeto interfere no outro.

---

# Interface

Responsável pela interação com o usuário.

Pode existir em:

- Desktop
- Web
- Mobile
- Terminal
- Voz

---

# Segurança

Toda ação crítica deve ser autorizada.

Nenhuma operação destrutiva ocorre sem confirmação.

---

# Fluxo

Usuário

↓

Core

↓

Planejamento

↓

Agente Especializado

↓

Ferramenta

↓

Resultado

↓

Validação

↓

Memória

---

# Próximos passos

A Fase 2 ainda não foi iniciada.

A próxima etapa é a revisão arquitetural de transição e a definição da SPEC-015, sem ampliar o escopo da Fase 1.