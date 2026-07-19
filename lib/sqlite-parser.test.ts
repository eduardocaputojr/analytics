import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";
import { isSqliteFile, openSqliteFile } from "./sqlite-parser";

/**
 * sqlite-parser.test.ts — cobre a extração de metadados via SQLite (sql.js/WASM)
 * e a invariante de privacidade (linhas cruas só na memória do cliente).
 *
 * LIMITAÇÃO DE AMBIENTE: em produção o runtime sql.js é carregado por um
 * <script src="/sql-wasm.js"> injetado no DOM (loadSqlJs em sqlite-parser.ts),
 * que depende de um servidor HTTP servindo /public — inexistente no Vitest
 * (happy-dom não executa fetch de rede). Para exercitar o CAMINHO REAL de
 * `openSqliteFile`/`parseTable` (não um mock), carregamos o mesmo arquivo
 * `public/sql-wasm.js` diretamente do disco via `vm` e pré-atribuímos
 * `window.initSqlJs` — o `loadSqlJs()` de produção detecta isso e pula
 * inteiramente a injeção do <script> (mesmo runtime WASM real, só a forma de
 * carregar o script muda). O restante do fluxo (abrir DB, listar tabelas,
 * `parseTable` → `datasetFromTable`) roda exatamente como em produção.
 */

const SQL_WASM_JS = path.join(process.cwd(), "public", "sql-wasm.js");
const PUBLIC_DIR = path.join(process.cwd(), "public");
const HAS_SQL_WASM = fs.existsSync(SQL_WASM_JS);

/** Assinatura mínima do sql.js usada só para montar o arquivo .db do teste. */
interface TestSqlJsDb {
  run(sql: string): void;
  export(): Uint8Array;
  close(): void;
}
interface TestSqlJsStatic {
  Database: new () => TestSqlJsDb;
}
type TestInitSqlJs = (config?: { locateFile?: (f: string) => string }) => Promise<TestSqlJsStatic>;

beforeAll(async () => {
  if (!HAS_SQL_WASM) return;
  const src = fs.readFileSync(SQL_WASM_JS, "utf8");
  const sandbox: Record<string, unknown> = {
    console,
    process,
    require,
    Uint8Array,
    Promise,
    WebAssembly,
    TextDecoder,
    TextEncoder,
    __dirname: PUBLIC_DIR,
    __filename: SQL_WASM_JS,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const sandboxInitSqlJs = sandbox.initSqlJs as TestInitSqlJs;

  // window já existe globalmente (environment: happy-dom) — pré-atribuir
  // initSqlJs faz loadSqlJs() pular o <script src> (ver comentário acima).
  (window as unknown as { initSqlJs: TestInitSqlJs }).initSqlJs = () =>
    sandboxInitSqlJs({ locateFile: (f: string) => path.join(PUBLIC_DIR, f) });
});

/** Monta um arquivo .db real (bytes SQLite genuínos) usando o próprio sql.js. */
async function buildSqliteFile(): Promise<File> {
  const SQL = await (window as unknown as { initSqlJs: TestInitSqlJs }).initSqlJs();
  const db = new SQL.Database();
  db.run(
    "CREATE TABLE vendas (id INTEGER, regiao TEXT, preco REAL, foto BLOB); " +
      "CREATE TABLE vazio (id INTEGER);",
  );
  db.run("INSERT INTO vendas VALUES (1, 'Sul', 5.52, NULL)");
  db.run("INSERT INTO vendas VALUES (2, 'Norte', 4.0, NULL)");
  const bytes: Uint8Array = db.export();
  db.close();
  return new File([bytes], "clientes.db");
}

describe.skipIf(!HAS_SQL_WASM)("sqlite-parser — isSqliteFile", () => {
  it("reconhece extensões .db/.sqlite/.sqlite3, ignora as demais", () => {
    expect(isSqliteFile(new File([""], "clientes.db"))).toBe(true);
    expect(isSqliteFile(new File([""], "clientes.sqlite"))).toBe(true);
    expect(isSqliteFile(new File([""], "clientes.sqlite3"))).toBe(true);
    expect(isSqliteFile(new File([""], "clientes.csv"))).toBe(false);
  });
});

describe.skipIf(!HAS_SQL_WASM)("sqlite-parser — extração via sql.js (runtime real)", () => {
  it("lista as tabelas do arquivo com contagem de linhas", async () => {
    const file = await buildSqliteFile();
    const session = await openSqliteFile(file);
    try {
      const names = session.tables.map((t) => t.name).sort();
      expect(names).toEqual(["vazio", "vendas"]);
      expect(session.tables.find((t) => t.name === "vendas")?.rowCount).toBe(2);
    } finally {
      session.close();
    }
  });

  it("parseTable devolve ParsedDataset: metadados + linhas só em memória", async () => {
    const file = await buildSqliteFile();
    const session = await openSqliteFile(file);
    try {
      const dataset = session.parseTable("vendas");

      // Linhas ficam disponíveis para o dashboard local...
      expect(dataset.rows).toHaveLength(2);
      expect(dataset.rows[0].regiao).toBe("Sul");
      expect(dataset.rows[0].preco).toBe(5.52);

      // ...mas os METADADOS (única coisa que pode ir para a IA) descrevem só
      // o esquema/estatísticas agregadas (min/max/mean são números legítimos
      // aqui) — nenhum valor de CATEGORIA/TEXTO de célula sobrevive.
      const meta = dataset.metadata;
      const serialized = JSON.stringify(meta);
      expect(serialized).not.toContain("Sul");
      expect(serialized).not.toContain("Norte");
      expect((meta as unknown as { rows?: unknown }).rows).toBeUndefined();

      const regiao = meta.columns.find((c) => c.name === "regiao");
      expect(regiao?.type).toBe("string");
      const preco = meta.columns.find((c) => c.name === "preco");
      expect(preco?.type).toBe("number");
      expect(preco?.stats).toMatchObject({ kind: "number", min: 4.0, max: 5.52 });
    } finally {
      session.close();
    }
  });

  it("coluna BLOB vira ausência (null), não quebra a extração", async () => {
    const file = await buildSqliteFile();
    const session = await openSqliteFile(file);
    try {
      const dataset = session.parseTable("vendas");
      const foto = dataset.metadata.columns.find((c) => c.name === "foto");
      expect(foto?.nullCount).toBe(2); // sem BLOB nas linhas de teste → tudo NULL
      expect(dataset.rows.every((r) => r.foto === null)).toBe(true);
    } finally {
      session.close();
    }
  });

  it("anti-injeção: só aceita nome de tabela vindo da própria introspecção", async () => {
    const file = await buildSqliteFile();
    const session = await openSqliteFile(file);
    try {
      expect(() => session.parseTable("vendas; DROP TABLE vendas;--")).toThrow();
    } finally {
      session.close();
    }
  });

  it("arquivo sem tabelas legíveis é rejeitado", async () => {
    const SQL = await (window as unknown as { initSqlJs: TestInitSqlJs }).initSqlJs();
    const db = new SQL.Database();
    const bytes: Uint8Array = db.export();
    db.close();
    const file = new File([bytes], "vazio.db");
    await expect(openSqliteFile(file)).rejects.toThrow();
  });
});
