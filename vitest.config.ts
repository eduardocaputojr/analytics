import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * QA-5 (baseline-qa.md): os testes de integração das rotas de API vivem ao
 * lado do handler (`app/api/**\/route.test.ts`, mesma convenção de colocação
 * de `lib/*.test.ts`). Duas mudanças mínimas de INFRA (não de lógica) foram
 * necessárias para isso funcionar, e nenhuma delas existia antes:
 *  - `resolve.alias`: as rotas importam via `@/lib/...` (alias só resolvido
 *    hoje pelo `tsconfig.json`/webpack do Next); o Vitest não lê `paths` do
 *    tsconfig sozinho, então sem este alias a importação do `route.ts` falha
 *    na resolução do módulo antes mesmo do teste rodar.
 *  - `include`: ampliado para também pegar `app/api/**\/route.test.ts`.
 */
export default defineConfig({
  test: {
    // happy-dom fornece File/FileReader para exercitar o parser ponta a ponta.
    environment: "happy-dom",
    include: ["lib/**/*.test.ts", "app/api/**/route.test.ts", "app/api/_lib/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
