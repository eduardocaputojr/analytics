/**
 * analysis-store.ts — Persistência LOCAL de análises (IndexedDB).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ PRIVACIDADE ABSOLUTA: as linhas brutas ficam SOMENTE aqui, no IndexedDB do  ║
 * ║ navegador (origem local — desktop/PWA/web). Nada é enviado à rede; reabrir   ║
 * ║ uma análise é 100% local, sem repassar dados a nenhum serviço.              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Por que IndexedDB (e não um SQLite de servidor): funciona nas TRÊS formas de
 * execução (web, PWA no celular e desktop) sem processo extra, guarda dezenas de
 * milhares de linhas via structured clone e mantém tudo na máquina do usuário.
 *
 * Modelo: dois object stores no mesmo banco —
 *   - "analyses": metadados + resultado da IA (LEVE, para a lista de recentes);
 *   - "rows":     as linhas brutas por id (PESADO, carregado só ao reabrir).
 */

import type { AnalysisResult, DataRow, DatasetMetadata } from "./types";

/** Exportados só para os testes de migração (BE-7) referenciarem sem duplicar
 *  o literal — nenhum consumidor de produção precisa deles. */
export const DB_NAME = "ia-analytics";
export const DB_VERSION = 1;
const META_STORE = "analyses";
const ROWS_STORE = "rows";

/**
 * BE-7 — Caminho de migração de schema do IndexedDB.
 *
 * Cada entrada é a migração que leva o banco ATÉ aquela versão (chave =
 * versão-alvo). `onupgradeneeded` roda TODAS as migrações entre
 * `event.oldVersion` (exclusive) e `event.newVersion` (inclusive), em ordem —
 * então subir de N para N+2 aplica as migrações N+1 e N+2, sem pular nenhuma.
 *
 * Regras para qualquer migração futura (registrar aqui, nunca no `onupgradeneeded`
 * direto):
 *   1) NUNCA apagar um object store/índice que já tem dados do usuário sem
 *      antes copiar/transformar o que precisa ser preservado.
 *   2) Transformações de registro (novo campo obrigatório, mudança de forma)
 *      usam o MESMO `tx` da migração (o único disponível dentro de
 *      `onupgradeneeded`) via cursor — nunca abrir uma transação nova aqui.
 *   3) Migração é idempotente-safe: só mexe no que `oldVersion` ainda não tem.
 */
type Migration = (db: IDBDatabase, tx: IDBTransaction) => void;

