"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";

const MobileSidebarContext = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

/**
 * Sidebar nav is a full page reload on every link (plain `<a>`, no
 * client-side router) — so there's no need to close the drawer on
 * navigate, a fresh page load already resets this state.
 */
export function MobileSidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <MobileSidebarContext.Provider value={{ open, setOpen }}>{children}</MobileSidebarContext.Provider>;
}

function useMobileSidebar() {
  const context = useContext(MobileSidebarContext);
  if (!context) throw new Error("useMobileSidebar must be used within MobileSidebarProvider");
  return context;
}

export function MobileMenuButton() {
  const { setOpen } = useMobileSidebar();
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden"
      aria-label="Open menu"
    >
      <Icon path={NAV_ICON_PATHS.menu} size={20} />
    </button>
  );
}

export function MobileSidebarFrame({ children }: { children: ReactNode }) {
  const { open, setOpen } = useMobileSidebar();
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`${open ? "flex" : "hidden"} fixed inset-y-0 start-0 z-50 w-72 shrink-0 flex-col justify-between overflow-y-auto bg-slate-900 px-4 py-6 lg:static lg:z-auto lg:flex lg:w-60`}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute end-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
          aria-label="Close menu"
        >
          <Icon path={NAV_ICON_PATHS.close} size={18} />
        </button>
        {children}
      </aside>
    </>
  );
}
