---
name: nova-fonte-dados
description: Checklist para adicionar uma nova fonte de dados (banco, API, arquivo, n8n…) ao IA Analytics Pro preservando a Privacidade Absoluta. Use quando pedirem para suportar um novo formato/banco/integração de dados.
---

# Nova fonte de dados — preservando a Privacidade Absoluta

Toda fonte nova DEVE convergir no pipeline único de metadados. Siga:

## 1. Decida ONDE a fonte é lida
- **Arquivo que o usuário possui** (ex.: SQLite, Parquet): leia 100% NO NAVEGADOR
  (padrão `lib/sqlite-parser.ts` — runtime WASM auto-hospedado em `public/`).
- **Serviço de rede** (ex.: banco, API): leia no SERVIDOR LOCAL
  (padrão `lib/db-connectors.ts` + rotas em `app/api/db/*`).

## 2. Converja no pipeline único
- Materialize a tabela crua e chame `datasetFromTable(source, format, headers, rows)`
  de `lib/data-parser.ts` (ou estenda `BaseMetadataExtractor`).
- NUNCA compute metadados por conta própria nem envie linhas em payload de IA.
- Se precisar de um novo `sourceFormat`, adicione ao union em `lib/types.ts`.

## 3. Regras server-side obrigatórias (fontes de rede)
- Gate de rede: use `isDbAccessAllowed`/`isLocalRequest` de `lib/server-guards.ts`.
- Identificadores (tabela/coleção/endpoint) validados contra a INTROSPECÇÃO da
  própria fonte antes de qualquer consulta; quoting por dialeto.
- Sempre com teto de linhas (`clampLimit`), timeout de conexão e de consulta.
- Erros passam por `safeDbErrorMessage` — jamais ecoar credenciais.
- Credenciais só server-side; UI recomenda usuário somente-leitura.
- Driver npm novo → adicionar a `serverExternalPackages` no `next.config.ts`
  e rodar `npm audit`.

## 4. UI
- Fonte de arquivo → estender o `UploadZone` (accept + parser).
- Fonte de rede → aba/painel próprio no padrão do `DbConnectPanel`
  (conectar → listar → escolher → carregar com limite).
- Ambos chamam `onParsed(ParsedDataset)` — todo o dashboard funciona de graça.

## 5. Testes (mínimo)
- Tipos inferidos corretos para a nova fonte.
- Invariante de privacidade: `JSON.stringify(metadata)` NÃO contém valores de células.
- Saneamento: quoting de identificadores, clamp de limite, mensagens sem credencial.

## 6. Finalize
- Atualize CLAUDE.md (mapa de arquivos) e README (fontes suportadas).
- Rode a skill `qa-completo` antes do commit.
