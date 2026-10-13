import type { OutlineItem } from "../editor/outline";
import { useI18n } from "../i18n";
import { recentName, type RecentFile } from "../recent";

interface OutlineSidebarProps {
  outline: OutlineItem[];
  recent: RecentFile[];
  currentPath: string | null;
  onJump: (pos: number) => void;
  onOpenRecent: (path: string) => void;
}

export function OutlineSidebar({
  outline,
  recent,
  currentPath,
  onJump,
  onOpenRecent,
}: OutlineSidebarProps) {
  const { t } = useI18n();
  return (
    <aside className="sidebar" aria-label={t("sidebar.document")}>
      <p className="sidebar-label">{t("sidebar.outline")}</p>
      {outline.length === 0 ? (
        <p className="sidebar-empty">{t("sidebar.noHeadings")}</p>
      ) : (
        <nav aria-label={t("sidebar.headings")}>
          {outline.map((item) => (
            <button
              key={`${item.pos}-${item.text}`}
              type="button"
              className="outline-item"
              style={{ paddingLeft: `${(item.level - 1) * 0.7 + 0.45}rem` }}
              onClick={() => onJump(item.pos)}
            >
              {item.text || t("doc.untitled")}
            </button>
          ))}
        </nav>
      )}
      <p className="sidebar-label recent-label">{t("sidebar.recent")}</p>
      {recent.length === 0 ? (
        <p className="sidebar-empty">{t("sidebar.noRecent")}</p>
      ) : (
        <nav aria-label={t("sidebar.recentFiles")}>
          {recent.map((item) => (
            <button
              key={item.path}
              type="button"
              className={item.path === currentPath ? "outline-item active" : "outline-item"}
              title={item.path}
              onClick={() => onOpenRecent(item.path)}
            >
              {recentName(item.path)}
            </button>
          ))}
        </nav>
      )}
    </aside>
  );
}
