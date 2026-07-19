# STATE — IA Analytics Pro

**Atualizado em:** 2026-07-12

> Estado ATUAL do projeto, em uma folha. Histórico datado vive em
> [`docs/journal.md`](docs/journal.md); regras permanentes, em [`CLAUDE.md`](CLAUDE.md).
> Se uma seção daqui passar de ~15 linhas, ela está no arquivo errado.

## Onde estamos

**v2 entregue e auditoria fechada.** O app faz o ciclo completo: carrega planilha ou
conecta banco → a IA vê **só o esquema** → dashboard de BI renderiza no navegador com os
dados brutos que nunca saíram da máquina. Roda como web, PWA e desktop (Electron).

- **Auditoria completa do time (2026-07-10): TODOS os achados de correção fechados.**
  Bateria final: `tsc` 0 · `lint` 0 · **vitest 205/205 (0 skipped)** · build OK · **E2E 20/20**.
  CyberSec **sem veto**; QA aprovado. Relatórios em [`analise-melhorias/`](analise-melhorias/)
  e [`docs/auditoria-neo-2026-07/`](docs/auditoria-neo-2026-07/).
- O que resta é **backlog de PRODUTO** (features novas), não dívida técnica.
- Repositório organizado em 2026-07-12: `main` empurrada para o `origin` (estava 54
  commits só nesta máquina), `.neo/` migrado para `docs/`, esquema de branches criado.

## Próximo passo

**Nada está em andamento — aguardando o Michael escolher o próximo item da fila.**
A recomendação da auditoria de produto é o item 1 abaixo (P0): hoje o arquivo `.iaap`
salva a *configuração* do dashboard mas **não carrega os dados**, então quem recebe o
arquivo não vê nada — é a maior lacuna percebida pelo usuário final.

## Fila (backlog de produto, em ordem sugerida)

1. **P0 — Export de dashboard autocontido.** O `.iaap` hoje não embute os dados; abrir em
   outra máquina resulta em dashboard vazio.
2. **P0 — Sinalizar na UI que a análise é uma "foto" estática** (o usuário vindo do
   PowerBI espera refresh e não há).
3. **P1 — Reconectar à fonte** para atualizar uma análise persistida mantendo a config.
4. **P2 — Higiene:** labels nos inputs de data (axe), `Intl.Collator` no sort de texto,
   smoke do Electron empacotado, E2E no CI.

Gaps estruturais conhecidos e **aceitos** (são consequência da Privacidade Absoluta, não
bugs): multiusuário, compartilhamento além de arquivo local, refresh automático,
conectores de API, métricas calculadas (DAX), alertas.

## Blockers

Nenhum.

## Como retomar

```bash
npm install
npm run dev          # http://localhost:3000
```

Antes de qualquer commit: `npm test` · `npm run lint` · `npm run build` (os três portões).
Trabalho de agente acontece na `claude-local` → merge em `appdev` → `main` **só com
autorização explícita do Michael** (`node scripts/promote.mjs`). Ver `CLAUDE.md` §Branches.

Leitura de contexto, em ordem: este arquivo → `CLAUDE.md` → `docs/mapa-do-sistema.md`
(raio-x arquitetural) → `docs/adr/` (decisões âncora) → `docs/journal.md` (o porquê).
