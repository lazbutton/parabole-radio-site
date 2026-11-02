/** Les rubriques du site. `page` se retrouve dans <html data-page>, que lisent les styles et les scripts. */
export type Page = "accueil" | "show" | "residents" | "event" | "about" | "introuvable";

/**
 * Le menu de l'en-tête, comme sur la maquette du 2 novembre : ÉMISSIONS · RÉSIDENTS · ÉVÉNEMENTS · À PROPOS. L'accueil,
 * c'est le logo. Sur téléphone, chaque rubrique est une page du sommaire en télétexte (`teletexte`, son numéro). Les
 * anciennes adresses (/show, /event, /about) redirigent vers celles-ci (astro.config.mjs).
 */
export const MENU: { page: Page; href: string; label: string; teletexte: number }[] = [
  { page: "show", href: "/emissions", label: "Émissions", teletexte: 200 },
  { page: "residents", href: "/residents", label: "Résidents", teletexte: 300 },
  { page: "event", href: "/evenements", label: "Événements", teletexte: 400 },
  { page: "about", href: "/a-propos", label: "À propos", teletexte: 500 },
];
