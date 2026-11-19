import { X } from "lucide-react";
import { useEffect } from "react";

interface BoardGuideModalProps {
  open: boolean;
  onClose: () => void;
}

const GUIDE_ITEMS = [
  {
    title: "01. 可选包边界与只读渲染",
    detail:
      "过程看板是 mm-gsd-core 的可选扩展，仅绑本机 127.0.0.1 回环端口实时读取 .planning/ 工件与 ~/.agents/mm-gsd-board.json 注册名单，不篡改 PLAN / STATE / LEDGER 原件。",
  },
  {
    title: "02. 唯一写通道：POST /api/annotations",
    detail:
      "看板唯一写动作是向当前项目的 .planning/annotations.json 追加 open 状态批注。后续在 discuss 或 plan 会话中输入「有新批注」即可按批注类型消化分流。",
  },
  {
    title: "03. 单一真相来源与同口径汇总",
    detail:
      "Phase 拓扑、REQ 溯源与依赖网、三源欠账（本地账台账处置、未消化批注、未清偿挂账）及工具遥测均与 CLI 检查器共享同一套口径函数，确保屏上与命令行一致。",
  },
  {
    title: "04. 客户端零延迟检索与聚焦邻域",
    detail:
      "需求过滤与 REQ 依赖邻域聚焦全部在本地内存瞬时完成，不产生额外网络请求；一键点修与一键诊断内置 open 批注去重，防止重复落盘。",
  },
];

export function BoardGuideModal({ open, onClose }: BoardGuideModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="mm-gsd 过程看板契约说明"
        className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-[#0D1320] dark:text-slate-100"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              过程看板契约与操作指引
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              服务「看与管」的只读聚合界面 + 唯一批注写通道
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭指引弹窗"
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {GUIDE_ITEMS.map((item) => (
            <div
              key={item.title}
              className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-[#090D16]"
            >
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                {item.title}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {item.detail}
              </p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3.5 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <span className="font-mono">按 ESC 或点击遮罩关闭</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-900 px-4 py-1.5 font-medium text-white hover:bg-slate-800 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
