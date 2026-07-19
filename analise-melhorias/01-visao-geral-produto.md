# Visão Geral de Produto — IA Analytics Pro

> Auditoria de produto (somente leitura de código). Fonte: `CLAUDE.md`, `README.md`,
> `PLANO_MESTRE.md`, `docs/ARCHITECTURE.md`, `docs/adr/`, `app/page.tsx`, `components/*`,
> `lib/*`. Data da auditoria: 2026-07-10.

## 1. O que é o produto

O **IA Analytics Pro** é uma ferramenta de **análise autônoma de dados e
dashboards**, no estilo de uma ferramenta de BI empresarial (comparável em
propósito a Power BI/Tableau em escala pessoal), voltada a um usuário que **não
programa e não escreve consultas**: ele arrasta uma planilha ou conecta um
banco de dados, escolhe um "motor" de inteligência artificial (Local/offline
via Ollama, ou Nuvem via Google Gemini) e a aplicação sozinha extrai o
esquema dos dados, monta um dashboard com KPIs e gráficos, e deixa a IA
sugerir/enriquecer os gráficos mais relevantes — sem que o usuário precise
configurar nada.

O diferencial estrutural do produto é a **Privacidade Absoluta**: os dados
brutos (as células da planilha/tabela) nunca saem do navegador do usuário. A
IA — local ou na nuvem — enxerga exclusivamente um "metadado" (nomes de
coluna, tipos inferidos e estatísticas agregadas anônimas como mín/máx/média)
e devolve apenas a *arquitetura* dos gráficos (que tipo de gráfico, quais
colunas nos eixos). É o navegador que funde essa arquitetura com os dados
reais, que nunca trafegaram. Essa garantia é reforçada por validação de
payload em código (`validateMetadataPayload`) e testada automaticamente.

É distribuído em três formas — web app, PWA instalável no celular, e app
desktop via Electron/atalho `.cmd` para Windows — todas alimentadas pelo mesmo
código Next.js. O público-alvo declarado nas memórias do projeto é um usuário
final leigo em código, ex-usuário de Power BI, que precisa de uma experiência
"solte o arquivo e o dashboard aparece", em português do Brasil, com números e
datas no formato local.

## 2. Inventário funcional

