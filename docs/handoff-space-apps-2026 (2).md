# Handoff — NASA Space Apps 2026 · Os Fiscal de Rejunte

> **Para o Claude Code:** este documento consolida uma sessão de brainstorming. Use-o como **base do spec**.
> 1. Leia tudo.
> 2. Confirme com o usuário os pontos marcados como **⚠️ PENDENTE** (seção 12).
> 3. Escreva o spec em `docs/superpowers/specs/2026-11-10-modis-viirs-harmonizer-design.md`.
> 4. Gere o plano com `superpowers:writing-plans` em `docs/superpowers/plans/`.
>
> **Execução:** subagentes **Sonnet implementam**. O modelo Opus **nunca executa**, só planeja e revisa.

---

## 1. Contexto do evento

| Item | Valor |
|---|---|
| Evento | NASA Space Apps Challenge 2026 |
| Local | São Paulo, Brazil |
| Datas | **14–15/11/2026** (hackathon de 48h) |
| Equipe | **Os Fiscal de Rejunte**, 4 pessoas |
| Página da equipe | https://www.spaceappschallenge.org/2026/find-a-team/os-fiscal-de-rejunte/ |
| GitHub org | https://github.com/os-fiscal-de-rejunte |
| Desafio | **Harmonization of MODIS and VIIRS Hot Spots** |
| Objetivo | Vencer com uma solução tecnicamente sólida **e** surpreendente na apresentação |

---

## 2. O desafio

O objetivo é unificar as detecções de focos ativos de dois sensores em um **calendário único e consistente de atividade de queima**.

| Sensor | Resolução | Período | Satélites |
|---|---|---|---|
| MODIS (C6.1) | ~1 km | 2000 → | Terra, Aqua |
| VIIRS | 375 m | 2012 → | S-NPP, NOAA-20, NOAA-21 |

**Problema central:** os sensores enxergam o fogo de forma diferente. O VIIRS detecta muito mais focos pequenos. Somar as duas séries cria um **salto artificial em 2012**.

**Pontos levantados no enunciado e por outras equipes:**
- Uma detecção de hotspot é uma **observação**, não um incêndio individual.
- Há focos que só o VIIRS capta e focos que só o MODIS capta.
- A base global inteira do FIRMS tem cerca de 45 GB em CSV, então um **recorte regional é praticamente obrigatório**.
- Concorrentes já propõem LightGBM (objetivo Tweedie) para mapear MODIS na escala de FRP do VIIRS. A diferenciação tem que vir da narrativa, dos eventos de fogo e da experiência visual e sonora.

**Gancho de urgência (pitch):** a NASA planeja encerrar a coleta do **Terra MODIS em jan/2027** e do **Aqua MODIS por volta de set/2027**. O projeto é o resgate de 25 anos de histórico antes de o satélite morrer.

**Gancho Brasil (⚠️ verificar antes de usar no pitch):** até onde sabemos, o programa Queimadas do INPE usa o **Aqua MODIS como satélite de referência** da série oficial. Se confirmado, a série oficial brasileira quebra em 2027, e o projeto entrega a ponte.

