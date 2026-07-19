# Spec de Design — Tema Claro/Escuro comutável

Autor: UI/UX (Squad) · Onda: expansão IA Analytics Pro · Consumidor: `frontend` (onda 2)
Resolve: `FE-7` (contraste de texto secundário) e `FE-8` (app dark-only, público-alvo vem do PowerBI) da auditoria (`frontend-ux.md`).

Esta spec é a fonte de verdade de tokens e mecânica. O frontend implementa **à risca**: se algum valor precisar mudar na prática (ex.: Lighthouse acusa uma combinação), a mudança volta primeiro para este arquivo, não é decidida ad-hoc no componente.

---

## 1. Direção estética

Publico-alvo real (memória: `usuario-final-irmao-powerbi`): usuário de BI empresarial vindo do PowerBI, que abre **tema claro por padrão** naquele produto. Hoje o app é dark-only fixo (achado FE-8) — isso não é neutro para esse público, é uma escolha que diverge da expectativa dele.

Princípios:
- **Profissional, denso em dados, sem infantilizar.** Nada de emoji, nada de cor "alegre" gratuita — a cor carrega significado (categoria, estado, acento), nunca decoração.
- **Os dois temas são cidadãos de primeira classe.** O tema claro não é um "modo economia" mal cuidado — é desenhado com o mesmo rigor do escuro, porque é o que o público-alvo primário vai preferir na prática assim que existir a opção.
- **Tema claro = "canvas cinza-claro + cartão branco"**, o padrão visual de ferramentas de BI (PowerBI, Looker): fundo da página ligeiramente acinzentado, cartões de gráfico brancos com borda sutil — cria hierarquia sem precisar de sombra pesada.
- **Tema escuro continua a base atual** (slate/emerald), só com os tokens de texto secundário corrigidos (FE-7).
- A paleta categórica dos gráficos muda de matiz/luminosidade entre os temas (mais clara no escuro, mais saturada/escura no claro) mas mantém a **mesma identidade de matiz por índice** — a cor da categoria 1 continua "sendo verde" nos dois temas, só a tonalidade exata muda para manter contraste.

---

## 2. Arquitetura de tokens

Mecanismo: **atributo `data-theme` na tag `<html>`** (`data-theme="dark"` | `data-theme="light"`), com os tokens como *custom properties* CSS, seguindo exatamente o padrão que `app/globals.css` já usa para `--background`/`--foreground` (ligado ao Tailwind v4 via `@theme inline`).

