// 自测族模块(phase 30 T2 从 gate-selftest.mjs 拆出):假绿通道族(判别力 lint / 零匹配假绿 / 收紧一二轮 / 三面口径 / 触发面放宽)+ 相邻两段(--phases 不可核验 / GSD_PROJECT_DIR)—— 与假绿同用 checkDiscriminatingLints 族,连续段一并搬
// 断言工具与共享输入由 runSelfTest 显式传入(不自建断言器 —— 失败数必须聚合到同一个 st);
// 时序契约(遥测隔离/env 还原)仍由 runSelfTest 统一持有,本文件不做任何环境操作。

import { checkDiscriminatingLints, checkZeroMatchErrors } from "./verification-gates.mjs";
import { isFullSuite } from "./worktree-view.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function runAntiFalseGreenCases(t, x) {
  const { eq, eqN, eqArr } = t;
  const { CHECKER } = x;

  // ---- 判别力 lint(#10):只判「退出码被吞」;裸 grep -c 是家常正确形状 ----
  eqN(checkDiscriminatingLints([{ id: "T1", verify: "n=$(cat t.md | grep -c foo)" }]).length, 1, "lint 命中捕获式 grep -c(报 WARNING)");
  eqN(checkDiscriminatingLints([{ id: "T1", verify: "grep -c foo t.md || true" }]).length, 1, "lint 命中吞退出码(报 WARNING)");
  eqN(checkDiscriminatingLints([{ id: "T1", verify: "grep -c foo t.md" }]).length, 0, "裸 grep -c 不误报(零匹配即红)");
  eqN(checkDiscriminatingLints([{ id: "T1", verify: "cargo test --test skills_bundle" }]).length, 0, "具名 cargo test 不误报");
  // ---- 零匹配假绿阻断(phase 26 D-01,issue #22):go test -run / cargo test -- 过滤器零匹配 exit 0,判绿是假的 ----
  // phase 26 D-04:断言要**判别性**(证明真有用例跑过),且要落在**真命令**上(注释里的标记不算断言)。
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "go test ./... -run TestFoo" }]).length, 1, "判别性痕迹:命中 go test -run 零断言假绿");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "go test ./... -run TestFoo -v 2>&1 | tee o.txt\ngrep -q -- \"--- PASS\" o.txt" }]).length, 0, "判别性痕迹:go test -run 带 --- PASS 断言不误报");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case" }]).length, 1, "判别性痕迹:命中 cargo test 过滤器零断言假绿");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test --test skills_bundle" }]).length, 0, "判别性痕迹:cargo test --test 集成测试不误报");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "go test ./... -run TestFoo  # 零匹配会打印 no tests to run" }]).length, 1, "零匹配签名不算断言(go no tests to run)");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case  # 零匹配会打印 test result: ok" }]).length, 1, "零匹配签名不算断言(cargo 无计数 test result)");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "go test ./... -run TestFoo\n# --- PASS: TestFoo" }]).length, 1, "零匹配签名不算断言(整行注释里的 --- PASS)");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case 2>&1 | tee o.txt\ngrep -q \"test result: ok. 3 passed\" o.txt" }]).length, 0, "判别性痕迹:cargo N passed 是判别性断言");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case 2>&1 | tee o.txt\ngrep -q \"running 3 tests\" o.txt" }]).length, 0, "判别性痕迹:cargo running N tests 是判别性断言");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "go test ./... -run TestFoo 2>&1 | tee o.txt\n! grep -q \"no tests to run\" o.txt" }]).length, 0, "判别性痕迹:go 否定式断言是判别性断言");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case 2>&1 | tee o.txt\ngrep -q \"test result: FAILED\" o.txt" }]).length, 0, "判别性痕迹:cargo test result: FAILED 是判别性断言");
  // 跨行引号(35-01 T2):断言串被换行劈开时,引号内的 \n 合并成空格,不误红
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "go test -v -run TestX ./... | tee o.txt\n! grep -q \"no tests to\nrun\" o.txt" }]).length, 0, "跨行引号:否定断言串被换行劈开,合并后不误红");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "go test -run TestX ./...\necho \"still no\ntests to run\"" }]).length, 1, "跨行引号:合并不豁免真零断言(echo 不是断言,go test -run 仍判红)");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case  # 期望 3 passed" }]).length, 1, "行尾注释不算断言(cargo 行尾注释里的 3 passed)");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "go test ./... -run TestFoo # --- PASS" }]).length, 1, "行尾注释不算断言(go 行尾注释里的 --- PASS)");
  // ---- 假绿通道收紧(phase 26 D-06 + D-08,REQ-35):过滤器形态 / 标记来源 / 否定签名 / ≥1 计数形态 ----
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- --exact my_case" }]).length, 1, "cargo 过滤器识别:独立 -- 后的 --exact 是过滤器形态");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- --skip x" }]).length, 1, "cargo 过滤器识别:独立 -- 后的 --skip 是过滤器形态");
  // ⑤′(phase 26 D-18②):这条命令**不是**收窄 —— 独立 `--` 后只跟一个行为 flag,不收窄用例选择 = 全量套件。
  // 零匹配门对全量命令闭嘴(唯一建议来自票预算门:搬到 batch_verify)→ 期望值由 1 改成 0。
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- --test-threads=1" }]).length, 0, "cargo test -- 跟单个行为 flag 是全量套件(零匹配门闭嘴,归票预算门一条建议)");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case 2>&1 | tee o.txt\ngrep -v \"0 passed\" o.txt" }]).length, 1, "否定式只认:grep -v 不提供正面标记");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "go test ./pkg -run TestFoo -v 2>&1 | tee o.txt\ngrep -v \"no tests to run\" o.txt" }]).length, 1, "否定式只认:grep -v 不是 go 的否定式签名");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "go test ./pkg -run TestFoo -v 2>&1 | tee o.txt\n! grep -q \"no test files\" o.txt" }]).length, 1, "否定式只认:go -run 形态不认 no test files 签名");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case 2>&1 | tee o.txt\necho \"3 passed\"" }]).length, 1, "echo 自造标记:cargo 侧 echo 造 3 passed");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "go test ./pkg -run TestFoo\necho \"--- PASS\"" }]).length, 1, "echo 自造标记:go 侧 echo 造 --- PASS");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case 2>&1 | tee o.txt\ngrep -qE \"test result: ok\\. [1-9][0-9]* passed\" o.txt" }]).length, 0, "计数形态:cargo 字符类 [1-9][0-9]* passed 是判别性断言");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case 2>&1 | tee o.txt\ngrep -qE \"test result: ok\\. [0-9]+ passed\" o.txt" }]).length, 1, "计数形态:cargo 字符类 [0-9]+ passed 含 0 不是判别性断言");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case 2>&1 | tee o.txt\ngrep -q \"running 1 test\" o.txt" }]).length, 0, "计数形态:cargo running 1 test 单数是判别性断言");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case 2>&1 | tee o.txt\ngrep -v \"3 passed\" o.txt" }]).length, 1, "否定式只认:grep -v \"3 passed\" 也不提供正面标记");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case 2>&1 | tee o.txt\n! grep -qE \"test result: ok\\. 0 passed\" o.txt" }]).length, 0, "否定式只认:教法原文的 cargo 否定式是判别性断言");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case 2>&1 | tee o.txt\ngrep -qE \"[1-9]?[0-9]* passed\" o.txt" }]).length, 1, "计数形态:字符类后面跟量词不算判别性断言");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case 2>&1 | tee o.txt\ngrep -qE \"[1-9]+ passed\" o.txt" }]).length, 1, "计数形态:字符类后面跟 + 不算判别性断言");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "echo \"cargo test -- my_case\"" }]).length, 0, "echo 自造标记:echo 一条命令名不触发零匹配门");
  eqN(isFullSuite("cargo test -- my_case"), false, "全量套件判定:cargo test -- 单个用例名不是全量套件");
  eqN(isFullSuite("cargo test -- --nocapture"), true, "全量套件判定:cargo test -- 只有 flag 仍是全量套件");
  // ---- 假绿通道收紧二轮(phase 26 D-09,REQ-37):判定单位下沉到管道级(stage) ----
  // 段级判定会把「同段里既有触发命令又有 grep -v」的整段作废 → 触发命令随段一起消失(G-26-6)。
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case 2>&1 | tee o.txt | grep -v \"^$\"" }]).length, 1, "管道级判定:同段 grep -v 不吞掉 cargo 触发命令");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "go test ./pkg -run TestFoo -v 2>&1 | tee o.txt | grep -v \"^$\"" }]).length, 1, "管道级判定:同段 grep -v 不吞掉 go 触发命令");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "go test ./pkg -run TestFoo -v 2>&1 | tee o.txt\n! grep -qE \"other|no tests to run\" o.txt" }]).length, 0, "管道级判定:引号里的竖线不切开否定签名");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- my_case 2>&1 | tee o.txt\n! grep -v \"running 0 tests\" o.txt" }]).length, 1, "管道级判定:! grep -v 不算否定签名");
  // ---- 三面口径(phase 26 D-13 + D-15,REQ-41):分类面看骨架 / 触发面看真正会执行的命令 / 标记面看模式串 ----
  // G-26-8:触发命令被引号包住(bash -c "...")就消失 —— 门禁看不见真正会跑的命令。
  // G-26-9:引号里的字面量(grep -q "cargo test -- ...")被当成命令 —— 合法票被误伤。
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "bash -c \"cargo test -- my_case\"" }]).length, 1, "triplane-1 wrapper 载荷里的 cargo 触发命令看得见");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "sh -c \"go test ./pkg -run TestFoo\"" }]).length, 1, "triplane-2 wrapper 载荷里的 go 触发命令看得见");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "grep -q \"cargo test -- my_case\" README.md" }]).length, 0, "triplane-3 引号里的字面量不是命令(不误伤)");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "grep -q \"go test ./pkg -run TestFoo\" README.md" }]).length, 0, "triplane-4 引号里的字面量不是命令(不误伤)");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "bash -c 'cargo test -- my_case && grep -q \"3 passed\" o.txt'" }]).length, 0, "triplane-5 wrapper 载荷里有判别性断言就不误报");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "FOO=\"x\" bash -c \"cargo test -- my_case\"" }]).length, 1, "triplane-6 赋值前缀不影响 wrapper 识别");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "bash -c \"cargo test -- \\\"my_case\\\"\"" }]).length, 1, "triplane-7 载荷里的转义引号认得");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "bash -lc \"cargo test -- my_case\"" }]).length, 1, "triplane-8 -lc 也是 shell 载荷");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "bash script \"cargo test -- my_case\"" }]).length, 0, "triplane-9 不是 -c 载荷就不展开");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "env FOO=1 bash -c \"cargo test -- my_case\"" }]).length, 1, "triplane-10 env 前缀不影响 wrapper 识别");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "bash -c \"bash -c \\\"cargo test -- my_case\\\"\"" }]).length, 1, "triplane-11 嵌套 wrapper 载荷看得见");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "bash -c \"cargo test -- my_case\" 2>&1 | tee o.txt" }]).length, 1, "triplane-12 wrapper 后面接管道照样看得见");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "bash -c \"cargo test -- my_case\" > out.txt" }]).length, 1, "triplane-13 wrapper 后面接重定向照样看得见");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "grep -c \"cargo test -- my_case\" README.md" }]).length, 0, "triplane-14 grep -c 不是 shell 载荷(不误伤)");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "grep -c \"go test ./pkg -run TestFoo\" README.md" }]).length, 0, "triplane-15 grep -c 不是 shell 载荷(不误伤)");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "/bin/bash -c \"cargo test -- my_case\"" }]).length, 1, "triplane-16 带路径的 shell 名照样认");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "bash -c \"cargo test -- my_case\" 2>&1 | tee o.txt\ngrep -q \"test result: ok. 3 passed\" o.txt" }]).length, 0, "triplane-17 wrapper 载荷里有判别性断言就不误报");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "sh -c \"go test ./pkg -run TestFoo\" 2>&1 | tee o.txt\ngrep -q -- \"--- PASS\" o.txt" }]).length, 0, "triplane-18 sh wrapper 载荷里有判别性断言就不误报");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "sudo bash -c \"cargo test -- my_case\"" }]).length, 1, "triplane-19 sudo 前缀不影响 wrapper 识别");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "nohup bash -c \"cargo test -- my_case\"" }]).length, 1, "triplane-20 nohup 前缀不影响 wrapper 识别");
  // ---- 触发面三处放宽 + 一条命令只给一条整改建议(phase 26 D-17 / D-18,REQ-44 / REQ-45) ----
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo +nightly test -- my_case" }]).length, 1, "toolchain-1 cargo 工具链选择器(+nightly)是测试命令");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo +stable test -- my_case" }]).length, 1, "toolchain-2 cargo 工具链选择器(+stable)是测试命令");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "/usr/bin/env bash -c \"cargo test -- my_case\"" }]).length, 1, "toolchain-3 wrapper 词按 basename 认(env 带路径也认)");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "nice bash -c \"cargo test -- my_case\"" }]).length, 1, "toolchain-4 nice 前缀不影响 wrapper 识别");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "setsid bash -c \"cargo test -- my_case\"" }]).length, 1, "toolchain-5 setsid 前缀不影响 wrapper 识别");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "xargs -0 bash -c \"cargo test -- my_case\"" }]).length, 1, "toolchain-6 xargs 前缀不影响 wrapper 识别");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "bash -c \"bash -c 'bash -c \\\"cargo test -- my_case\\\"'\"" }]).length, 1, "toolchain-7 三层 wrapper 载荷里的命令看得见(深度上限 3)");
  eqN(checkZeroMatchErrors([{ id: "T1", verify: "cargo test -- --nocapture" }]).length, 0, "toolchain-8 全量套件命令零匹配门闭嘴(唯一建议归票预算门)");
  // 接线自测:函数算对了但接线空,门禁照样看不见那条命令 → 必须真的从检查器里看见判红。
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-triplane-"));
    try {
      mkdirSync(join(d, ".planning"), { recursive: true });
      writeFileSync(join(d, "a.mjs"), "x\n");
      const p = join(d, ".planning", "26-01-PLAN.md");
      writeFileSync(p, '---\nphase: "26"\nplan: "01"\ngoal: g\nrollback: r\nfiles_modified:\n  - a.mjs\ndepends_on: []\n---\n\n'
        + '### T1 事\n- **files**: a.mjs\n- **read_first**: a.mjs\n- **action**: 做\n- **verify**: bash -c "cargo test -- my_case"\n- **fails_when**: 退出码非 0(无 ok)\n- **done**: ok\n');
      let out = "", code = 0;
      try { out = execFileSync(process.execPath, [CHECKER, "--plan", p], { cwd: d, encoding: "utf8", stdio: "pipe", env: { ...process.env, GSD_TELEMETRY: "0", GSD_SANDBOX: "1", GSD_PROJECT_DIR: "" } }); }
      catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
      eqN(code !== 0 && out.includes("票级 verify 存在假绿漏洞"), true, "triplane 接线自测:wrapper 包住的触发命令,检查器要判红");
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
  // ---- 项目根解析必须尊重 GSD_PROJECT_DIR(phase 26 D-21,REQ-48):只设 GSD_PROJECT_DIR 时 root 不能落到 node 可执行文件路径 ----
  // 改前 root = argv[0](node.exe 所在目录)→ 夹具的 .planning 读不到 → 断言必红。
  {
    const d = mkdtempSync(join(tmpdir(), "mm-gsd-rootdir-"));
    try {
      mkdirSync(join(d, ".planning"), { recursive: true });
      writeFileSync(join(d, ".planning", "STATE.md"), "---\nstatus: planning\nactive_phase: \"01\"\n---\n");
      let out = "", code = 0;
      // cwd 另设别处:只靠 GSD_PROJECT_DIR 指夹具目录(不带 --planning)
      try { out = execFileSync(process.execPath, [CHECKER], { cwd: tmpdir(), encoding: "utf8", stdio: "pipe", env: { ...process.env, GSD_TELEMETRY: "0", GSD_SANDBOX: "1", GSD_PROJECT_DIR: d } }); }
      catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
      eqN(out.includes("声明=planning"), true, "rootdir-gsd-project-dir:只设 GSD_PROJECT_DIR 时检查器要读那个目录的 .planning");
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
  // ---- --phases 不可核验可见性(phase 26 D-02,REQ-33):模糊 files_modified 必须报警,且不能同时谎报「零重叠」 ----
  {
    const mkPhases = (d, files) => {
      mkdirSync(join(d, ".planning"), { recursive: true });
      writeFileSync(join(d, ".planning", "STATE.md"), "---\nstatus: executing\nactive_phase: \"02\"\n---\n\n## Phases\n\n- [ ] 01 — 甲\n- [ ] 02 — 乙\n");
      for (const [id, f] of files)
        writeFileSync(join(d, ".planning", `${id}-01-PLAN.md`), `---\nphase: "${id}"\nplan: "01"\ngoal: g\nrollback: r\nfiles_modified:\n  - ${f}\ndepends_on: []\n---\n`);
    };
    const runPhases = (d) => {
      let out = "", code = 0;
      // GSD_PROJECT_DIR 置空:它会让检查器改用别的 root,夹具就读不到自己的 STATE.md
      try { out = execFileSync(process.execPath, [CHECKER, "--phases"], { cwd: d, encoding: "utf8", stdio: "pipe", env: { ...process.env, GSD_TELEMETRY: "0", GSD_SANDBOX: "1", GSD_PROJECT_DIR: "" } }); }
      catch (e) { code = e.status ?? 1; out = String(e.stdout || "") + String(e.stderr || ""); }
      return { out, code };
    };
    // 夹具 A:两个 phase 的 files_modified 全是模糊语。模糊名必须**不同** ——
    // 同名会算出交集非空 → 走「冲突」分支 → 波次结论行整块跳过 → 断言变成空转。
    {
      const d = mkdtempSync(join(tmpdir(), "mm-gsd-phases-"));
      try {
        mkPhases(d, [["01", "相关文件"], ["02", "全部文件"]]);
        const r = runPhases(d);
        eqN(r.out.includes("无法核验文件冲突") && !r.out.includes("零重叠"), true, "--phases 模糊语 files_modified 报警且不谎报零重叠");
      } finally { rmSync(d, { recursive: true, force: true }); }
    }
    // 夹具 B:两个 phase 声明不同的精确文件 → 真核验通过,盖章「零重叠」
    {
      const d = mkdtempSync(join(tmpdir(), "mm-gsd-phases-"));
      try {
        mkPhases(d, [["01", "a.mjs"], ["02", "b.mjs"]]);
        const r = runPhases(d);
        eqN(r.out.includes("零重叠") && !r.out.includes("无法核验文件冲突"), true, "--phases 精确不重叠 files_modified 盖章零重叠");
      } finally { rmSync(d, { recursive: true, force: true }); }
    }
  }
}
