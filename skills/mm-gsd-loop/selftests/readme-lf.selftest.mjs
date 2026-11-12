#!/usr/bin/env node
/**
 * 自测:README「跨平台:换行与 LF」小节(REQ-24 / D-04)。
 *
 * 考的是**关系** —— 哪一段说了什么、哪一段不能说什么 —— 不是单句字面量:
 * 措辞可以换,换了不该判红;把某条关系改坏(推荐档写成全局开关、两次量对调、
 * 把另一档写成无条件推荐……)必须判红。
 *
 * 判别力自证:每条关系配一份**只破坏这一条**的 README 变体(内存里改,不落盘),
 * 变体必须被判红 —— 变体判绿说明那条断言没牙。
 *
 * 只读 README.md,不写仓库任何文件;被 import 时不自己跑(main-guard)。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const README_PATH = join(REPO_ROOT, 'README.md');

const RECOMMENDED_TIER = /core\.autocrlf\s+input/;
const OTHER_TIER = /core\.autocrlf\s+false/;

/* ---------------- 取段工具 ---------------- */

function lines(md) {
  return md.split('\n');
}

/** 「跨平台:换行与 LF」整节(含其下所有小节),取不到返回 null */
function sectionOf(md) {
  const ls = lines(md);
  const start = ls.findIndex((l) => /^##\s+跨平台[:：]换行与\s+LF\s*$/.test(l));
  if (start === -1) return null;
  let end = ls.length;
  for (let i = start + 1; i < ls.length; i++) {
    if (/^##\s+/.test(ls[i])) { end = i; break; }
  }
  return ls.slice(start, end).join('\n');
}

/** 顶部目录块 */
function tocOf(md) {
  const ls = lines(md);
  const start = ls.findIndex((l) => /^##\s+目录\s*$/.test(l));
  if (start === -1) return '';
  let end = ls.length;
  for (let i = start + 1; i < ls.length; i++) {
    if (/^##\s+/.test(ls[i])) { end = i; break; }
  }
  return ls.slice(start, end).join('\n');
}

/** 按空行切段:一个代码块 / 一段散文各算一块 */
function blocksOf(text) {
  return text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
}

/** 某块的上下文:前一块 + 本块 + 后一块 */
function ctxOf(blocks, i) {
  return [blocks[i - 1], blocks[i], blocks[i + 1]].filter(Boolean).join('\n');
}

/** 「推荐」标记(排除「不推荐」这类否定说法) */
function isRecommended(text) {
  const neg = (text.match(/不推荐|非推荐|不作推荐|别推荐/g) || []).length;
  const pos = (text.match(/推荐/g) || []).length;
  return pos - neg > 0;
}

/** 条件路径的前提:工作区已经是 LF */
function hasPrecondition(text) {
  return (
    /工作区[^。；\n]{0,20}(已经|已是|本来就是|已经是)[^。；\n]{0,8}LF/i.test(text) ||
    /LF[^。；\n]{0,12}的工作区/i.test(text)
  );
}

/* ---------------- 断言 ---------------- */

/** (a) 小节与顶部目录锚点都在 */
function checkA(md) {
  if (!sectionOf(md)) return false;
  return lines(tocOf(md)).some((l) => {
    const m = l.match(/\[([^\]]+)\]\((#[^)]*)\)/);
    return !!m && /跨平台/.test(m[1]) && /换行/.test(m[1]) && /LF/i.test(m[1]) && m[2].length > 1;
  });
}

/** (b) 推荐档:一条以 git config 开头的完整命令,实测正确档,只对本仓库生效,且标了推荐 */
function checkB(md) {
  const sec = sectionOf(md);
  if (!sec) return false;
  const cmdLines = lines(sec).filter((l) => /^\s*git config\b/.test(l));
  if (!cmdLines.length) return false;
  // 任何一条 git config 都不得用全局/system 开关,也不得指向用户主目录下的全局配置
  if (cmdLines.some((l) => /--global|--system|(^|\s)-g(\s|$)|~\/\.gitconfig|\$HOME\/\.gitconfig/.test(l))) return false;
  const rec = cmdLines.find((l) => RECOMMENDED_TIER.test(l));
  if (!rec) return false;
  const bs = blocksOf(sec);
  const ctx = ctxOf(bs, bs.findIndex((b) => b.includes(rec)));
  // 推荐标记允许写在命令所在段落的散文里,不要求贴在命令行尾
  if (!isRecommended(ctx)) return false;
  // 只对本仓库生效
  if (!/(本仓库|当前仓库|这个仓库|\.git\/config)/.test(ctx)) return false;
  return true;
}

/** (c) 另一档必须出现,且只能是条件路径(前提:工作区已经是 LF),不得无条件推荐 */
function checkC(md) {
  const sec = sectionOf(md);
  if (!sec) return false;
  const bs = blocksOf(sec);
  const occ = bs.filter((b) => OTHER_TIER.test(b)).map((b) => ctxOf(bs, bs.indexOf(b)));
  if (!occ.length) return false; // 另一档整块缺席 → 红
  if (!occ.some((ctx) => hasPrecondition(ctx))) return false; // 至少一处是条件路径
  if (occ.some((ctx) => isRecommended(ctx) && !hasPrecondition(ctx))) return false; // 无条件推荐 → 红
  return true;
}

/** (d) 判据块有正面内容:自己的脚本 / 自建工件按行比对出错 */
function checkD(md) {
  const sec = sectionOf(md);
  if (!sec) return false;
  return blocksOf(sec).some((b) => {
    const t = b.replace(/\n/g, ' ');
    return (
      /(自己|自建)/.test(t) &&
      /(脚本|工件|产物|生成物)/.test(t) &&
      /(按行|逐行|一行一行|行比对|行读)/.test(t) &&
      /(出错|失败|错位|对不上|不匹配|匹配不上|不一致)/.test(t)
    );
  });
}

/** (e) 代价:工作区会整片变脏这类后果 */
function checkE(md) {
  const sec = sectionOf(md);
  if (!sec) return false;
  return lines(sec).some((l) => /变脏/.test(l) && /工作区|整片|满屏|一片/.test(l));
}

/** (f) 量体量分两次且绑定阶段:工作区那份在「改设置之前」,暂存区那份在「renormalize 之后」 */
function checkF(md) {
  const sec = sectionOf(md);
  if (!sec) return false;
  const BEFORE = /(改|换|切|动|设)[^。；\n]{0,8}设置[^。；\n]{0,4}(之前|前)/;
  const isAfter = (t) => /renormalize/i.test(t) && /之后|以后/.test(t);
  let worktreeBefore = false;
  let worktreeAfter = false;
  let stagedBefore = false;
  let stagedAfter = false;
  for (const b of blocksOf(sec)) {
    const t = b.replace(/\n/g, ' ');
    const worktree = /git diff --stat/.test(t) && !/git diff --cached/.test(t);
    const staged = /git diff --cached --stat/.test(t);
    const before = BEFORE.test(t);
    const after = isAfter(t);
    if (worktree) {
      if (before) worktreeBefore = true;
      if (after) worktreeAfter = true;
    }
    if (staged) {
      if (before) stagedBefore = true;
      if (after) stagedAfter = true;
    }
  }
  // 两次对调 → 暂存区那份落进「改设置之前」的上下文 → 红
  return worktreeBefore && stagedAfter && !stagedBefore && !worktreeAfter;
}

/** (g) .gitattributes 只适用于全新克隆 / 没有 CRLF 历史的仓库 */
function checkG(md) {
  const sec = sectionOf(md);
  if (!sec) return false;
  return lines(sec).some(
    (l) =>
      /\.gitattributes/.test(l) &&
      /(全新克隆|新克隆|新的克隆)/.test(l) &&
      /(没有|无|不含)[^。\n]{0,8}CRLF[^。\n]{0,12}历史/i.test(l)
  );
}

/** (h) 工具侧已认 CRLF 的正面表述必须在;负面只针对「把模板抽取写成症状」 */
function checkH(md) {
  const sec = sectionOf(md);
  if (!sec) return false;
  const ls = lines(sec);
  for (const l of ls) {
    if (
      /模板抽取|抽取模板/.test(l) &&
      /(对不上|不支持|失效|抽不出|识别不了)/.test(l) &&
      !/(不|不会|不由|不是|没)/.test(l)
    ) return false; // 把「模板抽取」与症状词写在同一行且没有否定词 → 红
  }
  return ls.some((l) => /(工具|模板)/.test(l) && /CRLF/.test(l) && /(认|兼容|支持|两种行尾|两种换行)/.test(l));
}

/** (i) 边界四条全覆盖:不改写工作区 / 不批量重写 / 不可逆由人决定 / 只对本仓库生效不用全局开关 */
function checkI(md) {
  const sec = sectionOf(md);
  if (!sec) return false;
  const covered = new Set();
  for (const l of lines(sec)) {
    if (/(不会|不由|不)[^。\n]{0,10}(改写|重写)[^。\n]{0,10}(工作区|既有文件|你的文件)/.test(l)) covered.add('no-rewrite');
    if (/不(?:会)?批量[^。\n]{0,4}(重写|改写)|不做批量|不会批量/.test(l)) covered.add('no-bulk');
    if (/不可逆/.test(l) && /(由(你|人)自己决定|由人决定|自己决定|人自己决定)/.test(l)) covered.add('irreversible');
    if (
      /(只对本仓库生效|只(写|作用|生效|影响)[^。\n]{0,8}(本仓库|当前仓库|这个仓库))/.test(l) &&
      /(不用全局|不写全局|不需要全局|不设全局|不用全局开关|不碰用户主目录)/.test(l)
    ) covered.add('repo-only');
  }
  return covered.size === 4;
}

/** (j) 行级禁则:承诺主体是本仓/我们/mm-gsd/看板/工具 + 自动/统一/改写/归一/改掉/改成,6 字符内没有否定词 → 红 */
function checkJ(md) {
  const sec = sectionOf(md);
  if (!sec) return false;
  const SUBJECT = /(本仓|我们|mm-gsd|看板|工具)/g;
  const CONNECT = /(代你|替你|由本仓|由工具)/g;
  const VERB = /(自动|统一|改写|归一|改掉|改成)/g;
  const NEG = /(不|别|没|无|未)/g;
  for (const line of lines(sec)) {
    if (!SUBJECT.test(line)) continue; // 陈述 Git 自身行为等,不触网
    SUBJECT.lastIndex = 0;
    const conns = [...line.matchAll(CONNECT)];
    const verbs = [...line.matchAll(VERB)];
    const negs = [...line.matchAll(NEG)];
    const near = (v) =>
      negs.some((n) => {
        const gap = Math.max(
          0,
          v.index - (n.index + n[0].length),
          n.index - (v.index + v[0].length)
        );
        return gap <= 6;
      });
    // 主体 + (代你|替你|由本仓|由工具) + 承诺动词
    if (conns.length && verbs.some((v) => !near(v))) return false;
    // 主体 + 自动 + 承诺动词
    if (/自动/.test(line) && verbs.some((v) => !near(v))) return false;
  }
  return true;
}

/** (k) 给出查行尾现状的命令,并说明工作区可能是混合行尾 */
function checkK(md) {
  const sec = sectionOf(md);
  if (!sec) return false;
  const hasCmd = /git ls-files --eol/.test(sec);
  const hasMixed = /(混合行尾|混合换行|行尾[^。\n]{0,8}混合|可能[^。\n]{0,12}混合)/.test(sec);
  return hasCmd && hasMixed;
}

/** (l) 老仓库要先 renormalize 并量体量再决定 */
function checkL(md) {
  const sec = sectionOf(md);
  if (!sec) return false;
  return blocksOf(sec).some(
    (b) =>
      /(老仓库|存量仓库|已有 CRLF 历|有 CRLF 历)/.test(b) &&
      /renormalize/i.test(b) &&
      /量体量|先量|量一量/.test(b)
  );
}

const CHECKS = [
  { id: 'a', name: '(a) 存在「跨平台:换行与 LF」小节与顶部目录锚点', run: checkA },
  { id: 'b', name: '(b) 推荐档:git config 完整命令、实测正确档、只对本仓库生效', run: checkB },
  { id: 'c', name: '(c) 另一档必须出现,且只作为条件路径(前提:工作区已是 LF)', run: checkC },
  { id: 'd', name: '(d) 判据块有正面内容(自己的脚本按行比对出错)', run: checkD },
  { id: 'e', name: '(e) 写明「工作区会整片变脏」这类代价', run: checkE },
  { id: 'f', name: '(f) 量体量分两次且绑定阶段(工作区那份在改设置之前,暂存区那份在 renormalize 之后)', run: checkF },
  { id: 'g', name: '(g) .gitattributes 只适用于全新克隆 / 无 CRLF 历史的仓库', run: checkG },
  { id: 'h', name: '(h) 工具侧已认 CRLF 有正面表述,且没把模板抽取写成症状', run: checkH },
  { id: 'i', name: '(i) 边界四条全覆盖(不改写工作区/不批量重写/不可逆由人决定/只对本仓库生效)', run: checkI },
  { id: 'j', name: '(j) 无「本仓自动替你改写」这类承诺(行级禁则)', run: checkJ },
  { id: 'k', name: '(k) 给出查行尾现状的命令并说明工作区可能是混合行尾', run: checkK },
  { id: 'l', name: '(l) 老仓库要先 renormalize 并量体量再决定', run: checkL },
];

/* ---------------- 变异矩阵:每个变体只破坏一条关系 ---------------- */

const MUTATIONS = [
  {
    id: 'm-b',
    target: 'b',
    label: '推荐档改成全局开关写法',
    mutate: (t) => t.replace('git config core.autocrlf input', 'git config --global core.autocrlf input'),
  },
  {
    id: 'm-c',
    target: 'c',
    label: '把另一档(条件路径)整段删掉',
    mutate: (t) =>
      t.replace(
        '**条件档(前提:工作区已经是 LF)** —— 只有工作区现在已经是 LF 时切这一档才安全;\n配套是先加 `.gitattributes` 再 renormalize:\n\n```bash\ngit config core.autocrlf false\n```\n\n',
        ''
      ),
  },
  {
    id: 'm-d',
    target: 'd',
    label: '删掉判据块的正面症状',
    mutate: (t) =>
      t.replace(
        '**症状是你自己写的脚本、自建的工件按行比对出错**:同一份文件在编辑器里看着完全一样,\n提交后却整文件全变;脚本按行读、按行比对时错位或匹配不上。这时候该怀疑行尾。\n\n',
        ''
      ),
  },
  {
    id: 'm-e',
    target: 'e',
    label: '抹掉「工作区会整片变脏」这个代价',
    mutate: (t) => t.replace('工作区会整片变脏', '工作区状态会有变化'),
  },
  {
    id: 'm-f',
    target: 'f',
    label: '两次量的 diff 互换(在错误的 diff 上做决定)',
    mutate: (t) =>
      t
        .replace('**改设置之前**先量工作区那份:`git diff --stat`', '**改设置之前**先量工作区那份:`git diff --cached --stat`')
        .replace('改看 `git diff --cached --stat`', '改看 `git diff --stat`'),
  },
  {
    id: 'm-h',
    target: 'h',
    label: '把「工具侧已认 CRLF」改成「识别不了 CRLF」',
    mutate: (t) =>
      t.replace(
        '**但这不是 mm-gsd 的模板抽取出错。** 工具侧的模板抽取本来就同时认 CRLF 和 LF',
        '工具侧的模板抽取识别不了 CRLF,模板抽取对不上 LF 的模板。'
      ),
  },
  {
    id: 'm-i',
    target: 'i',
    label: '抹掉「不可逆、由人决定」',
    mutate: (t) => t.replace('改行尾是不可逆操作,由你自己决定', '改行尾只是普通操作'),
  },
  {
    id: 'm-j',
    target: 'j',
    label: '把「工具不改你的文件」改成自动改写承诺',
    mutate: (t) => t.replace('工具不改你的文件', '工具会自动改写你的文件'),
  },
  {
    id: 'm-k',
    target: 'k',
    label: '抹掉「混合行尾」这个说法',
    mutate: (t) => t.replace('混合行尾', '各处行尾不一'),
  },
  {
    id: 'm-l',
    target: 'l',
    label: '抹掉老仓库的 renormalize + 量体量 前提',
    mutate: (t) =>
      t.replace(
        '**老仓库(已经有 CRLF 历史的)先 renormalize 再量体量,决定要不要继续** ——\n顺序不能反:先 renormalize 会把差异堆到暂存区,先量体量才知道改写面有多大。',
        '**老仓库(已经有 CRLF 历史的)照上面的步骤直接做就行** ——\n顺序按上面写的来。'
      ),
  },
];

/* ---------------- 跑 ---------------- */

function main() {
  const md = readFileSync(README_PATH, 'utf8').replace(/\r\n/g, '\n');
  let failed = 0;

  console.log('=== 现行 README:关系断言 ===');
  for (const c of CHECKS) {
    let ok = false;
    try {
      ok = c.run(md) === true;
    } catch (err) {
      ok = false;
    }
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${c.name}`);
  }

  console.log('\n=== 变异自证:每份变体只破坏一条关系,目标关系必须判红 ===');
  for (const m of MUTATIONS) {
    const mutated = m.mutate(md);
    const target = CHECKS.find((c) => c.id === m.target);
    const changed = mutated !== md;
    let red = false;
    try {
      red = changed && target.run(mutated) === false;
    } catch (err) {
      red = true; // 变体把断言搞崩也算它没守住
    }
    if (!red) failed++;
    console.log(`${red ? '✓' : '✗'} ${m.id} ${m.label} → 目标关系 (${m.target}) ${red ? '已判红' : '未判红'}`);
  }

  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`);
  process.exitCode = failed === 0 ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