```css
/* app/globals.css — substituir o bloco :root atual por isto */

:root,
:root[data-theme="dark"] {
  --surface-base: #0b1120;
  --surface-elevated: #111a2c;
  --surface-sunken: #0a0f1a;
  --surface-hover: #1c2740;
  --surface-chip: #16213a;

  --border-subtle: #1e293b;
  --border-default: #2b3b57;
  --border-strong: #3d4f6f;

  --text-primary: #f1f5f9;
  --text-secondary: #cbd5e1;
  --text-muted: #94a3b8;     /* FE-7: substitui slate-500/600 no tema escuro */
  --text-disabled: #64748b;  /* só para controles desabilitados, nunca texto obrigatório */
  --text-on-accent: #06170f; /* texto sobre um preenchimento cheio de --accent (que é claro) */

  --accent: #34d399;         /* emerald-400 — ícones, texto de destaque, borda de foco */
  --accent-strong: #4ade80;  /* hover do accent (levemente mais claro no escuro) */
  --accent-solid: #34d399;   /* preenchimento sólido de botão — mesmo tom no escuro */
  --accent-subtle-bg: #123326;
  --focus-ring: #34d399;

  --state-success-text: #6ee7b7;
  --state-success-bg: rgba(52, 211, 153, 0.10);
  --state-success-border: rgba(52, 211, 153, 0.25);

  --state-warning-text: #fcd34d;
  --state-warning-bg: rgba(251, 191, 36, 0.10);
  --state-warning-border: rgba(251, 191, 36, 0.20);

  --state-error-text: #fca5a5;
  --state-error-bg: rgba(248, 113, 113, 0.10);
  --state-error-border: rgba(248, 113, 113, 0.25);

  --state-info-text: #93c5fd;
  --state-info-bg: rgba(96, 165, 250, 0.10);
  --state-info-border: rgba(96, 165, 250, 0.20);

  --chart-1: #34d399; /* verde-azulado (marca) */
  --chart-2: #38bdf8; /* azul-céu */
  --chart-3: #fb923c; /* laranja */
  --chart-4: #facc15; /* amarelo */
  --chart-5: #818cf8; /* índigo */
  --chart-6: #f87171; /* vermelho */
  --chart-7: #e879f9; /* magenta/roxo-avermelhado */
  --chart-8: #94a3b8; /* cinza neutro — reservado para "Outros"/overflow */

  --chart-grid: #1e293b;
  --chart-axis: #94a3b8;
  --chart-label: #cbd5e1;
  --chart-tooltip-bg: #0f172a;
  --chart-tooltip-border: #1e293b;
  --chart-tooltip-text: #e2e8f0;
  --chart-cursor: rgba(148, 163, 184, 0.08);
}

:root[data-theme="light"] {
  --surface-base: #f8fafc;
  --surface-elevated: #ffffff;
  --surface-sunken: #f1f5f9;
  --surface-hover: #e2e8f0;
  --surface-chip: #f1f5f9;

  --border-subtle: #e2e8f0;
  --border-default: #cbd5e1;
  --border-strong: #94a3b8;

  --text-primary: #0f172a;
  --text-secondary: #334155;
  --text-muted: #475569;     /* FE-7: legendas/labels pequenos, ≥4.5:1 garantido */
  --text-disabled: #94a3b8;  /* só para controles desabilitados */
  --text-on-accent: #ffffff; /* texto sobre --accent-solid (escuro no claro) */

  --accent: #059669;         /* emerald-600 — ícones, texto de destaque, borda */
  --accent-strong: #047857;  /* hover */
  --accent-solid: #047857;   /* emerald-700 — preenchimento sólido de botão + texto branco */
  --accent-subtle-bg: #d1fae5;
  --focus-ring: #047857;

  --state-success-text: #047857;
  --state-success-bg: rgba(5, 150, 105, 0.08);
  --state-success-border: rgba(5, 150, 105, 0.25);

  --state-warning-text: #92400e;
  --state-warning-bg: rgba(217, 119, 6, 0.08);
  --state-warning-border: rgba(217, 119, 6, 0.25);

  --state-error-text: #b91c1c;
  --state-error-bg: rgba(220, 38, 38, 0.08);
  --state-error-border: rgba(220, 38, 38, 0.25);

  --state-info-text: #1d4ed8;
  --state-info-bg: rgba(37, 99, 235, 0.08);
  --state-info-border: rgba(37, 99, 235, 0.20);

  --chart-1: #059669; /* verde-azulado */
  --chart-2: #0284c7; /* azul */
  --chart-3: #ea580c; /* laranja */
  --chart-4: #ca8a04; /* amarelo/dourado (mais escuro que o cru p/ ler no branco) */
  --chart-5: #4f46e5; /* índigo */
  --chart-6: #dc2626; /* vermelho */
  --chart-7: #c026d3; /* magenta/roxo-avermelhado */
  --chart-8: #64748b; /* cinza neutro — "Outros"/overflow */

  --chart-grid: #e2e8f0;
  --chart-axis: #475569;
  --chart-label: #334155;
  --chart-tooltip-bg: #ffffff;
  --chart-tooltip-border: #cbd5e1;
  --chart-tooltip-text: #0f172a;
  --chart-cursor: rgba(15, 23, 42, 0.06);
}

@theme inline {
  --color-surface-base: var(--surface-base);
  --color-surface-elevated: var(--surface-elevated);
  --color-surface-sunken: var(--surface-sunken);
  --color-surface-hover: var(--surface-hover);
  --color-surface-chip: var(--surface-chip);
  --color-border-subtle: var(--border-subtle);
  --color-border-default: var(--border-default);
  --color-border-strong: var(--border-strong);
  --color-text-primary: var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-text-muted: var(--text-muted);
  --color-text-disabled: var(--text-disabled);
  --color-accent: var(--accent);
  --color-accent-strong: var(--accent-strong);
  --color-accent-solid: var(--accent-solid);
  --color-accent-subtle-bg: var(--accent-subtle-bg);
  /* ...+ font-sans/font-mono já existentes */
}
```

