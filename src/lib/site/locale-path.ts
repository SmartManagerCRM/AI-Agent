import { LOCALES, type Locale } from "@/i18n/locales";

/** The same page in another language: the locale prefix swapped (the bare root becomes /<locale>). */
export function localePath(pathname: string | null, target: Locale): string {
  if (!pathname || pathname === "/") return `/${target}`;
  const segments = pathname.split("/");
  if ((LOCALES as readonly string[]).includes(segments[1] ?? "")) segments[1] = target;
  else segments.splice(1, 0, target);
  return segments.join("/") || `/${target}`;
}
