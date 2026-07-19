# ADR 0005 — Gate localhost valida o VALOR dos x-forwarded-*, não a presença

- **Status:** Aceito
- **Data:** 2026-07-08
- **Contexto estrutural:** defesa das rotas sensíveis (anti-SSRF / anti-spoof)

## Contexto

Rotas que executam processos no SO (`/api/ollama/install|start`) ou abrem
conexões a partir do servidor (`/api/db/*`) só devem responder a chamadas locais
(cenário desktop). O gate é `isLocalRequest()` (`lib/server-guards.ts`). A
primeira tentativa de endurecimento rejeitava qualquer requisição que **tivesse**
um header `x-forwarded-*`/`forwarded` presente, tratando a mera presença como
"passou por um proxy externo".

Isso quebrou tudo em runtime real. **Lição capturada:** o próprio Next.js injeta
`x-forwarded-for/-host/-port/-proto` a partir do socket em **toda** requisição —
com ou sem proxy de verdade na frente, inclusive em dev e no standalone
(Electron/.cmd). O gate rejeitava 100% das chamadas locais legítimas. O QA só
pegou isso em smoke de servidor real; 107 testes unitários verdes não pegaram,
porque um `Request` mockado não simula o que o framework injeta. **Presença de
header não é sinal — o valor é.**

## Decisão

O gate valida o **valor** de cada header, não a presença:

- `x-forwarded-for` / `x-real-ip` / `forwarded (for=)`: todos os IPs da cadeia
  devem ser loopback (127.0.0.0/8, ::1, ::ffff:127.x).
- `x-forwarded-host`: deve apontar para localhost/127.0.0.1/[::1].
- Qualquer IP/host **não-loopback** em qualquer um desses headers → 403.

Um header que o Next injeta localmente (socket loopback) passa; um valor externo
(proxy reverso real ou atacante formatando o header à mão) derruba o gate.
Conexões de banco em deploy exigem, além disso, o opt-in explícito
`ALLOW_REMOTE_DB=1` (`isDbAccessAllowed`) — sem ele a rota não vira um proxy
aberto para varrer redes internas.

## Alternativas descartadas

- **Rejeitar pela presença do header** — a causa da quebra; incompatível com o
  comportamento do Next.
- **Ler o IP do socket TCP** — a API `Request`/`NextRequest` do App Router não
  expõe o socket nem em runtime nodejs; não é uma opção disponível.

## Consequências

- **Positivas:** as três formas de execução (dev, `.cmd`, Electron) funcionam
  localmente e o gate ainda barra origem externa por valor.
- **Limitação residual documentada:** se o servidor for exposto **diretamente**
  (sem proxy) a um atacante que fale HTTP cru, ele pode forjar `Host: localhost`
  **e** `X-Forwarded-For: 127.0.0.1` — nada nos headers distingue isso de uma
  chamada local. A defesa para esse cenário **não é este gate**, e sim não expor
  a porta publicamente e o opt-in `ALLOW_REMOTE_DB`.
- **Regra de processo:** todo gate de rede exige smoke em servidor real; teste
  unitário com `Request` mockado não substitui.