Por que assim (e não `dark:` do Tailwind ou CSS-in-JS): registrar cada token como `--color-<nome>` dentro de `@theme inline` faz o Tailwind v4 **gerar sozinho** as utilities `bg-surface-elevated`, `text-text-muted`, `border-border-default` etc. — mesmo mecanismo que já existe hoje para `--color-background`/`--color-foreground` em `app/globals.css:13-18`. O componente não decide cor por tema; ele só usa a classe semântica, e o valor troca porque `data-theme` mudou no ancestral `<html>`. Zero `if (theme === ...)` espalhado pelos componentes.

`--state-*-bg/border` continuam em `rgba()` (não hex) de propósito: são washes decorativos atrás de texto, não o texto em si — o requisito de contraste AA vale para `--state-*-text` sobre o `--surface-base`/`--surface-elevated` real por trás do wash, não sobre o rgba isolado.

---

## 3. Contraste — pares corrigidos (fecha FE-7)

Calculado pela fórmula de luminância relativa do WCAG 2.1 (razão = (L1+0.05)/(L2+0.05)). Valores abaixo são o piso de verificação manual; a certificação final é o checklist da seção 9 (axe-core/Lighthouse rodando de verdade).

| Par (token sobre superfície) | Tema | Antes (classe antiga) | Antes (razão) | Depois (razão) | Resultado |
|---|---|---|---|---|---|
| `--text-muted` sobre `--surface-base` | escuro | `text-slate-500` `#64748b` sobre `#0b1120` | **~3.95:1** — falha AA texto normal | `#94a3b8` sobre `#0b1120` → **~7.35:1** | passa AA (inclusive texto pequeno) |
| `--text-muted` sobre `--surface-elevated` | escuro | `text-slate-500`/`600` sobre `bg-slate-900/40` | falha/limite | `#94a3b8` sobre `#111a2c` → **~6.78:1** | passa AA |
| placeholder de input | escuro | `placeholder:text-slate-600` `#475569` sobre `bg-slate-950/60` | **~2.48:1** — falha mesmo o piso de UI (3:1) | `--text-muted` `#94a3b8` sobre `--surface-sunken` | passa AA |
| `--text-muted` sobre `--surface-base` | claro | (não existia) | — | `#475569` sobre `#f8fafc` → **~7.5:1** | passa AA com folga |
| texto branco sobre botão preenchido de acento | escuro | (não existia) | — | **não usar branco**: `--text-on-accent` `#06170f` sobre `--accent-solid` `#34d399` → **~9.8:1** | passa AA — accent-400 é um fundo CLARO, texto precisa ser escuro, não branco |
| texto branco sobre botão preenchido de acento | claro | (não existia) | — | `--text-on-accent` `#ffffff` sobre `--accent-solid` `#047857` → **~5.48:1** | passa AA |
| `--accent` usado como texto corrido pequeno | claro | — | — | `#059669` sobre `#ffffff` → **~3.77:1** | **não usar `--accent` (emerald-600) em texto pequeno no claro** — só em ícones, bordas, texto grande (≥18px) ou títulos; para rótulo dentro de botão sólido usar `--accent-solid` + `--text-on-accent` |

