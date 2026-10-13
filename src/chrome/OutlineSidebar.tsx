import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { OutlineItem } from "../editor/outline";
import { useI18n } from "../i18n";
import { recentName, type RecentFile } from "../recent";

interface OutlineSidebarProps {
  outline: OutlineItem[];
  recent: RecentFile[];
  currentPath: string | null;
  activePos: number | null;
  onJump: (pos: number) => void;
  onOpenRecent: (path: string) => void;
}

type SidebarTab = "files" | "outline";

const TAB_KEY = "markdown-editor.sidebar-tab";

function readTab(): SidebarTab {
  try {
    return localStorage.getItem(TAB_KEY) === "files" ? "files" : "outline";
  } catch {
    return "outline";
  }
}

export function OutlineSidebar({
  outline,
  recent,
  currentPath,
  activePos,
  onJump,
  onOpenRecent,
}: OutlineSidebarProps) {
  const { t } = useI18n();
  const [tab, setTab] = useState<SidebarTab>(readTab);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* ignore quota / private mode */
    }
  }, [tab]);

  useEffect(() => {
    if (tab !== "outline") return;
    const panel = panelRef.current;
    const current = panel?.querySelector<HTMLElement>(".outline-item.active");
    if (!panel || !current) return;
    const panelBox = panel.getBoundingClientRect();
    const itemBox = current.getBoundingClientRect();
    if (itemBox.top < panelBox.top) {
      panel.scrollTop -= panelBox.top - itemBox.top;
    } else if (itemBox.bottom > panelBox.bottom) {
      panel.scrollTop += itemBox.bottom - panelBox.bottom;
    }
  }, [activePos, tab, outline]);

  function onTabsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setTab("outline");
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setTab("files");
    }
  }

  return (
    <aside className="sidebar" aria-label={t("sidebar.document")}>
      <div className="sidebar-tabs" role="tablist" onKeyDown={onTabsKeyDown}>
        <button
          type="button"
          role="tab"
          id="sidebar-tab-files"
          className="sidebar-tab"
          aria-selected={tab === "files"}
          aria-controls="sidebar-panel-files"
          tabIndex={tab === "files" ? 0 : -1}
          onClick={() => setTab("files")}
        >
          {t("sidebar.files")}
        </button>
        <button
          type="button"
          role="tab"
          id="sidebar-tab-outline"
          className="sidebar-tab"
          aria-selected={tab === "outline"}
          aria-controls="sidebar-panel-outline"
          tabIndex={tab === "outline" ? 0 : -1}
          onClick={() => setTab("outline")}
        >
          {t("sidebar.outline")}
        </button>
      </div>
      {tab === "files" ? (
        <div
          id="sidebar-panel-files"
          className="sidebar-panel"
          role="tabpanel"
          aria-labelledby="sidebar-tab-files"
        >
          {recent.length === 0 ? (
            <p className="sidebar-empty">{t("sidebar.noRecent")}</p>
          ) : (
            <nav aria-label={t("sidebar.recentFiles")}>
              {recent.map((item) => {
                const active = item.path === currentPath;
                return (
                  <button
                    key={item.path}
                    type="button"
                    className={active ? "outline-item file-item active" : "outline-item file-item"}
                    title={item.path}
                    aria-current={active ? "true" : undefined}
                    onClick={() => onOpenRecent(item.path)}
                  >
                    {recentName(item.path)}
                  </button>
                );
              })}
            </nav>
          )}
        </div>
      ) : (
        <div
          ref={panelRef}
          id="sidebar-panel-outline"
          className="sidebar-panel"
          role="tabpanel"
          aria-labelledby="sidebar-tab-outline"
        >
          {outline.length === 0 ? (
            <p className="sidebar-empty">{t("sidebar.noHeadings")}</p>
          ) : (
            <nav aria-label={t("sidebar.headings")}>
              {outline.map((item) => {
                const active = item.pos === activePos;
                return (
                  <button
                    key={`${item.pos}-${item.level}-${item.text}`}
                    type="button"
                    className={active ? "outline-item active" : "outline-item"}
                    style={{ paddingLeft: `${0.65 + (item.level - 1) * 0.85}rem` }}
                    title={item.text || t("doc.untitled")}
                    aria-current={active ? "location" : undefined}
                    onClick={() => onJump(item.pos)}
                  >
                    {item.text || t("doc.untitled")}
                  </button>
                );
              })}
            </nav>
          )}
        </div>
      )}
    </aside>
  );
}
