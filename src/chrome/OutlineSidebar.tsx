import type { OutlineItem } from "../editor/outline";
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
  return (
    <aside className="sidebar" aria-label="Document">
      <p className="sidebar-label">Outline</p>
      {outline.length === 0 ? (
        <p className="sidebar-empty">No headings</p>
      ) : (
        <nav aria-label="Headings">
          {outline.map((item) => (
            <button
              key={`${item.pos}-${item.text}`}
              type="button"
              className="outline-item"
              style={{ paddingLeft: `${(item.level - 1) * 0.7 + 0.45}rem` }}
              onClick={() => onJump(item.pos)}
            >
              {item.text}
            </button>
          ))}
        </nav>
      )}
      <p className="sidebar-label recent-label">Recent</p>
      {recent.length === 0 ? (
        <p className="sidebar-empty">No recent files</p>
      ) : (
        <nav aria-label="Recent files">
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