Regra geral para frontend: **nunca reintroduzir `text-slate-500`/`text-slate-600` cru fora do bloco `@media print`** (que é intencionalmente hardcoded e neutro a tema — ver seção 8). Toda cor de texto vem de `--text-primary`/`--text-secondary`/`--text-muted`.

---

## 4. Paleta categórica dos gráficos (Recharts)

8 cores por tema (`--chart-1`…`--chart-8`, seção 2). Derivadas da paleta Okabe-Ito (referência padrão para daltonismo — protanopia/deuteranopia/tritanopia), ajustando luminosidade por tema: mais clara/vívida no escuro, mais escura/saturada no claro (a mesma matiz "crua" da paleta atual — `#34d399`,`#60a5fa`,`#fbbf24`,`#a78bfa` etc. — funciona bem em fundo escuro mas alguns tons (amarelo puro, violeta claro) ficam ilegíveis em fundo branco; por isso o claro usa a versão 600/700 da mesma família de matiz).

Decisões:
- **`--chart-8` é sempre um cinza neutro** (`#94a3b8` escuro / `#64748b` claro), reservado para a categoria "Outros"/agregado quando o Treemap ou a Pizza cortam cauda longa — sinaliza visualmente "isto é um agregado", não uma categoria própria (prática comum em BI).
- Removida a redundância verde-verde da paleta atual (`#34d399` + `#4ade80` eram próximas demais para deuteranopia); a nova paleta espaça 7 matizes reais + 1 neutro.
- `--chart-4` no claro é `#ca8a04` (dourado escuro), não um amarelo puro (`#facc15` ilegível sobre branco) — mesma matiz, luminosidade adaptada.
- Índice de categoria → cor é estável entre os temas (categoria 1 sempre pega `--chart-1`), só o valor do token muda. Um dashboard salvo (`lib/dashboard-storage.ts`) não precisa guardar cor nenhuma — a re-renderização já resolve pelo token do tema ativo.
- **Não depender só de cor**: como já é prática no app (tooltip mostra nome+valor em texto, legenda mostra rótulo), a paleta é reforço visual, não o único canal — mantém a defesa mesmo para quem não distingue as 8 cores perfeitamente.

Implementação: `charts-wrapper.tsx` hoje define `PALETTE`, `AXIS_COLOR`, `GRID_COLOR`, `LABEL_COLOR`, `TOOLTIP_STYLE` como constantes de módulo em hex fixo. Trocar por referência direta ao token via **`style` (não a prop `fill`/`stroke` crua)**, porque `var()` em atributo de apresentação SVG tem suporte inconsistente entre navegadores, mas funciona de forma universal dentro de `style={{ fill: "var(--chart-1)" }}`:

```tsx
// Antes:
fill={PALETTE[index % PALETTE.length]}

// Depois:
style={{ fill: `var(--chart-${(index % 8) + 1})` }}
```

O mesmo vale para `AXIS_COLOR` → `var(--chart-axis)`, `GRID_COLOR` → `var(--chart-grid)`, `LABEL_COLOR`/`fill` das `LabelList` → `var(--chart-label)`, `TOOLTIP_STYLE.backgroundColor/border/color` → `var(--chart-tooltip-bg/border/text)`, `cursor={{ fill: ... }}` do `Tooltip` → `var(--chart-cursor)`. Isso elimina qualquer detecção de tema em JavaScript dentro do componente de gráfico — o SVG lê a variável CSS do `<html data-theme>` ancestral e resolve sozinho, no escuro e no claro, sem re-render adicional ao trocar o tema.

---

## 5. Mecânica do toggle

**Atributo:** `data-theme="dark" | "light"` em `<html>` (`app/layout.tsx`).

**Resolução na primeira carga** (ordem de prioridade — implementar exatamente assim):

