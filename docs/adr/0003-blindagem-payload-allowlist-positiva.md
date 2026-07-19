# ADR 0003 — Blindagem de payload da IA por allowlist positiva

- **Status:** Aceito
- **Data:** 2026-07-08
- **Contexto estrutural:** guardião da fronteira nas rotas de IA (SEC-1)
- **Relacionado:** ADR 0001 (Privacidade Absoluta)

## Contexto

A ADR 0001 estabelece que só metadados podem sair. Na prática, quem impõe isso é
`validateMetadataPayload` (`lib/analysis.ts`), compartilhada pelas duas rotas de
análise. A primeira versão barrava apenas quatro chaves fixas de primeiro nível
(`rows`/`data`/`values`/`records`) por **negação** (blocklist). Uma auditoria
mostrou a fragilidade: uma chave renomeada (`sampleRows`, `cells`) ou aninhada
dentro de `metadata.columns[]` **escapava** e seguia para a IA. Uma blocklist
protege só contra o que já se conhece.

## Decisão

Inverter a lógica para **allowlist positiva**: a rota **reconstrói**
`DatasetMetadata` campo a campo a partir do corpo recebido (`reconstructMetadata`),
copiando **apenas** os campos conhecidos do esquema — qualquer chave desconhecida,
em qualquer profundidade, simplesmente **não sobrevive à reconstrução**. Um scan
recursivo de chaves proibidas (`findForbiddenKeyDeep`, case-insensitive) fica como
camada de defesa-em-profundidade que dá erro explícito cedo, mas a garantia real é
estrutural: o que não está na allowlist não é copiado, encontre o scan ou não.

## Alternativas descartadas

- **Ampliar a blocklist** — corrida armamentista infinita contra nomes novos de
  campo; nunca fecha o buraco de aninhamento.
- **Validar por schema (ex.: zod) sem reconstruir** — bom para forma, mas
  `passthrough`/campos extras exigem cuidado; reconstruir explicitamente é mais
  simples de auditar ("olhe o que é copiado") e não depende de config de strip.

## Consequências

- **Positivas:** vazamento por campo desconhecido torna-se impossível por
  construção, não por lista. Ponto único e auditável para as duas rotas.
- **Aceitas (trade-off):** um campo **novo e legítimo** de metadados só passa a
  trafegar depois de ser adicionado explicitamente à reconstrução — é fricção
  deliberada (falha fechada, o padrão seguro).
- **Testes** em `lib/*.test.ts` fixam a invariante; mudança no formato de
  metadados exige atualizar a reconstrução e os testes juntos.
