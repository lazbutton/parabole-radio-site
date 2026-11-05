/**
 * Les images de la page d'envoi d'un résident (cms/README.md, 9.12) : la pochette d'une émission, sa photo d'artiste.
 * Le même contrat que l'envoi des images de l'admin (src/pages/admin/api/media/[action].ts, que reprend ImageField), le
 * jeton du lien en plus : sans lien valide, rien n'est signé ni inscrit.
 *
 *   - upload : le serveur signe le dépôt de l'original dans le seau « originaux » ;
 *   - finalize : il en tire les versions du site et inscrit l'image, qui ne sert encore à rien ; la page la met ensuite
 *     à sa place (la pochette avec l'émission, la photo avec la fiche) ;
 *   - abandon : une image envoyée qui n'a pas trouvé sa place, retirée.
 */
import { readMediaText } from "@parabole/cms";
import type { APIRoute } from "astro";
import { discardOriginal, prepare, removeImages, storageReady, uploadTicket, type Shape } from "../../../../lib/admin/storage";
import { mediaView } from "../../../../lib/admin/views";
import { envoisDuSite, reply } from "../../../../lib/envois";

export const prerender = false;

export const POST: APIRoute = async ({ params, request }) => {
  const data = await request.formData();
  const text = (name: string) => String(data.get(name) ?? "");
  const refused = (errors: Record<string, string>, status = 422) => reply({ ok: false, errors }, status);
  const jeton = text("jeton");
  const envois = await envoisDuSite();
  if (!(await envois.connu(jeton))) return refused({ image: "Ce lien ne marche plus : demande-en un nouveau à l'équipe." }, 404);

  switch (params.action) {
    case "upload": {
      if (!storageReady()) return refused({ image: "L'envoi des images n'est pas encore branché : préviens l'équipe." }, 503);
      const ticket = await uploadTicket(text("type"), Number(text("size")));
      return "error" in ticket ? refused({ image: ticket.error }) : reply({ ok: true, ...ticket });
    }

    case "finalize": {
      if (!storageReady()) return refused({ image: "L'envoi des images n'est pas encore branché." }, 503);
      const described = readMediaText({ alt: text("alt"), credit: text("credit"), decorative: text("decorative") === "on" });
      if (Object.keys(described.errors).length) {
        await discardOriginal(text("path"));
        return refused(described.errors);
      }
      const shape: Shape = text("shape") === "square" ? "square" : "free";
      const prepared = await prepare(text("path"), shape, Number.parseFloat(text("focus")));
      if ("error" in prepared) return refused({ image: prepared.error });
      const added = await envois.ajouterImage(jeton, { ...prepared.file, ...described.values });
      if (!added.ok) {
        await removeImages(prepared.keys);
        return refused(added.errors);
      }
      return reply({ ok: true, image: mediaView(added.media) });
    }

    case "abandon": {
      await removeImages(await envois.abandonnerImage(jeton, text("id")));
      return reply({ ok: true });
    }
  }
  return refused({ form: "Action inconnue." }, 404);
};
