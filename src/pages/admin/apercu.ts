/**
 * POST /admin/apercu : l'aperçu d'un texte en Markdown, rendu comme sur le site (src/lib/markdown.ts, sans HTML
 * brut). Derrière la garde de l'admin, comme tout /admin ; le formulaire vient de la page (vérification d'origine).
 */
import type { APIRoute } from "astro";
import { renderMarkdown } from "../../lib/markdown";

export const prerender = false;

const LIMIT = 20_000;

export const POST: APIRoute = async ({ request }) => {
  const data = await request.formData();
  const text = String(data.get("texte") ?? "").slice(0, LIMIT);
  return new Response(renderMarkdown(text), { headers: { "Content-Type": "text/html; charset=utf-8" } });
};
