// fake-indexeddb polyfilla globalThis.indexedDB — happy-dom (ambiente do
// vitest.config.ts) não implementa IndexedDB, então os testes de BE-5/BE-7
// (que exercitam saveAnalysis/getAnalysis DE VERDADE, não só a lógica pura de
// analysisId) precisam de uma implementação real da API para valer como
// verificação executável.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DB_NAME,
  analysisId,
  deleteAnalysis,
  getAnalysis,
  runMigrations,
  saveAnalysis,
  type SavedAnalysis,
} from "./analysis-store";
import type { DatasetMetadata } from "./types";

function meta(over: Partial<DatasetMetadata> = {}): DatasetMetadata {
  return {
    source: "vendas.csv",
    sourceFormat: "csv",
    rowCount: 100,
    columnCount: 2,
    generatedAt: new Date().toISOString(),
    columns: [
      { name: "cidade", index: 0, type: "string", count: 100, nullCount: 0, uniqueCount: 5 },
      { name: "valor", index: 1, type: "number", count: 100, nullCount: 0, uniqueCount: 90 },
    ],
    ...over,
  };
}

describe("analysis-store — analysisId (id estável para reabrir/deduplicar)", () => {
  it("é o MESMO para o mesmo dataset (ignora o carimbo generatedAt)", () => {
    expect(analysisId(meta())).toBe(analysisId(meta({ generatedAt: "2020-01-01" })));
  });

  it("MUDA quando a forma muda (origem, nº de linhas ou esquema)", () => {
    const base = analysisId(meta());
    expect(analysisId(meta({ source: "outro.csv" }))).not.toBe(base);
    expect(analysisId(meta({ rowCount: 200 }))).not.toBe(base);
    expect(
      analysisId(meta({ columns: meta().columns.slice(0, 1), columnCount: 1 })),
    ).not.toBe(base);
  });

  it("é uma chave curta e segura", () => {
    expect(analysisId(meta())).toMatch(/^a[0-9a-z]+$/);
  });
});

/**
 * Apaga o banco entre testes — isola cada teste (fake-indexeddb persiste no
 * processo, não por teste, ao contrário do IndexedDB real de um navegador).
 * NUNCA resolve em `onblocked`: por spec, isso só significa que a exclusão
 * está ADIADA até as conexões abertas fecharem — `onsuccess` ainda vai disparar
 * depois. Tratar `onblocked` como sucesso deixava um banco "fantasma" (versão
 * residual de um teste anterior) que corrompia o teste de migração seguinte.
 */
function resetDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Falha ao apagar o IndexedDB de teste."));
  });
}

function record(over: Partial<SavedAnalysis> = {}): SavedAnalysis {
  const m = meta();
  return {
    id: analysisId(m),
    name: "vendas.csv",
    sourceFormat: m.sourceFormat,
    rowCount: m.rowCount,
    columnCount: m.columnCount,
    createdAt: 1_000,
    updatedAt: 1_000,
    metadata: m,
    rows: [{ cidade: "SP", valor: 10 }],
    result: null,
    ...over,
  };
}

describe("analysis-store — saveAnalysis preserva createdAt (BE-5)", () => {
  beforeEach(resetDb);
  afterEach(resetDb);

  it("createdAt do PRIMEIRO save é preservado ao resalvar o MESMO dataset", async () => {
    const first = record({ createdAt: 1_000, updatedAt: 1_000, name: "vendas (1ª análise)" });
    await saveAnalysis(first);

    // Mesmo id (mesma forma de dataset) — reanalisar/resalvar não pode
    // sobrescrever a data de criação original, só `updatedAt` avança.
    const second = record({ createdAt: 9_999, updatedAt: 9_999, name: "vendas (reanalisada)" });
    await saveAnalysis(second);

    const loaded = await getAnalysis(first.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.createdAt).toBe(1_000);
    expect(loaded?.updatedAt).toBe(9_999);
    expect(loaded?.name).toBe("vendas (reanalisada)");
  });

  it("primeiro save de um id NOVO usa o createdAt informado (nada para preservar)", async () => {
    const first = record({ createdAt: 42, updatedAt: 42 });
    await saveAnalysis(first);
    const loaded = await getAnalysis(first.id);
    expect(loaded?.createdAt).toBe(42);
  });

  it("deleteAnalysis remove o registro — um save seguinte volta a ser 'novo'", async () => {
    const first = record({ createdAt: 1, updatedAt: 1 });
    await saveAnalysis(first);
    await deleteAnalysis(first.id);

    const again = record({ createdAt: 777, updatedAt: 777 });
    await saveAnalysis(again);
    const loaded = await getAnalysis(again.id);
    expect(loaded?.createdAt).toBe(777);
  });
});

