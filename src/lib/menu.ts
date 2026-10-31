/** Les rubriques du site. `page` se retrouve dans <html data-page>, que lisent les styles et les scripts. */
export type Page = "accueil" | "show" | "residents" | "event" | "about" | "introuvable";

/** Le menu de la barre du haut, comme sur la maquette : SHOW · RESIDENTS · EVENT · ABOUT. L'accueil, c'est le logo. */
export const MENU: { page: Page; href: string; label: string }[] = [
  { page: "show", href: "/show", label: "Show" },
  { page: "residents", href: "/residents", label: "Residents" },
  { page: "event", href: "/event", label: "Event" },
  { page: "about", href: "/about", label: "About" },
];
