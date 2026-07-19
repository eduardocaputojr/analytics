# ADR 0004 — Dois motores de IA comutáveis atrás de um contrato único

- **Status:** Aceito
- **Data:** 2026-07-08
- **Contexto estrutural:** fronteira de integração com IA
- **Relacionado:** ADR 0001, ADR 0003

## Contexto

O público precisa de duas realidades opostas: usuários com dados sensíveis ou
sem internet querem inferência **100% local**; usuários em celular ou sem
hardware querem algo que **simplesmente funcione na nuvem**. Amarrar o app a um
único provedor excluiria metade do público, e espalhar a lógica de cada motor
pela aplicação criaria dois caminhos divergentes difíceis de manter isolados.

## Decisão

Dois motores comutáveis pela interface, cada um numa rota fina e simétrica:

- **Local** — `/api/analyze/local` fala com o **Ollama** (`localhost:11434`,
  `llama3.2:3b` por padrão), offline.
- **Nuvem** — `/api/analyze/cloud` fala com o **Gemini** (`gemini-2.5-flash`),
  saída JSON forçada.

As duas rotas têm a **mesma espinha**: `validateMetadataPayload` (ADR 0003) →
prompt de `lib/prompt-builder.ts` (`SYSTEM_PROMPT` compartilhado) → chamada ao
motor com JSON estrito → `safeParseJson` + `normalizeCharts`. Ambas devolvem o
**mesmo contrato** ao cliente (`AnalysisResult` / `ChartSpec[]`), de modo que a
página e o dashboard não sabem — nem precisam saber — qual motor rodou.

## Alternativas descartadas

- **Só nuvem** — inviabiliza dados sensíveis/offline e o desktop realmente local.
- **Só local** — inviabiliza celular e máquinas fracas.
- **Abstração de "provider" plugável genérica** — over-engineering para dois
  casos; duas rotas simétricas com lógica comum em `lib/` já dão o isolamento sem
  a indireção.

## Consequências

- **Positivas:** o cliente é agnóstico ao motor; adicionar um terceiro motor é
  criar uma rota que reusa a mesma espinha (ver README, seção "Estendendo").
  Custo e privacidade idênticos entre motores porque o payload é o mesmo (só
  esquema).
- **Aceitas (trade-off):** manter duas integrações (SDK Gemini + HTTP do Ollama)
  e suas particularidades de setup — mitigado por o Ollama ser instalado/iniciado
  pela própria UI (`/api/ollama/*`) e o Gemini exigir só a chave em `.env.local`.
- **Regra:** o formato de saída (`ChartSpec`) é a fronteira; nenhum motor deve
  vazar detalhe próprio para além de `normalizeCharts`.
