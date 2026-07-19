/**
 * Promoção appdev → main (produção). O ritual, mecanizado.
 *
 *   npm run promote            valida e promove
 *   npm run promote -- --dry   só valida e mostra o que entraria (não mexe em nada)
 *
 * A ordem importa e não é negociável:
 *   1. árvore limpa e appdev à frente da main (senão não há o que promover)
 *   2. VALIDA appdev: test + lint + build. Vermelho aqui = fim de papo.
 *   3. SALVA a main atual: branch `backup-main` + tag datada `backup/main-<data>-<sha>`.
 *      A branch se move a cada promoção; a tag é permanente — é ela que salva a sua vida
 *      se uma promoção ruim passar e você só descobrir três promoções depois.
 *   4. MERGE --no-ff: a main guarda um commit de merge por promoção, e não uma papa de
 *      commits de trabalho. Reverter uma promoção inteira vira `git revert -m 1 <merge>`.
 *
 * Nada aqui dá push: publicar é decisão do Michael, não do script. O `.githooks/pre-push`
 * bloqueia push direto da main — para publicar a promoção:
 *
 *     PROMOTE=1 git push origin main backup-main --follow-tags     (bash)
 *     $env:PROMOTE=1; git push origin main backup-main --follow-tags   (PowerShell)
 */
import { spawnSync } from "node:child_process";

const DRY = process.argv.includes("--dry");
const WORK = "appdev";
const PROD = "main";
const BACKUP = "backup-main";

function git(args, { capture = true } = {}) {
  const r = spawnSync("git", args, { encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (r.status !== 0) {
    die(`git ${args.join(" ")} falhou\n${r.stderr ?? ""}`);
  }
  return (r.stdout ?? "").trim();
}

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  return r.status === 0;
}

function die(msg) {
  console.error(`\n[promote] ABORTADO: ${msg}`);
  process.exit(1);
}

// ── 1. Pré-condições ─────────────────────────────────────────────────────────
const branches = git(["branch", "--format=%(refname:short)"]).split("\n");
if (!branches.includes(WORK)) die(`a branch '${WORK}' não existe.`);
if (!branches.includes(PROD)) die(`a branch '${PROD}' não existe.`);

if (git(["status", "--porcelain"])) {
  die("árvore suja. Commite ou guarde suas mudanças antes de promover.");
}

const ahead = git(["rev-list", "--count", `${PROD}..${WORK}`]);
if (ahead === "0") die(`'${WORK}' não tem nada à frente de '${PROD}'. Nada a promover.`);

const commits = git(["log", "--oneline", `${PROD}..${WORK}`]);
console.log(`[promote] ${ahead} commit(s) de '${WORK}' entrariam em '${PROD}':\n`);
console.log(commits.split("\n").map((l) => `    ${l}`).join("\n"));

// ── 2. Validação (na appdev — é o que vai virar produção) ────────────────────
const original = git(["rev-parse", "--abbrev-ref", "HEAD"]);
if (original !== WORK) git(["checkout", WORK], { capture: false });

console.log(`\n[promote] validando '${WORK}' — só passa para produção o que estiver verde.`);
const gates = [
  ["npm", ["test"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "build"]],
];
for (const [cmd, args] of gates) {
  if (!run(cmd, args)) {
    if (original !== WORK) git(["checkout", original], { capture: false });
    die(`'${cmd} ${args.join(" ")}' falhou. A main continua intacta.`);
  }
}
console.log("\n[promote] validação verde (test + lint + build).");

if (DRY) {
  console.log("[promote] --dry: parando aqui. Nada foi alterado.");
  if (original !== WORK) git(["checkout", original], { capture: false });
  process.exit(0);
}

// ── 3. Backup da main ANTES de qualquer escrita nela ─────────────────────────
const mainSha = git(["rev-parse", "--short", PROD]);
const stamp = new Date().toISOString().slice(0, 10);
const tag = `backup/main-${stamp}-${mainSha}`;

git(["branch", "-f", BACKUP, PROD]);
if (!git(["tag", "-l", tag])) git(["tag", tag, PROD]);
console.log(`\n[promote] main salva: branch '${BACKUP}' -> ${mainSha} | tag '${tag}'`);

// ── 4. Merge ─────────────────────────────────────────────────────────────────
git(["checkout", PROD], { capture: false });
const msg = `promote: ${WORK} -> ${PROD} (${ahead} commit(s), validado em ${stamp})`;
const merge = spawnSync("git", ["merge", "--no-ff", WORK, "-m", msg], { stdio: "inherit" });

if (merge.status !== 0) {
  console.error(`\n[promote] CONFLITO no merge. Resolva e commite, ou desfaça com:`);
  console.error(`    git merge --abort && git checkout ${original}`);
  console.error(`[promote] a main anterior está salva em '${BACKUP}' e na tag '${tag}'.`);
  process.exit(1);
}

const newSha = git(["rev-parse", "--short", PROD]);
console.log(`\n[promote] OK — ${PROD} ${mainSha} -> ${newSha}`);
console.log(`[promote] publicar:  PROMOTE=1 git push origin main backup-main --follow-tags`);
console.log(`[promote] desfazer esta promoção: git revert -m 1 ${newSha}`);
console.log(`[promote] ou voltar a main inteira: git reset --hard ${BACKUP}`);

git(["checkout", WORK], { capture: false });
console.log(`[promote] de volta em '${WORK}'. Bom trabalho.`);