```js
function resolveInitialTheme() {
  const saved = localStorage.getItem("theme"); // "dark" | "light"
  if (saved === "light" || saved === "dark") return saved;
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark"; // default — não quebra quem já usa o app hoje
}
```

- **Persistência:** `localStorage.setItem("theme", value)` a cada troca pelo toggle. Chave: `"theme"`.
- **Default:** escuro, preservando a experiência atual para quem não tem preferência de SO nem escolha salva.
- **`prefers-color-scheme` só decide na ausência de escolha salva** — ou seja, só na primeira visita deste navegador (sem `localStorage["theme"]`). Depois que o usuário troca o tema (ou o app grava a escolha automática detectada), a escolha salva manda sempre, e o app para de observar mudanças ao vivo do SO (não fica alternando sozinho enquanto o usuário usa).
- **Sem flash (FOUC):** o `resolveInitialTheme()` acima **não pode rodar só depois da hidratação do React** — senão a tela pisca escuro→claro (ou vice-versa) no primeiro frame. Colocar um `<script>` inline, síncrono, **antes do `<body>`**, em `app/layout.tsx`, que roda essa mesma lógica e já escreve `document.documentElement.setAttribute("data-theme", ...)` antes do primeiro paint. Next.js App Router aceita isso como filho de `<html>`, antes de `{children}`. É o mesmo padrão usado por qualquer app com dark-mode persistido (Next/Vercel, GitHub, etc.) — não inventar mecanismo próprio.

**Toggle — posição e forma:**
- Vive no componente `Header` de `app/page.tsx` (linha ~425-450), ao lado do título "IA Analytics Pro", **sempre visível** (o `Header` é renderizado incondicionalmente no topo da página, antes de qualquer dataset carregado — não depende de estado).
- Ícone: `Sun`/`Moon` de `lucide-react` (já é dependência do projeto — ver uso em `dashboard-view.tsx`), **não** emoji, **não** switch com sol/lua ilustrado — um botão-ícone quadrado no mesmo estilo dos outros controles do header (borda `border-default`, fundo `surface-chip`, `hover:surface-hover`), coerente com o segmentado Local/Nuvem que já existe ao lado.
- Mostra o ícone do tema **para o qual vai mudar** (convenção comum): tema atual escuro → mostra `Sun` ("mudar para claro"); tema atual claro → mostra `Moon` ("mudar para escuro").
- `aria-label` dinâmico em pt-BR: `"Mudar para tema claro"` / `"Mudar para tema escuro"`. `type="button"`, sem submeter formulário.
- Tamanho e área de toque iguais aos outros ícones de ação do header (mínimo 36×36px, consistente com os botões de `dashboard-view.tsx` que usam `p-1.5`/`gap-1.5` + `h-3.5 w-3.5` de ícone — usar o mesmo padrão de espaçamento, não inventar um novo).
- Foco visível: `outline: 2px solid var(--focus-ring); outline-offset: 2px;` via `:focus-visible` (nunca `outline: none` sem substituto).

---

## 6. Mapa de migração (classe antiga → token novo)

Para o frontend fazer a troca de forma mecânica e não perder nenhuma ocorrência. Não é uma lista exaustiva de toda linha do repo — é o dicionário de tradução; aplicar em todo arquivo sob `app/`, `components/` (exceto o bloco `@media print` de `globals.css`, ver seção 7).

