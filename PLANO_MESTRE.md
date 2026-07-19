# PLANO_MESTRE.md: IA Analytics Pro (Arquitetura Híbrida Segura)

## 1. Visão Geral do Projeto
Este documento é a fonte da verdade para a construção do sistema IA Analytics Pro. A aplicação é um web app fullstack para análise autônoma de dados e geração de dashboards. O princípio irrevogável do sistema é a **Privacidade Absoluta**. Os dados brutos inseridos nunca são trafegados para serviços de terceiros. A Inteligência Artificial atua exclusivamente sobre metadados (esquemas estruturais).

A aplicação possui dois motores de processamento comutáveis:
* **Motor Local (Offline):** Execução via Ollama, ideal para ambientes Windows com aceleração de hardware dedicada.
* **Motor Nuvem (API Paga Segura):** Integração com o Google Gemini em modo comercial, garantindo contratualmente o não-uso dos dados de payload para treinamento público.

---

## 2. Stack Tecnológica
* **Ambiente Base:** Windows e Node.js (v20+).
* **Framework:** Next.js (App Router) operando como Frontend e Backend.
* **Linguagem e Estilo:** TypeScript e Tailwind CSS.
* **Motor Gráfico:** Recharts (renderização orientada a eventos JSON).
* **Ingestão de Arquivos:** `xlsx` (Excel) e `papaparse` (CSV).
* **Conexões de IA:** Requisições HTTP diretas para Ollama (`localhost:11434`) e SDK oficial `@google/generative-ai`.

---

## 3. Arquitetura e Fluxo de Dados (Data vs. Metadata)

**Fase A: Ingestão e Isolamento**
O usuário carrega uma planilha (Excel/CSV) na interface. O Next.js executa a leitura do arquivo estritamente no lado do cliente (Client-side) ou na memória volátil do backend local. Os dados brutos permanecem isolados na máquina do usuário.

**Fase B: Extração de Metadados**
O parser do sistema varre os dados lidos para mapear cabeçalhos, identificar tipos de colunas (texto, número, data) e compilar estatísticas anônimas limitadas (valores máximos, mínimos e contagens brutas).

**Fase C: Roteamento de Inteligência**
O usuário seleciona o motor na interface. O sistema envia exclusivamente o pacote de metadados gerado na Fase B. O destino será o Ollama local ou a API do Gemini. O Prompt de Sistema obriga o retorno de um JSON arquitetural (ex: definição de eixos X/Y e tipo de gráfico sugerido).

**Fase D: Renderização Segura**
O React intercepta o JSON devolvido pela IA. O componente `Recharts` assume o controle, fundindo as instruções de plotagem da IA com os dados brutos mantidos em memória, finalizando a geração do dashboard interativo.

---

## 4. Árvore de Diretórios Inicial

```text
/
├── app/
│   ├── api/
│   │   ├── analyze/local/route.ts
│   │   └── analyze/cloud/route.ts
│   ├── dashboard/page.tsx
│   ├── page.tsx
│   └── layout.tsx
├── components/
│   ├── charts-wrapper.tsx
│   └── upload-zone.tsx
├── lib/
│   ├── data-parser.ts
│   ├── prompt-builder.ts
│   └── types.ts
├── .env.local
└── PLANO_MESTRE.md

## 5. Diretrizes Rigorosas para IA Auxiliar (Cursor / Claude Code)
- Comutador de Motor: Projete a interface (UI) com um Toggle claro permitindo ao usuário alternar instantaneamente entre "Processamento Local" e "Nuvem (Gemini)".

- Blindagem de Payload: É terminantemente proibido concatenar variáveis que contenham o valor real das células das planilhas nos payloads enviados para a rota api/analyze/cloud. Apenas o objeto gerado por lib/data-parser.ts deve ser transmitido.

- Garantia de Tipagem IA: Configure as chamadas das APIs usando o parâmetro response_mime_type: "application/json" (ou formato equivalente da API) para forçar saídas estruturadas.

- Tratamento de Exceções: Implemente proteções try/catch em todas as rotas de IA para evitar a quebra do frontend caso o modelo gere caracteres fora do escopo JSON.

- Escalabilidade Modular: Estruture o data-parser.ts como uma interface abstrata. Isso garante que futuras implementações (como conexões SQL ou fluxos n8n) herdem o mesmo tratamento de metadados.

## 6. Roteiro de Execução (Roadmap)
Etapa 1: Inicialização do Next.js App Router, instalação de dependências e configuração estrita do Tailwind CSS.

Etapa 2: Codificação do upload-zone.tsx e do script lib/data-parser.ts para testar a extração cirúrgica de metadados.

Etapa 3: Construção da rota api/analyze/local estabelecendo a comunicação via porta localhost padrão do modelo Ollama.

Etapa 4: Desenvolvimento da rota fallback api/analyze/cloud integrando o @google/generative-ai com a chave restrita extraída do .env.local.

Etapa 5: Programação do charts-wrapper.tsx para interpretar os dicionários JSON recebidos da IA e plotar as instâncias visuais do Recharts.

Etapa 6: Bateria de testes de ponta a ponta com matrizes de dados complexas para validar a performance da separação entre os dados reais e os metadados.