# mm-gsd-plan 验收形态库(正文外迁的知识,写 verify 时按需读)

> 判据语义与 SKILL.md「验收反模式」同源;本文件存的是可直接抄的命令形态与细节。

## 验收反模式全清单(出现即打回)

- 禁止主观语:"looks correct"/"works properly"/"完成该功能"
- grep 卫生:`grep -c` 会数注释,用 `grep -v '^#' | grep -c token`;禁裸 `== 0` 门
- 验证字面量不得出现在 action 正文(否则执行者照抄造绿)
- `|| true` / `2>/dev/null || echo 0` 喂比较 = 假验证
- **断言必须落在真命令上** —— 写在 `#` 注释里的标记不算断言(那是人写的期望,不是命令的输出);断言词必须来自本票测试命令的输出,别用 `echo` 自己造标记
- **命令量错树**(多 worktree 项目):frontmatter 必须写 `cwd: <执行树根>`,票面命令里的 `cd <路径>` 不得指向别的树 —— 主检出 ≠ 执行树,量错树的判据绿了也白绿(issue #16:36/36 票判据量错树);门禁对 cwd 不一致判红,缺 cwd 却有 cd 会提示补字段;`$VAR` 类 cd 判不了不猜

## 判据在零数据输入下会绿(写完每条 verify 自问:空台账/零匹配/空输入下,退出几、输出什么?)

`grep -c` 的退出码被吞(`$()` 捕获或 `|| true`)时必须有数值比较防护;裸 `grep -c`(零匹配即 exit 1)不算错;`grep -v` 与 `echo`/`printf` **不提供断言标记** —— `grep -v` 的退出码在零匹配输出与真跑过输出上都是 0,没有判别力;注释里或自己 echo 出来的字面量不是命令的输出。零匹配时 go 打印 `no tests to run`、cargo 打印 `test result: ok. 0 passed`,两者都 exit 0 —— 零匹配的输出签名本身**不算断言**,只断言「跑过了」等于没断言(issue #10 证据 1-4、issue #22)。

`go test -run <过滤器>` 与 `cargo test -- <过滤器>`:过滤器要指名到具体用例,断言也要指名到**跑过的痕迹** —— 可直接抄的形态:

- go 正面:`grep -q -- "--- PASS" o.txt`(go 要 `-v` 才打印 `--- PASS`)
- cargo 正面:`grep -qE "test result: ok\. [1-9][0-9]* passed" o.txt` 或 `grep -q "running 1 test" o.txt`(`running 1 test` 是**单数**形态 —— cargo 只有一个用例时真的这么打印)
- `N` 是**占位符**,不是字面量:要写实际数字(`3 passed`)或 `[1-9][0-9]*` 字符类形态,照抄 `N passed` 必红。`[1-9]` 后面不许跟量词(`?`/`*`/`+`)—— `[1-9]?[0-9]* passed` 与 `[1-9]+ passed` 能匹配 0,门禁不认。
- go 否定式:`! grep -q "no tests to run" o.txt`
- cargo 否定式:`! grep -q "running 0 tests" o.txt` 或 `! grep -qE "test result: ok\. 0 passed" o.txt`(必须**全匹配**:裸 `0 passed` 是 "10 passed" 的子串会假红;`test result: ok` 真跑过时也打印,不认)
- 真过滤器形态三例:`cargo test -- --exact my_case` / `cargo test -- --skip x` / `cargo test -- my_case`(按用例名收窄,零匹配时同样 exit 0,须写判别性断言)
- `--` 后没有 token、或只跟一个以 `-` 开头的 token 时,命令跑的是全量套件,门禁只给「搬到 batch_verify」一条建议,不要求判别性断言;`--` 后跟位置参数名或两个及以上 token 才是收窄的过滤器形态,须写判别性断言。
- 捕获退出码的赋值必须与被测命令**相邻**,中间不得插入任何命令(`local`/`echo`/`printf`/`cd` 都会重置 `$?`,issue #24:`<cmd>; local c; c=$?` 恒 0);复合脚本写 `code=$?` 紧跟被测命令,或 `if cmd; then …; else code=$?; fi`。

## 规划者失效模式(逐条自查)

1. **"执行时再说"**——文件清单不全、依赖不声明、验收标准写"看情况"。执行期要猜的东西一律现在写清。
2. **预算超了就缩内容**而不拆票("先做个简化版"= 缩水禁令);正解是拆。
3. 验收标准写自己能读懂的,不是能跑的(测试名/命令/CLI 输出)。
4. 难的任务推到执行期"到时候再看"——难是拆票的理由,不是推迟的理由。
5. 复制上一 phase 的 verify 命令,不看它在当前上下文还成不成立。
6. 决策保真偷懒:D-NN 只提一句不复述精确语义,执行时按自己的理解实现。
7. 依赖/文件重叠没算清,并行计划互相踩文件(同 wave 零重叠是硬约束)。