const MIGRATIONS: Record<number, Migration> = {
  1: (db) => {
    if (!db.objectStoreNames.contains(META_STORE)) {
      db.createObjectStore(META_STORE, { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains(ROWS_STORE)) {
      db.createObjectStore(ROWS_STORE, { keyPath: "id" });
    }
  },
  // Próxima migração de schema entra aqui como `2: (db, tx) => { ... }`.
};

/**
 * Aplica, em ordem, toda migração entre `oldVersion` (exclusive) e
 * `newVersion` (inclusive) — nunca perde dados de versões intermediárias.
 * `migrations` é injetável (default: `MIGRATIONS`) só para os testes
 * exercitarem a lógica de sequenciamento sem depender do schema real.
 */
export function runMigrations(
  db: IDBDatabase,
  tx: IDBTransaction,
  oldVersion: number,
  newVersion: number,
  migrations: Record<number, Migration> = MIGRATIONS,
): void {
  for (let version = oldVersion + 1; version <= newVersion; version++) {
    migrations[version]?.(db, tx);
  }
}

/** Mantém só as N análises mais recentes (poda as antigas ao salvar). */
export const MAX_ANALYSES = 20;

/** Registro completo de uma análise salva (com as linhas brutas). */
export interface SavedAnalysis {
  id: string;
  name: string;
  sourceFormat: DatasetMetadata["sourceFormat"];
  rowCount: number;
  columnCount: number;
  createdAt: number;
  updatedAt: number;
  metadata: DatasetMetadata;
  rows: DataRow[];
  result: AnalysisResult | null;
  businessContext?: string;
}

/** Parte leve (sem linhas) guardada no store "analyses". */
type StoredMeta = Omit<SavedAnalysis, "rows">;

/** Resumo para a lista de recentes (sem linhas nem metadados pesados). */
export interface SavedAnalysisSummary {
  id: string;
  name: string;
  sourceFormat: DatasetMetadata["sourceFormat"];
  rowCount: number;
  columnCount: number;
  createdAt: number;
  updatedAt: number;
  engine?: AnalysisResult["engine"];
  model?: string;
}

/** IndexedDB disponível? (SSR e navegadores muito antigos não têm.) */
export function isPersistenceAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/**
 * Id ESTÁVEL derivado da forma do dataset (origem + nº de linhas + esquema).
 * Reabrir/reanalisar o mesmo arquivo atualiza o MESMO registro (sem duplicar).
 */
export function analysisId(metadata: DatasetMetadata): string {
  const basis = `${metadata.source}|${metadata.rowCount}|${metadata.columns
    .map((column) => `${column.name}:${column.type}`)
    .join(",")}`;
  let hash = 5381;
  for (let i = 0; i < basis.length; i++) {
    hash = ((hash << 5) + hash + basis.charCodeAt(i)) >>> 0; // djb2
  }
  return `a${hash.toString(36)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isPersistenceAvailable()) {
      reject(new Error("IndexedDB indisponível neste ambiente."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      // `transaction` só é null se o browser não suportar `onupgradeneeded`
      // corretamente — nunca deveria acontecer em ambiente real; sem ela não
      // há como migrar dados existentes com segurança, então preferimos não
      // aplicar migração alguma a corromper o schema.
      if (!tx) return;
      runMigrations(db, tx, event.oldVersion, event.newVersion ?? DB_VERSION);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao abrir o IndexedDB."));
  });
}

function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Requisição IndexedDB falhou."));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Transação IndexedDB falhou."));
    tx.onabort = () => reject(tx.error ?? new Error("Transação IndexedDB abortada."));
  });
}

/**
 * Salva (ou atualiza) uma análise. Escreve o meta leve e as linhas em stores
 * separados, e poda as mais antigas além de MAX_ANALYSES.
 */
export async function saveAnalysis(record: SavedAnalysis): Promise<void> {
  const db = await openDb();
  try {
    const { rows, ...meta } = record;
    const tx = db.transaction([META_STORE, ROWS_STORE], "readwrite");
    const metaStore = tx.objectStore(META_STORE);

    // BE-5: o id é ESTÁVEL por forma do dataset (analysisId) — reanalisar ou
    // resalvar o MESMO dataset não pode sobrescrever a data de criação real
    // da primeira vez. Só `updatedAt` avança a cada save.
    const existing = (await toPromise(metaStore.get(record.id))) as StoredMeta | undefined;
    const resolvedMeta: StoredMeta = {
      ...meta,
      createdAt: existing?.createdAt ?? meta.createdAt,
    };

    metaStore.put(resolvedMeta satisfies StoredMeta);
    tx.objectStore(ROWS_STORE).put({ id: record.id, rows });
    await done(tx);
    await pruneOld(db);
  } finally {
    db.close();
  }
}

/** Lista os resumos das análises salvas (mais recentes primeiro). */
export async function listAnalyses(): Promise<SavedAnalysisSummary[]> {
  const db = await openDb();
  try {
    const all = (await toPromise(
      db.transaction(META_STORE).objectStore(META_STORE).getAll(),
    )) as StoredMeta[];
    return all
      .map((meta) => ({
        id: meta.id,
        name: meta.name,
        sourceFormat: meta.sourceFormat,
        rowCount: meta.rowCount,
        columnCount: meta.columnCount,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        engine: meta.result?.engine,
        model: meta.result?.model,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

/** Carrega uma análise completa (com as linhas) para reabrir o dashboard. */
export async function getAnalysis(id: string): Promise<SavedAnalysis | null> {
  const db = await openDb();
  try {
    const meta = (await toPromise(
      db.transaction(META_STORE).objectStore(META_STORE).get(id),
    )) as StoredMeta | undefined;
    if (!meta) return null;
    const rowsRecord = (await toPromise(
      db.transaction(ROWS_STORE).objectStore(ROWS_STORE).get(id),
    )) as { id: string; rows: DataRow[] } | undefined;
    return { ...meta, rows: rowsRecord?.rows ?? [] };
  } finally {
    db.close();
  }
}

/** Remove uma análise (meta + linhas). */
export async function deleteAnalysis(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([META_STORE, ROWS_STORE], "readwrite");
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(ROWS_STORE).delete(id);
    await done(tx);
  } finally {
    db.close();
  }
}

/** Poda as análises além de MAX_ANALYSES (mantém as mais recentes). */
async function pruneOld(db: IDBDatabase): Promise<void> {
  const all = (await toPromise(
    db.transaction(META_STORE).objectStore(META_STORE).getAll(),
  )) as StoredMeta[];
  if (all.length <= MAX_ANALYSES) return;
  const stale = all
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(MAX_ANALYSES);
  const tx = db.transaction([META_STORE, ROWS_STORE], "readwrite");
  for (const meta of stale) {
    tx.objectStore(META_STORE).delete(meta.id);
    tx.objectStore(ROWS_STORE).delete(meta.id);
  }
  await done(tx);
}