| Classe/valor antigo | Token novo | Observação |
|---|---|---|
| `bg-[#0b1120]` / `--background` | `bg-surface-base` | fundo de página |
| `text-slate-200` / `--foreground` | `text-text-primary` | texto padrão do body |
| `bg-slate-900/40` | `bg-surface-elevated` | cartões, painéis (agora opaco, não translúcido) |
| `bg-slate-950/60` | `bg-surface-sunken` | inputs, campos de texto |
| `bg-slate-800/80` | `bg-surface-chip` | badges/chips (ex.: "Local · llama3.2:3b") |
| `bg-slate-900/60` (segmentado Local/Nuvem) | `bg-surface-chip` | mesmo papel de chip/trilho |
| `border-slate-800` | `border-border-subtle` | bordas discretas, divisores |
| `border-slate-700` | `border-border-default` | bordas de controles interativos |
| `text-slate-50` / `text-slate-100` | `text-text-primary` | títulos, alta ênfase |
| `text-slate-300` | `text-text-secondary` | corpo secundário, rótulos de destaque |
| `text-slate-400` | `text-text-secondary` | resumo da IA, legendas — consolidado com slate-300 (ver nota) |
| `text-slate-500` | `text-text-muted` | **FE-7** |
| `text-slate-600` / `placeholder:text-slate-600` | `text-text-muted` / `placeholder:text-text-muted` | **FE-7** |
| `text-emerald-400` | `text-accent` | ícones e texto de destaque |
| `border-emerald-500/60` (foco) | `border-accent` ou `outline: var(--focus-ring)` | preferir `:focus-visible` com `--focus-ring`, não borda estática |
| `bg-emerald-500/10 text-emerald-300` (estado ativo de toggle) | `bg-accent-subtle-bg text-accent` | botões "Dados"/"Local" ativos |
| `bg-amber-500/10 text-amber-300 border-amber-500/20` | `bg-[var(--state-warning-bg)] text-[var(--state-warning-text)] border-[var(--state-warning-border)]` | banner de aviso (`persistWarning`) |

Nota sobre consolidar `slate-300`+`slate-400` em um único `text-secondary`: a paleta atual tem 4 tons de cinza para texto não-primário (300/400/500/600) sem uma regra clara de quando usar qual — a spec reduz para 3 camadas semânticas (`primary`/`secondary`/`muted`), o que facilita a decisão do frontend em telas novas e evita reintroduzir um 5º tom acidental.

---

## 7. Casos especiais

- **Impressão (`@media print` em `app/globals.css:43-89`) não muda.** O relatório impresso é sempre claro, **independente do `data-theme` ativo na tela** — inclusive quando o usuário está no tema escuro e clica "Relatório/PDF". Não converter esse bloco para tokens; ele já é hardcoded e correto, e deve continuar sendo uma sobreposição fixa e não sensível a `data-theme` (impressão tem sua própria régua de contraste/tinta, documentada no comentário existente).
- **Export PNG dos gráficos (`chart-card.tsx`):** como os gráficos agora usam `var(--chart-N)` em vez de hex cru, a rotina de export que serializa o SVG para rasterizar em PNG **precisa resolver as variáveis para valor literal antes de serializar** — um SVG serializado isoladamente (blob/`Image()`) não herda `:root` da página host. Antes de gerar o PNG: percorrer os elementos do clone do SVG, ler `getComputedStyle(elemento).fill`/`.stroke`/`.color` (já resolvido pelo navegador para hex/rgb literal) e **gravar esse valor literal de volta como atributo/style inline** no clone, só então serializar. Sem esse passo, o PNG exportado sai com formas pretas ou sem cor. Isso vale para os dois temas — o export deve capturar a cor **do tema ativo no momento do clique**, não uma cor fixa.
- **PWA `theme-color`:** `app/manifest.ts` (`theme_color`/`background_color`) e `viewport.themeColor` em `app/layout.tsx` são estáticos (gerados uma vez no build) — não dá para ler `data-theme` ali. Manter os dois em `#0b1120` (o valor do tema escuro, que é o default de primeira carga) para a splash screen/ícone do PWA antes do JS rodar. Além disso, adicionar um `<meta name="theme-color">` dinâmico atualizado por JS a cada troca de tema (o mesmo script/hook que grava `data-theme`), para que a cor da barra de status do navegador/PWA instalado acompanhe a escolha atual: `#0b1120` no escuro, `#f8fafc` no claro.
- **Tooltips do Recharts:** ver seção 4 — usam `--chart-tooltip-bg/border/text` via `contentStyle`, resolvendo sozinhos por tema já que são estilos inline React (não SVG puro), então aceitam `var()` normalmente sem a ressalva do export PNG.
- **Movimento na troca de tema:** troca instantânea por padrão (sem transição) — ferramenta de BI deve responder na hora. Se o frontend quiser suavizar (`transition: background-color 120ms ease, color 120ms ease` só em superfícies, nunca em texto piscando), envolver em `@media (prefers-reduced-motion: no-preference)` para não violar a preferência de quem pediu menos movimento no SO.

