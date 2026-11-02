/**
 * L'envoi des images de l'admin (cms/README.md, 9.3), en POST, réponses en JSON. Derrière la garde de l'admin, comme
 * tout /admin : la session et la fiche d'équipe sont vérifiées, puis la base vérifie encore les droits.
 *
 *   - upload : le navigateur annonce un fichier (type, poids) ; le serveur signe son dépôt dans le seau « originaux » ;
 *   - finalize : l'original déposé, le serveur en tire les versions du site (src/lib/admin/storage.ts) et inscrit
 *     l'image, avec son texte alternatif et son crédit ; elle ne sert encore à rien, la fiche la met ensuite à sa place ;
 *   - describe : le texte alternatif et le crédit d'une image, changés ;
 *   - abandon : une image envoyée qui n'a pas trouvé sa place (la fiche a disparu entre-temps…), retirée si elle ne sert
 *     à rien.
 */
import { readMediaText } from "@parabole/cms";
import type { APIRoute } from "astro";
import { discardOriginal, prepare, removeImages, storageReady, uploadTicket, type Shape } from "../../../../lib/admin/storage";
import { json, mediaView } from "../../../../lib/admin/views";

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals }) => {
  const admin = locals.admin!;
  const data = await request.formData();
  const text = (name: string) => String(data.get(name) ?? "");
  const refused = (errors: Record<string, string>, status = 422) => json({ ok: false, errors }, status);

  switch (params.action) {
    case "upload": {
      if (!storageReady()) return refused({ image: "L'envoi des images n'est pas branché : il manque la clé secrète de Supabase (SUPABASE_SECRET_KEY)." }, 503);
      const ticket = await uploadTicket(text("type"), Number(text("size")));
      return "error" in ticket ? refused({ image: ticket.error }) : json({ ok: true, ...ticket });
    }

    case "finalize": {
      if (!storageReady()) return refused({ image: "L'envoi des images n'est pas branché." }, 503);
      // Le texte d'abord : une image sans texte alternatif ne vaut pas la peine d'être préparée.
      const described = readMediaText({ alt: text("alt"), credit: text("credit"), decorative: text("decorative") === "on" });
      if (Object.keys(described.errors).length) {
        // L'écran renverra le fichier avec le texte corrigé : l'original déjà déposé ne servira pas.
        await discardOriginal(text("path"));
        return refused(described.errors);
      }
      const shape: Shape = text("shape") === "square" ? "square" : "free";
      const prepared = await prepare(text("path"), shape, Number.parseFloat(text("focus")));
      if ("error" in prepared) return refused({ image: prepared.error });
      const added = await admin.addMedia({ ...prepared.file, ...described.values });
      if (!added.ok) {
        await removeImages(prepared.keys);
        return refused(added.errors);
      }
      return json({ ok: true, image: mediaView(added.media) });
    }

    case "describe": {
      const described = readMediaText({ alt: text("alt"), credit: text("credit"), decorative: text("decorative") === "on" });
      if (Object.keys(described.errors).length) return refused(described.errors);
      const saved = await admin.describeMedia(text("id"), described.values);
      return saved.ok ? json({ ok: true, image: mediaView(saved.media) }) : refused(saved.errors);
    }

    case "abandon": {
      await removeImages(await admin.releaseMedia([text("id")]));
      return json({ ok: true });
    }
  }
  return refused({ form: "Action inconnue." }, 404);
};
