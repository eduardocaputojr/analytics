# ADR 0009 — xlsx via tarball oficial da SheetJS (não o pacote do npm)

- **Status:** Aceito
- **Data:** 2026-07-08
- **Contexto estrutural:** cadeia de dependências / superfície de ataque

## Contexto

A leitura de planilhas XLSX/XLS no cliente usa a SheetJS. O pacote publicado no
registro do npm como `xlsx` está congelado na versão **0.18.5**, que tem CVE
**high** sem correção disponível no npm: Prototype Pollution e ReDoS. A própria
SheetJS parou de publicar no npm e distribui as versões novas (com o fix) apenas
pelo seu **CDN oficial**. A meta de segurança do projeto é `npm audit
--omit=dev` **sem `high`**, e planilhas são justamente entrada de arquivo não
confiável — o vetor onde um parser vulnerável mais dói.

## Decisão

Depender do **tarball oficial da SheetJS** apontando o `package.json` para a URL
do CDN:

```
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

Não usar o pacote `xlsx` do npm. Não adicionar dependência de produção nova sem
`npm audit` limpo ou justificativa registrada.

## Alternativas descartadas

- **`xlsx@0.18.5` do npm** — carrega o CVE high sem fix; reprovado pela meta de
  audit.
- **Trocar de biblioteca de planilha** — SheetJS é a referência para o formato;
  migrar teria custo alto e risco de regressão de parsing sem ganho de segurança
  frente à versão corrigida do próprio autor.

## Consequências

- **Positivas:** parser de planilha na versão corrigida; `npm audit --omit=dev`
  fica sem `high` (restam só 2 `moderate` do `postcss` transitivo do Next, sem
  fix não-breaking, acompanhados).
- **Aceitas (trade-off):** a dependência vem de URL de CDN, não do registro npm —
  instalação depende do CDN da SheetJS estar acessível e a versão é fixada à mão
  (sem `^`), então atualizar exige trocar a URL conscientemente. É o preço de ter
  o fix que o npm não oferece.