describe("analysis-store — migração de versão do IndexedDB (BE-7)", () => {
  beforeEach(resetDb);
  afterEach(resetDb);

  it("runMigrations aplica em ORDEM só as migrações no intervalo (oldVersion, newVersion]", () => {
    const applied: number[] = [];
    const migrations = {
      1: () => applied.push(1),
      2: () => applied.push(2),
      3: () => applied.push(3),
    };
    const dbStub = {} as IDBDatabase;
    const txStub = {} as IDBTransaction;

    runMigrations(dbStub, txStub, 0, 3, migrations);
    expect(applied).toEqual([1, 2, 3]);
  });

  it("runMigrations NÃO reaplica versões já migradas (oldVersion exclusive)", () => {
    const applied: number[] = [];
    const migrations = { 1: () => applied.push(1), 2: () => applied.push(2) };
    const dbStub = {} as IDBDatabase;
    const txStub = {} as IDBTransaction;

    // Banco já está na versão 1 (oldVersion=1) subindo para 2 — só a
    // migração 2 deve rodar; a 1 já foi aplicada em algum momento passado.
    runMigrations(dbStub, txStub, 1, 2, migrations);
    expect(applied).toEqual([2]);
  });

  it("runMigrations não quebra quando não há migração registrada para uma versão intermediária", () => {
    const applied: number[] = [];
    const migrations = { 3: () => applied.push(3) };
    const dbStub = {} as IDBDatabase;
    const txStub = {} as IDBTransaction;

    expect(() => runMigrations(dbStub, txStub, 1, 3, migrations)).not.toThrow();
    expect(applied).toEqual([3]);
  });

  it("dado sobrevive quando o banco é reaberto numa versão futura (onupgradeneeded resiliente)", async () => {
    // Banco ISOLADO (não o DB_NAME real) — evita qualquer interferência com o
    // estado que as outras describes desta suíte deixam no "ia-analytics"
    // compartilhado; exercita a MESMA `runMigrations` que `openDb()` usa.
    const testDbName = "ia-analytics-be7-migration-test";
    const STORE = "analyses";

    async function wipe(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(testDbName);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error("falha ao apagar"));
      });
    }
    await wipe();

    // "Versão 1" do app: cria o schema (via runMigrations) e grava 1 registro.
    const db1 = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(testDbName, 1);
      req.onupgradeneeded = (event) => {
        runMigrations(req.result, req.transaction as IDBTransaction, event.oldVersion, 1, {
          1: (db) => db.createObjectStore(STORE, { keyPath: "id" }),
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db1.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ id: "a1", name: "vendas", createdAt: 5 });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db1.close();

    // "Versão 2" (schema evoluindo): reabre o MESMO banco numa versão maior —
    // ainda sem nenhuma migração registrada para ela, só para provar que o
    // upgrade NÃO apaga/corrompe o object store e os dados existentes.
    let observedOldVersion = -1;
    const db2 = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(testDbName, 2);
      req.onupgradeneeded = (event) => {
        observedOldVersion = event.oldVersion;
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(observedOldVersion).toBe(1);

    const loaded = await new Promise<unknown>((resolve, reject) => {
      const req = db2.transaction(STORE).objectStore(STORE).get("a1");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db2.close();
    expect(loaded).toMatchObject({ id: "a1", name: "vendas", createdAt: 5 });

    await wipe();
  });
});