---

## 8. Checklist de aceitação (QA — verificável por screenshot/ferramenta)

1. Header mostra o botão de tema (ícone Sun/Moon) sempre visível, com `aria-label` em pt-BR correto para o tema atual.
2. Clicar no botão troca `data-theme` no `<html>` instantaneamente (sem flash), e todos os textos/superfícies/gráficos da tela mudam juntos — nenhum elemento "esquecido" no tema anterior (varrer visualmente: header, filtros, KPIs, cartões de gráfico, tabela, botões de export).
3. Recarregar a página mantém o tema escolhido (persistido em `localStorage["theme"]`).
4. Limpar `localStorage` + emular `prefers-color-scheme: light` no navegador (Playwright: `colorScheme: "light"`) → primeira carga abre em tema **claro**.
5. Limpar `localStorage` + emular `prefers-color-scheme: dark` (ou sem preferência) → primeira carga abre em tema **escuro** (comportamento atual preservado).
6. Lighthouse Accessibility ≥ 95 e **zero violações de contraste no axe-core**, rodando na tela principal e no dashboard, **nos dois temas** (fecha FE-7 de fato, não só por cálculo).
7. `grep -rn "text-slate-[56]00"` em `app/` e `components/` retorna zero ocorrências fora do bloco `@media print` de `globals.css`.
8. Paleta categórica: abrir um dashboard com um gráfico de rosca/treemap de 6+ categorias nos dois temas — as 8 cores (`--chart-1`…`--chart-8`) são visualmente distintas; repetir com o emulador de daltonismo do DevTools (protanopia e deuteranopia) e confirmar que não há duas fatias/barras adjacentes indistinguíveis.
9. Exportar PNG de um gráfico no tema claro e no tema escuro — a imagem baixada usa as cores do tema ativo no momento do clique, sem preenchimento preto/ausente.
10. Com o tema em modo escuro na tela, clicar "Relatório / PDF" — o preview de impressão continua **claro** (sem regressão do tema de impressão existente).
11. Navegar só por Tab até o botão de tema — o anel de foco é visível nos dois temas (`--focus-ring`), contraste do próprio anel ≥ 3:1 contra a superfície ao redor.
12. PWA instalado (ou emulado): cor da barra de status/tema reflete o tema ativo (`#0b1120` escuro / `#f8fafc` claro) após uma troca manual.

---

## Resumo para quem só quer os fatos

Tokens em `data-theme` no `<html>`, mapeados via `@theme inline` do Tailwind v4 (mesmo padrão já usado por `--background`/`--foreground`) — nenhuma lógica de tema dentro dos componentes. Default continua escuro; primeira visita sem escolha salva respeita `prefers-color-scheme`; depois disso manda o `localStorage`. FE-7 fechado trocando os 4 tons de cinza fragmentados (`slate-300/400/500/600`) por 3 camadas semânticas (`primary`/`secondary`/`muted`) com valores recalculados para AA nos dois temas. Paleta de gráficos com 8 cores por tema, base Okabe-Ito (daltônico-friendly), `--chart-8` reservado a "Outros". Export PNG e impressão têm tratamento explícito para não quebrar com a virada de var() → hex.
