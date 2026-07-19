# ADR 0007 — Heurística de vírgula-milhar ("3,500" = 3500)

- **Status:** Aceito
- **Data:** 2026-07-08
- **Contexto estrutural:** parsing numérico sensível a locale (fonte única · IA-3)

## Contexto

`lib/number-utils.ts` (`parseLocaleNumber`) é a **fonte única** de "isto é
número?" no projeto — `data-parser`, `chart-data` e `dashboard-utils` delegam a
ela. O público é pt-BR, onde a vírgula é decimal (`"5,52"` = 5.52). Mas os dados
vêm de qualquer lugar: exports de SQL Server e sistemas en-US produzem milhar com
vírgula (`"3,500"` = três mil e quinhentos). Interpretar `"3,500"` como decimal
pt-BR (3.5) é uma distorção **silenciosa de 1000×** — o pior tipo de bug num
produto de análise, porque o número parece plausível e ninguém percebe.

## Decisão

Vírgula única seguida de **exatamente 3 dígitos** → milhar en-US
(`"3,500"`→3500, `"1,234"`→1234). Os demais casos seguem decimal pt-BR
(`"5,52"`→5.52). A regra espelha a heurística já usada para o ponto único e
mantém: texto com letras continua não-número; moeda e percentual reconhecidos.

## Alternativas descartadas

- **Detecção por coluna inteira** (olhar todos os valores para decidir o locale
  da coluna) — mais correta, porém invasiva: mudaria a assinatura de
  `parseLocaleNumber`, usada por três módulos. Fora de escopo para o ganho.
- **Manter o comportamento antigo** (vírgula sempre decimal) — o erro é mais
  provável e mais grave: um decimal pt-BR com exatas 3 casas depois da vírgula é
  raríssimo, enquanto milhar en-US com 3 dígitos é comum.

## Consequências

- **Positivas:** exports en-US "simplesmente funcionam" sem o usuário configurar
  locale; a fonte única continua sendo o único lugar que decide o que é número.
- **Aceitas (trade-off):** um valor pt-BR legítimo do tipo `"1,234"` querendo
  dizer 1.234 (um vírgula duzentos e trinta e quatro) seria lido como 1234 — caso
  raro e assumido conscientemente; a heurística escolhe o erro menos provável.
- **Regra:** nunca reimplementar parsing numérico em outro módulo — estender
  sempre `parseLocaleNumber`.
