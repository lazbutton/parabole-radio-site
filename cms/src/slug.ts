/** L'adresse d'un contenu : minuscules sans accents, chiffres, tirets simples. « Nuit Parabole #3 » → « nuit-parabole-3 ». */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

/** Le format que la base exige (contrainte *_slug_format). */
export const isSlug = (value: unknown): value is string => typeof value === "string" && value.length <= 200 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value);