| Funcionalidade | Status | Onde vive no código |
|---|---|---|
| Upload de planilha CSV/XLSX/XLS | Entregue | `components/upload-zone.tsx`, `lib/data-parser.ts` |
| Leitura de banco SQLite (.db/.sqlite) 100% no navegador | Entregue | `lib/sqlite-parser.ts`, `public/sql-wasm.*` |
| Conexão a bancos de servidor (PostgreSQL/MySQL/SQL Server) | Entregue | `components/db-connect-panel.tsx`, `lib/db-connectors.ts`, `app/api/db/{tables,rows}/route.ts` |
| Extração de metadados (esquema + estatísticas anônimas) | Entregue | `lib/data-parser.ts` (`BaseMetadataExtractor`) |
| Motor de IA Local (Ollama, offline) | Entregue | `app/api/analyze/local/route.ts` |
| Motor de IA Nuvem (Google Gemini) | Entregue | `app/api/analyze/cloud/route.ts` |
| Gerenciamento do Ollama sem terminal (detectar/instalar/baixar modelo/iniciar) | Entregue | `app/api/ollama/{models,pull,install,start}/route.ts`, `components/ollama-panel.tsx`, `components/local-setup-guide.tsx` |
| Blindagem de payload (allowlist positiva; rejeita `rows`/`data`/`values`/`records`) | Entregue | `lib/analysis.ts` (`validateMetadataPayload`) |
| Anti-alucinação da IA (descarta gráficos com colunas fora do esquema) | Entregue | `lib/analysis.ts` (`normalizeCharts`) |
| Análise automática ao carregar dado (sem clicar em nada) + botão "Reanalisar" | Entregue | `app/page.tsx` (`runAndPersist`, `handleParsed`) |
| Dashboard automático sem IA (heurística grátis a partir só do esquema) | Entregue | `lib/dashboard-utils.ts` (`suggestCharts`) |
| KPIs automáticos (soma/média por natureza da coluna) | Entregue | `components/dashboard/kpi-cards.tsx`, `lib/dashboard-utils.ts` (`computeKpis`) |
| Filtros globais (categoria multi-seleção + intervalo de datas) | Entregue | `components/dashboard/filters-bar.tsx` |
| Drill-down (clicar em barra/fatia filtra o dashboard inteiro) | Entregue | `dashboard-view.tsx` (`handleDrill`/`toggleCategoryFilter`) |
| Troca de tipo de gráfico por card + agregação escolhível (soma/média/contagem/mín/máx) | Entregue | `components/dashboard/chart-card.tsx`, `lib/chart-data.ts` |
| Construtor manual de gráfico | Entregue | `components/dashboard/chart-builder.tsx` |
| Tipos de gráfico: barras (ranking horizontal), área (tempo), combo (eixo duplo), pizza/rosca, treemap, dispersão | Entregue | `lib/chart-rules.ts` (`coerceChartType`), `components/charts-wrapper.tsx` |
| Tabela de dados ordenável/paginada | Entregue | `components/dashboard/data-table.tsx` |
| Export PNG por gráfico | Entregue | `components/dashboard/chart-card.tsx` |
| Export CSV filtrado (`;` + BOM, pt-BR) | Entregue | `dashboard-view.tsx` (`exportCsv`), `lib/dashboard-utils.ts` (`rowsToCsv`) |
| Relatório/PDF via impressão (tema claro dedicado) | Entregue | `dashboard-view.tsx` (`window.print()`), CSS de impressão |
| Salvar/carregar configuração de dashboard (localStorage + arquivo `.iaap`) | Entregue | `components/dashboard/saved-dashboards.tsx`, `lib/dashboard-storage.ts` |
| Persistência de análises (reabrir sem reprocessar/sem chamar IA de novo) | Entregue | `lib/analysis-store.ts` (IndexedDB), `components/recent-analyses.tsx` |
| Contexto de negócio opcional (uma frase que refina a sugestão da IA) | Entregue | `app/page.tsx` (`extractContext`, cap 280 caracteres) |
| Tema escuro/claro comutável | Entregue | `hooks/use-theme.ts`, `app/page.tsx` (`ThemeToggle`) |
| Priorização de colunas para tabelas largas (200+ colunas) antes de ir à IA | Entregue | `lib/prompt-builder.ts` (`prioritizeColumns`, `MAX_AI_COLUMNS=40`) |
| Números sensíveis a locale pt-BR (vírgula decimal, milhar, moeda, %) | Entregue | `lib/number-utils.ts` (`parseLocaleNumber`) |
| Datas ISO + DD/MM/AAAA ancoradas em UTC | Entregue | `lib/date-utils.ts` |
| PWA instalável (celular/desktop) | Entregue | `components/pwa-register.tsx`, manifest |
| App desktop via Electron + instalador NSIS | Entregue | `electron/main.cjs`, `package.json` (`electron-builder`) |
| Atalho `.cmd` (build + start automático, sem terminal) | Entregue | `IA Analytics Pro.cmd` |
| Multiusuário / contas / login | **Ausente** (fora de escopo declarado) | — |
| Compartilhamento de dashboard entre pessoas (link, servidor) | **Ausente** — só exporta arquivo local `.iaap`/PNG/CSV/PDF | `lib/dashboard-storage.ts` |
| Agendamento/atualização automática de dados (refresh periódico) | **Ausente** | — |
| Conectores de API/webhooks/n8n | **Ausente** (mencionado como extensível, não implementado) | Roadmap no `CLAUDE.md` |
| Anotações/comentários em gráficos, favoritar KPI | **Ausente** | — |
| Alertas/limiares (ex.: "avisar se KPI cair de X") | **Ausente** | — |
| Testes automatizados (unitários + E2E) cobrindo os fluxos acima | Entregue | `lib/*.test.ts` (Vitest), `e2e/*.spec.ts` (Playwright) — 18 specs incl. XLSX multi-aba, SQLite, locale numérico, drill-down, exportações, persistência, tema, tabela hostil, volume 100k, Ollama offline |

## 3. Avaliação de produto

