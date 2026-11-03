/**
 * Les fiches ouvertes récemment, pour les retrouver d'un coup dans la recherche (⌘K). Une commodité de ce navigateur
 * (localStorage) : rien ne part au serveur, et une liste perdue (navigation privée, données effacées) ne gêne en rien.
 */
export type Recent = { href: string; title: string; kind: "show" | "artist" | "event" };

const KEY = "admin-recents";
const KEEP = 6;

export function readRecents(): Recent[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list)
      ? list.filter((item): item is Recent => typeof item?.href === "string" && typeof item?.title === "string" && ["show", "artist", "event"].includes(item.kind))
      : [];
  } catch {
    return [];
  }
}

function write(list: Recent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, KEEP)));
  } catch {
    // Pas de stockage : tant pis pour les récents.
  }
}

/** Une fiche ouverte (ou renommée) passe en tête. */
export const rememberRecent = (item: Recent) => write([item, ...readRecents().filter((other) => other.href !== item.href)]);

/** Une fiche supprimée sort de la liste. */
export const forgetRecent = (href: string) => write(readRecents().filter((other) => other.href !== href));
