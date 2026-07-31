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

A arquitetura fundamental foi concluida com a SPEC-024 (Command Capability Pipeline Executor), encerrando formalmente a Fase 1.

Foi realizada analise arquitetural para uma possivel SPEC-025 e nao foi identificada lacuna arquitetural legitima para nova SPEC nesta fase, evitando overengineering.

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

A proxima etapa do projeto e integrar a arquitetura consolidada da Fase 1 ao restante do Sebastian IA, preservando as fronteiras homologadas.