**Aderência ao usuário-alvo (irmão do Michael, ex-usuário de Power BI).** É
alta no essencial de "consumo" de BI: filtros globais, drill-down por clique,
KPIs automáticos, múltiplos tipos de gráfico com troca in-place, export
CSV/PNG/PDF e salvar/reabrir configuração — isso cobre o núcleo do que um
usuário de Power BI espera ao *explorar* um dado que já está pronto. A
"análise dispara sozinha" e o dashboard aparece mesmo sem IA (heurística
`suggestCharts`) reduzem a fricção de configuração a praticamente zero, o que
é mais amigável que Power BI para esse perfil. As decisões de "gráficos para
negócios" (ranking horizontal em vez de barra vertical, rosca em vez de pizza,
área só no tempo, dispersão escondida do automático) são maduras e bem
documentadas (ADR 0006), sinal de que o produto já passou por iteração de UX
real, não é só um MVP cru.

**Gaps funcionais percebidos frente ao modelo mental de Power BI:**
1. **Sem compartilhamento/colaboração** — em Power BI, o valor central é
   publicar um relatório para outras pessoas verem (na nuvem, com
   permissões). Aqui, tudo é local ao navegador de quem analisou; a única
   forma de "levar para outra pessoa" é exportar PDF/CSV/PNG ou o arquivo
   `.iaap` (que exige que a outra pessoa tenha os MESMOS dados brutos
   localmente, pois o `.iaap` não contém dados — só a config). Isso é uma
   decisão coerente com Privacidade Absoluta, mas é um gap de expectativa se
   o usuário-alvo quiser mandar um dashboard pronto para outra pessoa sem
   dado nenhum.
2. **Sem atualização automática de dados** — Power BI tem "refresh"
   agendado contra a fonte; aqui cada análise é uma foto estática de um
   upload/consulta pontual. Reabrir uma análise salva não busca dado novo do
   banco.
3. **Sem medidas/campos calculados definidos pelo usuário** (equivalente a
   DAX) — as agregações disponíveis são as pré-definidas (soma/média/
   contagem/mín/máx) por coluna; não há como o usuário criar uma métrica
   derivada (ex.: margem = receita − custo).
4. **Sem relacionamento entre tabelas** — cada análise parte de UMA tabela/
   arquivo por vez; não há junção de múltiplas fontes num único modelo, algo
   comum em uso de BI real (fato + dimensão).
5. **Limite de linhas em bancos de servidor** (`LIMIT_OPTIONS` até 50.000) —
   adequado para "amostra representativa", mas pode surpreender quem espera
   ver a tabela inteira como no Power BI (que faz agregação no servidor).

**Riscos de escopo:**
- O README e o `CLAUDE.md` já sinalizam claramente "protótipo"; o maior risco
  é o usuário-alvo (leigo) achar, pela UX polida, que o produto tem paridade
  de recursos com Power BI (ex.: colaboração, refresh), quando na verdade a
  Privacidade Absoluta impõe um teto estrutural a esse tipo de recurso — vale
  deixar isso explícito na própria interface, não só na documentação técnica.