**Fontes:**
- [nasa/spaceapps Discussion #1786](https://github.com/nasa/spaceapps/discussions/1786)
- [salmahmed6/Harmonization-of-MODIS-and-VIIRS-Hot-Spots](https://github.com/salmahmed6/Harmonization-of-MODIS-and-VIIRS-Hot-Spots)
- [Vtheonly/NasaSpaceApp2026](https://github.com/Vtheonly/NasaSpaceApp2026)
- [Copernicus CAMS — transição pós-MODIS](https://atmosphere.copernicus.eu/drifting-away-modis-cams-global-fire-assimilation-system)
- [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/)

---

## 3. Decisões tomadas pelo usuário

| Decisão | Escolha |
|---|---|
| Núcleo do MVP | **Ponte MODIS→VIIRS + recorte Brasil + eventos de fogo** |
| Recorte geográfico | **Pantanal** (área pequena, pico dramático em 2020) |
| Efeitos surpresa no MVP | **Globo 3D com "fantasmas"** e **sonificação do fogo** |
| Tamanho do time | **4 pessoas** (incluindo o usuário) |
| Repositório | Monorepo **`modis-viirs-harmonizer`** na org |
| Commits | **Conventional Commits** (regras na seção 10) |

Ideias descartadas do MVP, para fazer só se sobrar tempo: agente LLM "Pergunte ao fogo" (text-to-SQL), ferramenta "janela crítica" para brigadas e matriz de LED física.

---

## 4. Abordagens de harmonização

**A. Grade + regressão — RECOMENDADA**
1. Agregar MODIS e VIIRS numa grade de **0,1°** (cerca de 11 km) por **dia**.
2. No período de sobreposição (2012–2026), treinar um **LightGBM** que prevê a **contagem equivalente VIIRS** a partir das features MODIS:
   - contagem de focos
   - soma de FRP
   - confiança média
   - dia/noite
   - mês
   - satélite (Terra/Aqua)
3. Aplicar o modelo em 2001–2011.

É rápida, robusta e explicável.

**B. Pareamento detecção a detecção — só como validação**
- Casar focos Aqua com focos S-NPP próximos: raio de **1 km**, janela de **±20 min**. As passagens dos dois são por volta de 13h30.
- É rigorosa, mas frágil e lenta para 48h. Serve para medir a concordância entre os sensores.

**C. Fator de escala mensal — baseline**
- Razão VIIRS/MODIS por mês, aplicada como multiplicador.
- O pitch compara: "o modelo erra X% menos que o ajuste ingênuo".

---

## 5. Design proposto (⚠️ PENDENTE de aprovação final)

### 5.1 Arquitetura — sem backend
- O pipeline em Python **pré-calcula tudo** em arquivos estáticos (Parquet internamente, JSON para a web).
- A web lê os JSONs direto e é publicada no **GitHub Pages**.
- Por que não ter API: para o Pantanal o volume é pequeno, e uma API seria peso morto. Também elimina servidor, deploy e um ponto de falha na apresentação.

### 5.2 Estrutura do monorepo

```
pipeline/   ingest (CSV FIRMS → Parquet), aoi (recorte Pantanal), grid (agregação célula×dia)
model/      baseline (fator mensal), harmonizer (LightGBM), validate (métricas + Aqua×S-NPP)
events/     st_dbscan (pontos → eventos de fogo)
export/     gera web/public/data/*.json
web/        Vite + deck.gl (GlobeView) + Tone.js
tests/      pytest com fixtures pequenas
data/
  sample/   amostras versionadas (pequenas)
  raw/      ignorado pelo git
docs/       pitch, figuras
```

### 5.3 Fluxo de dados
1. **Fonte:** arquivo histórico do FIRMS (MODIS C6.1 2001–2026 e VIIRS S-NPP 2012–2026) para o bbox do Pantanal.
2. `ingest` gera Parquet, e `aoi` filtra pelo polígono ou bbox do Pantanal.
3. `grid` gera o cubo célula 0,1° × dia por sensor.
4. `model` gera o calendário harmonizado 2001–2026. Cada valor tem a flag `observed` ou `estimated`.
5. `events` roda ST-DBSCAN (eps espacial de **2 km**, eps temporal de **2 dias**) e gera métricas de eventos por ano.
6. `export` grava três arquivos:
   - `calendar.json`: ano × semana ISO, com valor e flag `observed`/`estimated`
   - `points/<ano>.json`: pontos com sensor e a flag `ghost` (detectado só por um sensor)
   - `metrics.json`: métricas do modelo vs. baseline e totais de eventos

### 5.4 Front-end
- **Tela 1, globo 3D** (deck.gl `GlobeView`):
  - slider de tempo
  - pontos MODIS e VIIRS em cores diferentes
  - "fantasma" = ponto que só um dos sensores detectou
- **Tela 2, calendário heatmap:** ano × semana. Valores estimados (pré-2012) ficam visualmente distintos dos observados.
- **Sonificação** (Tone.js):
  - cada semana é uma nota; a intensidade define altura e volume
  - cada ano dura cerca de 10 s
  - o pitch abre com "o som do Pantanal em 2020"

### 5.5 Contrato entre as partes
O **schema dos JSONs exportados** é o contrato entre dados e web. Ele precisa ser definido **primeiro**, com JSON Schema ou exemplos em `data/sample/`, para que P3 e P4 comecem o front e a sonificação com dados falsos no mesmo dia.

### 5.6 Testes e critérios de aceite
- `pytest` com fixtures em `data/sample/`.
- Cobertura obrigatória: grade, baseline, eventos, schema do export e casos vazios (célula sem focos, ano sem MODIS, semana sem dados).
- **Aceite do modelo:** MAE semanal no período de sobreposição **menor que o do baseline C**.
- A validação é **por ano (leave-one-year-out ou split temporal)**, sem vazamento entre anos.
- Front: build sem erros e carregamento dos JSONs reais.

---

## 6. Divisão do time

| Pessoa | Responsável por | Entregáveis |
|---|---|---|
| **P1 — Dados** | `pipeline/`, `events/`, `export/` | Parquet limpo, cubo em grade, eventos de fogo, JSONs finais conforme o schema |
| **P2 — Modelo** | `model/`, validação | Baseline, LightGBM, métricas vs. baseline, pareamento Aqua×S-NPP |
| **P3 — Web** | `web/` (globo e heatmap), deploy | Globo 3D com fantasmas, calendário heatmap, GitHub Pages |
| **P4 — Som e pitch** | sonificação (Tone.js), pitch, `docs/` | Módulo de sonificação plugado na web, slides, vídeo, README em inglês, submissão |

Sugestão: o usuário fica como **P1**, por ter experiência com pipelines em Python, SQL e modelagem de dados. A P4 também é responsável pela coerência da narrativa: o gancho do fim do MODIS e o "som do Pantanal 2020".

---

## 7. Cronograma

| Quando | O quê |
|---|---|
| **Ter (hoje)** | Pedir o **arquivo histórico do FIRMS** (pode levar horas ou dias) e registrar a **MAP_KEY** |
| **Qua–Sex** | Pipeline e baseline com amostra; schema do export definido; web rodando com dados falsos |
| **Sáb 14/11** | Modelo LightGBM, eventos, integração com dados reais |
| **Dom 15/11** | Polimento, vídeo, submissão, tag `v1.0.0` |

---

## 8. Stack

| Camada | Tecnologia |
|---|---|
| Linguagem | Python 3.12 |
| Dados | DuckDB, Parquet (pyarrow), pandas ou polars |
| ML | LightGBM, scikit-learn |
| Eventos | ST-DBSCAN (implementação própria ou lib leve) |
| Qualidade | ruff, pytest, pre-commit |
| Front | Vite, deck.gl (`GlobeView`), Tone.js |
| Deploy | GitHub Pages (estático) |
| Release | release-please (CHANGELOG e semver automáticos) |

Segredo: `FIRMS_MAP_KEY` fica no `.env` (fora do git), com o exemplo em `.env.example`.

---

## 9. Setup da org GitHub (kit já gerado)

O kit `os-fiscal-de-rejunte-setup.zip` foi gerado e tem três destinos:

| Pasta | Vai para |
|---|---|
| `dot-github/` | repo `.github` da org: CONTRIBUTING, templates de PR e issue, profile README |
| `repo-template/` | repo `repo-template`, marcado como template |
| `setup.sh`, `labels.json`, `rulesets/` | rodam localmente, não vão para nenhum repo |

```bash
gh auth refresh -s admin:org
./setup.sh bootstrap
./setup.sh new modis-viirs-harmonizer
```

O `repo-template` já inclui:
- CI: ruff, pytest e npm, este só se existir `package.json`.
- Checks de PR: `pr-title`, `branch-name` e `commitlint`.
- release-please, dependabot, CODEOWNERS (`@os-fiscal-de-rejunte/core`).
- pre-commit (ruff, nbstripout, conventional-pre-commit, bloqueio de commit na `main`).
- `.gitignore` de dados e licença MIT.

Na `main` valem: merge só por squash, 1 aprovação e os checks `ci`, `pr-title`, `branch-name` e `commitlint` obrigatórios.

**Ajuste necessário após criar o repo:** substituir `REPO_NAME`/`PROJECT_NAME` no README, no `pyproject.toml` e no `release-please-config.json`. O `pyproject.toml` do template usa `src/`; adaptar para a estrutura do monorepo da seção 5.2.

---

## 10. Convenções obrigatórias

**Repos:** `<area>-<nome>` em kebab-case. Áreas: `pipeline-`, `model-`, `api-`, `web-`, `docs-`, `infra-`, `exp-`. Exceções fixas: `.github`, `repo-template` e `modis-viirs-harmonizer`.

**Branches:**
- Formato `<tipo>/<nº-issue>-<descricao-curta>`, por exemplo `feat/12-matching-espaco-temporal`.
- Fluxo trunk-based: não existe `develop`, e ninguém faz push direto na `main`.
- Regex validada na CI:
  ```
  ^(feat|fix|perf|refactor|docs|test|data|build|ci|chore|style|revert|exp|hotfix)/([0-9]+-)?[a-z0-9]+(-[a-z0-9]+)*$
  ```

**Commits (Conventional Commits):**
```
<tipo>(<escopo>)!: <descrição>
```
- Tipos: `feat fix perf refactor docs test data build ci chore style revert`
- Escopos: `pipeline model api web viz data infra docs deps release main`
- A descrição é **em inglês**, no imperativo, começa em minúscula, sem ponto final, com cabeçalho de até 72 caracteres.
- Exemplos:
  ```
  feat(pipeline): add FIRMS archive ingestion for Pantanal AOI
  fix(model): handle missing FRP values in MODIS overlap set
  data(pipeline): pin AOI bounding box for Pantanal
  ```

**PRs:** o título também é um Conventional Commit, porque vira o commit da `main` no squash. O corpo leva `Closes #N`. Preferir PRs pequenos.

---

## 11. Instruções para o plano de ação

O plano deve:
1. Começar pelo **schema do export** (contrato) e pelas **fixtures em `data/sample/`**, que desbloqueiam P3 e P4.
2. Organizar as tarefas por pessoa (P1, P2, P3, P4) e marcar as dependências entre elas, para que as 4 trabalhem em paralelo desde o primeiro dia.
3. Seguir TDD: em cada tarefa, primeiro o teste que falha, depois o código, depois o commit em Conventional Commits.
4. Indicar o nome de branch de cada tarefa conforme a seção 10.
5. Incluir na Review Focus os casos-limite:
   - célula ou semana sem focos
   - ano sem MODIS
   - FRP ausente
   - duplicatas Terra/Aqua
   - fuso horário (as datas do FIRMS estão em UTC)
6. Terminar com uma tarefa de entrega: deploy no GitHub Pages, README final em inglês, tag `v1.0.0` e checklist de submissão do Space Apps.
7. Deixar o MVP separado do opcional (agente LLM, janela crítica para brigadas).

---

## 12. ⚠️ Pendências para confirmar com o usuário

- [ ] Aprovação final da **abordagem A** e do design da seção 5.
- [ ] Bbox ou polígono exato do Pantanal (a fonte do limite do bioma precisa ser definida, por exemplo IBGE).
- [ ] Incluir **NOAA-20/NOAA-21** além do S-NPP? O padrão proposto é só S-NPP.
- [ ] Tamanho da grade (padrão de 0,1°) e janela temporal (dia) do modelo.
- [ ] Quem é P1, P2, P3 e P4 (handles do GitHub para o profile README e o CODEOWNERS).
- [ ] Confirmar se o INPE usa Aqua como satélite de referência antes de usar esse argumento no pitch.
- [ ] Se o arquivo histórico do FIRMS já foi solicitado.
