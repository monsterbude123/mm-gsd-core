// mmc 门禁的共享件(phase 30 下沉):根路径、显示助手、JSON 读取 ——
// 判定逻辑在 core-checks.mjs,命令层在 mmc.mjs,两边都从这里拿,不互相 import(防环)。
import { readFileSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const R = (...s) => join(ROOT, ...s);
export const HOME_SKILLS = join(homedir(), ".agents", "skills");
export const MANIFEST_NAME = ".mm-gsd-install.json";
export const CHECKER = R("skills", "mm-gsd-loop", "scripts", "gsd-state-check.mjs");
export const C = { r: "[31m", g: "[32m", y: "[33m", d: "[90m", b: "[1m", x: "[0m" };
export const log = (s = "") => console.log(s);
export const ok = (s) => log(`${C.g}✓${C.x} ${s}`);
export const warn = (s) => log(`${C.y}!${C.x} ${s}`);
export const bad = (s) => log(`${C.r}✗${C.x} ${s}`);
export const head = (s) => log(`
${C.b}${s}${C.x}`);
export const rel = (p) => relative(ROOT, p).split(sep).join("/");
export const readJSON = (p, fallback) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; } };
export const pathBase = (p) => p.split("/").pop();