- A aposta em "IA sugere automaticamente" tem qualidade dependente do motor
  Local (modelo leve `llama3.2:3b`); não há, pelo inventário, um mecanismo de
  feedback do usuário sobre a qualidade das sugestões da IA (ex.: "essa
  sugestão não fez sentido") que alimente melhoria contínua — a heurística
  `suggestCharts` é o fallback de qualidade, mas isso é uma escolha de
  engenharia, não de produto medido.

## 4. Backlog sugerido de melhorias de produto

### P0 — Crítico para o usuário-alvo não ficar bloqueado

1. **Exportar dashboard "autocontido" para outra pessoa** (dados + config num
   único arquivo local, não um link, mantendo Privacidade Absoluta).
   *Critério de aceitação:* existe uma ação "Exportar dashboard completo" que
   gera um único arquivo baixável; abrir esse arquivo em outra máquina (sem
   acesso à fonte original) reconstrói o MESMO dashboard com os MESMOS dados
   filtráveis, sem nenhuma chamada de rede. Teste E2E cobre exportar → abrir
   em contexto de navegador limpo → dashboard idêntico renderiza.

2. **Indicar na interface, de forma explícita, que a análise é uma "foto"
   estática** (sem refresh automático), para não gerar expectativa de dado
   ao vivo.
   *Critério de aceitação:* toda análise reaberta via "Análises recentes"
   mostra visualmente a data/hora da captura original; existe um rótulo ou
   tooltip explicando que os dados não são atualizados automaticamente.
   Verificável por teste E2E que abre uma análise persistida e localiza esse
   rótulo no DOM.

### P1 — Eleva a paridade percebida com BI empresarial

3. **Campo calculado simples (métrica derivada por coluna existente, ex.: A
   ÷ B, A − B)**, sem exigir linguagem de fórmula avançada.
   *Critério de aceitação:* usuário consegue, pela UI, definir uma nova
   coluna calculada a partir de 2 colunas numéricas existentes com um dos
   operadores básicos (+ − × ÷); essa coluna aparece disponível no construtor
   manual de gráfico e nos KPIs. Coberto por teste unitário da função de
   cálculo (`lib/`) e um E2E do fluxo criar métrica → aparece num gráfico.

4. **Atualizar dados de uma análise já persistida** (reconectar à mesma
   fonte — arquivo re-selecionado ou mesma connection string — e substituir
   as linhas mantendo a config do dashboard).
   *Critério de aceitação:* botão "Atualizar dados" numa análise aberta
   dispara nova leitura da mesma fonte e re-renderiza os MESMOS gráficos/
   filtros salvos sobre as linhas novas, sem exigir reconfigurar do zero.
   Teste E2E: abrir análise salva de CSV, trocar o arquivo fonte por uma
   variação com uma linha a mais, clicar "Atualizar dados", nova contagem de
   linhas reflete no KPI "Linhas".

5. **Elevar/expor o teto de linhas em bancos de servidor** com indicação
   clara de amostragem quando o teto é atingido.
   *Critério de aceitação:* quando `rowCount` retornado pela introspecção
   excede o teto escolhido, a UI mostra um aviso explícito "amostra de N de M
   linhas" (não apenas silenciosamente corta). Testável via teste unitário
   de `db-connectors`/rota que simula tabela grande e verifica o aviso no
   payload/; E2E confirma o aviso visível.

### P2 — Refinamento / conveniência

6. **Feedback do usuário sobre qualidade da sugestão de gráfico da IA**
   (ex.: descartar com motivo, ou "gráfico útil"/"não útil").
   *Critério de aceitação:* cada card de gráfico sugerido pela IA tem um
   controle de feedback (útil/não útil); o evento fica registrado localmente
   (ex.: log em IndexedDB) e é possível inspecionar esse registro em teste
   unitário — não precisa (e não deve, por Privacidade Absoluta) trafegar
   para fora.

7. **Anotação textual simples em um gráfico** (nota fixada, salva junto da
   config do dashboard `.iaap`).
   *Critério de aceitação:* usuário adiciona uma nota de texto livre a um
   card de gráfico; a nota é preservada ao salvar/reabrir/exportar o
   dashboard (`.iaap`); coberto por teste unitário de `dashboard-storage.ts`
   (round-trip salvar→carregar preserva a nota) e teste manual visual.

8. **Junção simples de duas fontes por uma coluna-chave comum** (ex.: unir
   uma tabela de vendas com uma de produtos pelo campo `produto_id`), 100%
   client-side.
   *Critério de aceitação:* usuário seleciona duas fontes já carregadas e uma
   coluna-chave em cada; o resultado produz um `ParsedDataset` único cujo
   `columnCount` é a soma das colunas não-chave mais a chave, e cujo
   `rowCount` corresponde a um inner join correto — validável por teste
   unitário com fixtures pequenas e resultado esperado fixo.

---
**Resumo para quem só quer o veredito:** o produto entrega hoje um MVP de BI
pessoal maduro para EXPLORAR um dado já carregado (upload, dashboard
automático, filtros, drill-down, export, persistência local) com uma garantia
de privacidade rara e bem testada. Os maiores gaps frente à expectativa de um
usuário vindo do Power BI são estruturais e coerentes com essa mesma garantia:
não há compartilhamento entre pessoas além de arquivo local, não há refresh
automático de dados, e não há métricas calculadas ou junção de tabelas. Nenhum
desses gaps é bug — são fronteiras de escopo que valem confirmação explícita
com o usuário-alvo antes de virarem trabalho.
