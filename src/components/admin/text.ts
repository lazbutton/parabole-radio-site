/** Les petits outils de texte de l'admin. */

/** Le même texte, sans les accents, les majuscules ni les espaces en trop : « Éloïse » retrouve « eloise ». */
export const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** « 1 show », « 3 shows » ; le pluriel n'est pas toujours un s (« morceaux »). */
export const counted = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/** L'initiale d'un nom, pour un avatar sans photo. */
export const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";
