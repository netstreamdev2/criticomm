/**
 * How the console's sidebar shows, as each person prefers it (as Supabase):
 * always open, collapsed to its icons, or icons that open while the pointer
 * is over them. Kept in this browser only; it is a matter of taste, not data.
 */
export type SidebarMode = 'expanded' | 'collapsed' | 'hover';

export const SIDEBAR_MODES: ReadonlyArray<{ mode: SidebarMode; label: string }> = [
  { mode: 'expanded', label: 'Expanded' },
  { mode: 'collapsed', label: 'Collapsed' },
  { mode: 'hover', label: 'Expand on hover' },
];

export const SIDEBAR_MODE_KEY = 'criticom:sidebar-mode';
/** The rail's width when collapsed, and the sidebar's when open (px). */
export const RAIL_WIDTH = 64;
export const WIDE_WIDTH = 264;

export const isSidebarMode = (v: unknown): v is SidebarMode => v === 'expanded' || v === 'collapsed' || v === 'hover';

/** The page's column for the sidebar: open only when it stays open. */
export const columnWidth = (mode: SidebarMode) => (mode === 'expanded' ? WIDE_WIDTH : RAIL_WIDTH);

/** Sets the column before first paint, so a collapsed sidebar never flashes open. Inline and synchronous. */
export const SIDEBAR_INIT_SCRIPT = `(function(){try{
var m=localStorage.getItem('${SIDEBAR_MODE_KEY}');
if(m==='collapsed'||m==='hover'){document.documentElement.style.setProperty('--sidebar-w','${RAIL_WIDTH}px');document.documentElement.setAttribute('data-sidebar',m);}
}catch(e){}})();`;
