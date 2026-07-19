# ADR 0002 — Isolamento por herança: toda fonte estende BaseMetadataExtractor

- **Status:** Aceito
- **Data:** 2026-07-08
- **Contexto estrutural:** ponto de extensão de fontes de dados (decisão âncora nº 2)
- **Relacionado:** ADR 0001 (Privacidade Absoluta)

## Contexto

O produto aceita fontes de dados heterogêneas — CSV/XLSX/XLS, SQLite no
navegador, e bancos de servidor (Postgres/MySQL/SQL Server) — e o roadmap prevê
mais (APIs, n8n). Se cada conector implementasse a extração de metadados por
conta própria, a garantia da Privacidade Absoluta (ADR 0001) dependeria da
disciplina de quem escreve o conector: bastaria um novo extrator "esquecer" de
separar linhas de metadados para vazar dado bruto rumo à IA.

## Decisão

Existe uma classe abstrata única, `BaseMetadataExtractor` (`lib/data-parser.ts`),
que implementa **todo** o pipeline de extração de metadados (inferência de tipo,
estatísticas agregadas anônimas, capado/priorização). Uma fonte nova implementa
**apenas** `loadRawTable()` — devolver as linhas cruas — e herda de graça o
isolamento e o formato de `DatasetMetadata`. Fontes já em memória convergem por
`datasetFromTable()` / `MemoryTableExtractor`.

## Alternativas descartadas

- **Interface/contrato sem implementação compartilhada** — cada conector ainda
  reimplementaria a extração; a garantia voltaria a ser por disciplina.
- **Função utilitária livre que cada conector chama** — funciona, mas é opcional
  por natureza (dá para não chamar). A herança torna o isolamento a via padrão e
  única de construir uma fonte.

## Consequências

- **Positivas:** privacidade por construção, não por convenção — o caminho fácil
  é o caminho seguro. Um só lugar concentra a lógica de metadados (fácil de
  testar e auditar).
- **Aceitas (trade-off):** acoplamento de todas as fontes a uma classe base; uma
  mudança na base reverbera em todos os conectores (raio de explosão amplo,
  registrado no mapa do sistema). É o preço de ter uma fronteira única.
- **Regra de manutenção:** ao adicionar fonte, seguir a skill `nova-fonte-dados`
  e nunca criar um caminho de extração paralelo fora da base.
