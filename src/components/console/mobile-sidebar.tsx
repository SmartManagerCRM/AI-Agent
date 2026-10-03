"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";

const MobileSidebarContext = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

/**
 * Sidebar links are client-side `<Link>` navigations, so the layout (and
 * this provider) survives them. The drawer's open state is remembered
 * against the pathname it was opened on — navigating anywhere else closes
 * it, exactly as the old full-page reloads did.
 */
export function MobileSidebarProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn !== null && openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);
  return <MobileSidebarContext.Provider value={{ open, setOpen }}>{children}</MobileSidebarContext.Provider>;
}

function useMobileSidebar() {
  const context = useContext(MobileSidebarContext);
  if (!context) throw new Error("useMobileSidebar must be used within MobileSidebarProvider");
  return context;
}

export function MobileMenuButton() {
  const { setOpen } = useMobileSidebar();
  const t = useTranslations("common");
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden"
      aria-label={t("openMenu")}
    >
      <Icon path={NAV_ICON_PATHS.menu} size={20} />
    </button>
  );
}

function readSavedScroll(key: string): number | null {
  try {
    const value = Number(window.sessionStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * The sidebar scrolls on its own (sticky beside the page on desktop, a
 * drawer on mobile), so choosing a page never moves it: its position is kept
 * across navigations, when the drawer reopens, and across a full reload.
 */
export function MobileSidebarFrame({ name, children }: { name: "tenant" | "platform"; children: ReactNode }) {
  const { open, setOpen } = useMobileSidebar();
  const t = useTranslations("common");
  const storageKey = `${name}-sidebar-scroll`;
  const asideRef = useRef<HTMLElement>(null);
  const scrollTop = useRef<number | null>(null);

  // First paint: back to where it was before a reload, or else make sure the current page's link is in view.
  useLayoutEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;
    const saved = readSavedScroll(storageKey);
    if (saved !== null) {
      scrollTop.current = saved;
      aside.scrollTop = saved;
      return;
    }
    const active = aside.querySelector<HTMLElement>('[aria-current="page"]');
    if (active && aside.clientHeight > 0) {
      const box = aside.getBoundingClientRect();
      const link = active.getBoundingClientRect();
      if (link.bottom > box.bottom || link.top < box.top) aside.scrollTop += link.top - box.top - box.height / 2 + link.height / 2;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on first paint; the key never changes
  }, []);

  // A hidden drawer loses its scroll position; put it back when it opens again.
  useLayoutEffect(() => {
    if (open && asideRef.current && scrollTop.current !== null) asideRef.current.scrollTop = scrollTop.current;
  }, [open]);

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
        ref={asideRef}
        data-testid="console-sidebar"
        onScroll={(e) => {
          const top = e.currentTarget.scrollTop;
          // A drawer being hidden reports 0 — that's not the person scrolling.
          if (e.currentTarget.clientHeight === 0) return;
          scrollTop.current = top;
          try {
            window.sessionStorage.setItem(storageKey, String(Math.round(top)));
          } catch {
            // Storage blocked: the position is still kept for this visit.
          }
        }}
        className={`${open ? "flex" : "hidden"} fixed inset-y-0 start-0 z-50 w-72 shrink-0 flex-col justify-between overflow-y-auto overscroll-contain bg-slate-900 px-4 py-6 lg:sticky lg:top-0 lg:z-auto lg:flex lg:h-screen lg:w-60 lg:self-start`}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute end-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
          aria-label={t("closeMenu")}
        >
          <Icon path={NAV_ICON_PATHS.close} size={18} />
        </button>
        {children}
      </aside>
    </>
  );
}
