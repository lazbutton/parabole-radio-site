/** Les adresses de l'admin. */

/** L'adresse où revenir après la connexion : une page de l'admin seulement, jamais un autre site. */
export function safeReturn(value: string | null | undefined): string {
  return value && !value.includes("\\") && /^\/admin(?:[/?#]|$)/.test(value) ? value : "/admin";
}

/** Une redirection après un envoi de formulaire, toujours en GET (303). */
export const seeOther = (location: string) => new Response(null, { status: 303, headers: { Location: location } });
