/**
 * Clair, sombre, ou comme le système : un réglage de ce navigateur seulement (localStorage), choisi dans le menu du
 * compte ou depuis la recherche (⌘K). Le gabarit (src/layouts/Admin.astro) le pose avant le premier affichage ; ici,
 * on le change et on suit le système quand il bascule. Radix Themes lit la classe `dark` de la page.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Appearance = "system" | "light" | "dark";

const KEY = "admin-apparence";

function stored(): Appearance {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

const systemPrefersDark = () => typeof window !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;

type AppearanceState = { appearance: Appearance; dark: boolean; change(value: Appearance): void };

const AppearanceContext = createContext<AppearanceState>({ appearance: "system", dark: false, change: () => {} });

/** L'apparence choisie, sombre ou non, et de quoi la changer. */
export const useAppearance = () => useContext(AppearanceContext);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  // Lu tout de suite côté navigateur : seul le menu du compte l'affiche, et il n'est rendu qu'une fois ouvert.
  const [appearance, setAppearance] = useState<Appearance>(() => (typeof window === "undefined" ? "system" : stored()));
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const dark = appearance === "dark" || (appearance === "system" && systemDark);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const follow = () => setSystemDark(media.matches);
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const change = useCallback((value: Appearance) => {
    try {
      if (value === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, value);
    } catch {
      // Navigation privée : le choix vaut pour cette visite.
    }
    setAppearance(value);
  }, []);

  const state = useMemo(() => ({ appearance, dark, change }), [appearance, dark, change]);
  return <AppearanceContext.Provider value={state}>{children}</AppearanceContext.Provider>;
}
