---
name: qa-completo
description: Verificação completa do IA Analytics Pro antes de commit/release — tipos, lint, testes, build standalone, smoke test das rotas e E2E do dashboard no navegador. Use quando pedirem para "verificar tudo", "rodar o QA" ou antes de publicar.
---

# QA Completo — IA Analytics Pro

Execute NA ORDEM. Pare e corrija no primeiro problema; depois recomece do passo que falhou.

## 1. Estática + testes automatizados
```bash
npx tsc --noEmit
npm run lint
npm test            # unitários (Vitest)
npm run test:e2e    # E2E (Playwright) — caminho de ouro no navegador real
```
Critério: zero erros de tipo, lint limpo, todos os unitários verdes e os 2 E2E
passando (upload→dashboard e persistência/reabrir sem reanalisar). Se faltar o
navegador do Playwright: `npx playwright install chromium`.

## 2. Build de produção
```bash
npm run build
```
Critério: build sem erros e a lista de rotas deve conter `/api/analyze/{local,cloud}`, `/api/db/{tables,rows}` e `/api/ollama/{install,models,pull,start}`. Ao final deve aparecer "Assets (static + public) copiados".
Obs.: se o app standalone/atalho `.cmd` estiver aberto, ele trava `.next/standalone` (EBUSY) — feche-o antes de buildar.

## 3. Smoke test do standalone (o mesmo servidor do atalho .cmd)
Suba `PORT=3457 node scripts/start-standalone.mjs` em background e verifique:
- `GET /` → 200
- `GET /sql-wasm.wasm` → 200 (SQLite no navegador depende disso)
- `POST /api/db/tables` com `{"kind":"oracle",...}` → 400 com mensagem de dialeto
- `POST /api/db/tables` sem connectionString → 400
- Nenhuma resposta de erro pode ecoar credenciais/connection strings
Encerre o servidor ao final.

## 4. E2E do dashboard (preview do navegador)
Além do Playwright (passo 1), para inspeção manual use o preview server (config "dev" em .claude/launch.json, porta 3901) e injete um CSV via `preview_eval` (File + DataTransfer no input[type=file]) com colunas de categoria, número e data — de preferência com **decimal por vírgula** (ex.: "5,52") e datas DD/MM. Verifique:
- Metadados extraídos aparecem; NENHUM valor de célula aparece no bloco de metadados
- Números pt-BR (vírgula) viram coluna "número" e entram nos KPIs (não "texto")
- Dashboard renderiza gráficos automáticos (suggestCharts) imediatamente e a IA enriquece sozinha (análise automática ao carregar)
- Ranking em BARRAS HORIZONTAIS com rótulo de valor; tendência em ÁREA; sem opção "Linha"; Treemap/Combo disponíveis
- Marcar um filtro de categoria (ou clicar numa barra/fatia/área do treemap = drill-down) atualiza os KPIs com a matemática CERTA (confira soma/média à mão)
- Botão "Dados" abre a tabela respeitando o filtro
- `.recharts-wrapper > svg.recharts-surface` existe em cada card (contrato do export PNG)
- Recarregar mostra "Análises recentes"; reabrir restaura o dashboard sem nova chamada `/api/analyze`
- Console sem erros (warnings do React DevTools/HMR são aceitáveis)

## 5. Privacidade (inegociável)
Confirme que os testes de privacidade passaram (data-parser/analysis: metadados nunca contêm valores de células) e que nenhuma mudança introduziu campo de linhas em payload de `/api/analyze/*`.

## Relatório
Termine com uma tabela: etapa → resultado. Se algo foi pulado, diga explicitamente.
