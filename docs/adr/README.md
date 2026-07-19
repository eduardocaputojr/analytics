# Registro de Decisões de Arquitetura (ADRs)

Cada ADR registra **uma decisão estrutural** do IA Analytics Pro no formato curto
de Nygard: **Contexto → Decisão → Alternativas → Consequências**. São as escolhas
que mais restringem o sistema — as que um colaborador (ou o autor em 6 meses)
poderia "corrigir" sem perceber que são deliberadas. Antes de reverter uma regra
descrita aqui, leia o ADR: ele diz *por que* ela existe e *o que* aceitamos em
troca.

> ADRs são **imutáveis por natureza**: não se reescreve um ADR aceito. Se uma
> decisão mudar, cria-se um ADR novo com status `Substitui NNNN` e marca-se o
> antigo como `Substituído`.

## Índice

| # | Decisão | Área |
|---|---------|------|
| [0001](0001-privacidade-absoluta-so-metadados.md) | Privacidade Absoluta: só metadados atravessam a rede | Privacidade (âncora) |
| [0002](0002-isolamento-por-heranca-basemetadataextractor.md) | Isolamento por herança: toda fonte estende `BaseMetadataExtractor` | Extensão de fontes |
| [0003](0003-blindagem-payload-allowlist-positiva.md) | Blindagem de payload da IA por allowlist positiva | Privacidade / rotas |
| [0004](0004-dois-motores-ia-comutaveis-analysisresult.md) | Dois motores de IA comutáveis atrás de um contrato único | Integração com IA |
| [0005](0005-gate-localhost-valida-valor-forwarded.md) | Gate localhost valida o VALOR dos `x-forwarded-*`, não a presença | Segurança de rede |
| [0006](0006-unificacao-linha-area-chart-rules.md) | Unificação linha→área e `chart-rules.ts` como fonte única de coerção | Gráficos / legibilidade |
| [0007](0007-heuristica-virgula-milhar.md) | Heurística de vírgula-milhar (`"3,500"` = 3500) | Parsing numérico |
| [0008](0008-output-standalone-wrapper-env-local.md) | `output: standalone` + wrapper de `.env.local` | Infraestrutura / execução |
| [0009](0009-xlsx-tarball-oficial-sheetjs.md) | `xlsx` via tarball oficial da SheetJS (não o pacote do npm) | Dependências / segurança |

## Como adicionar um ADR

1. Copie o formato de um ADR existente. Numere com o próximo inteiro (`NNNN`),
   nome de arquivo em `kebab-case`.
2. Preencha **Contexto** (a força que empurra a decisão), **Decisão** (o que foi
   escolhido, no presente), **Alternativas** (o que foi descartado e por quê) e
   **Consequências** (positivas e os trade-offs aceitos).
3. Registre no índice acima. Um ADR nasce `Aceito`; se substituir outro, referencie.

## Ver também

- [ARCHITECTURE.md](../ARCHITECTURE.md) — stack, fluxo de dados e módulos.
- [SECURITY.md](../SECURITY.md) — modelo de segurança e privacidade em detalhe.
- `docs/mapa-do-sistema.md` e `docs/journal.md` — raio-x
  arquitetural e o log de decisões que originaram vários destes ADRs.
