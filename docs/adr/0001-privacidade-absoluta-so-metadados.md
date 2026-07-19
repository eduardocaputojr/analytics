# ADR 0001 — Privacidade Absoluta: só metadados atravessam a rede

- **Status:** Aceito
- **Data:** 2026-07-08
- **Contexto estrutural:** fronteira dados/metadados (decisão âncora nº 1)

## Contexto

O produto pede que a IA sugira gráficos sobre planilhas e bancos do usuário —
frequentemente dados sensíveis (financeiros, pessoais, operacionais). O caminho
óbvio de mercado é enviar amostras de linhas ao modelo "para contexto". Isso
cria dois problemas inaceitáveis para o público-alvo (uso empresarial, dados de
terceiros): vazamento de dados brutos para serviços externos e custo de tokens
proporcional ao volume de dados.

## Decisão

A IA atua **exclusivamente sobre metadados**: nomes de coluna, tipos inferidos e
estatísticas agregadas anônimas (mín/máx/média, contagens, limites de data,
comprimentos de texto). Os **valores de célula nunca cruzam a fronteira de
rede**. O fluxo é:

```
arquivo/banco → lib/data-parser.ts → DatasetMetadata (só esquema+stats)
             → /api/analyze/* → IA devolve ChartSpec[] (por NOME de coluna)
             → cliente funde a spec com as linhas que ficaram só na memória
```

As linhas brutas vivem apenas na memória do navegador (e, ao salvar, no
IndexedDB local do próprio dispositivo).

## Alternativas descartadas

- **Enviar amostras de linhas à IA** — melhora marginalmente a sugestão, mas
  quebra a invariante central e infla o custo. Rejeitado sem exceção.
- **Anonimização/mascaramento de valores antes de enviar** — superfície de erro
  grande (o que conta como sensível?) e ainda trafega dado. Metadados-only é
  categórico e auditável; mascarar é probabilístico.

## Consequências

- **Positivas:** privacidade por construção; custo por análise em poucas centenas
  de tokens; a mesma arquitetura serve web, PWA e desktop sem mudança.
- **Aceitas (trade-off):** a IA "enxerga" menos, então a qualidade da sugestão
  depende de bons metadados e de heurísticas locais (`suggestCharts`) que
  complementam sem custo. Contexto de negócio é passado só como texto opcional
  curto, nunca como dados.
- **Restrição que se propaga:** toda feature nova que fale com IA herda esta
  regra. Ver ADR 0002 (isolamento por herança) e ADR 0003 (blindagem de payload)
  — são os mecanismos que a tornam impossível de violar por descuido.
