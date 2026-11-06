/**
 * Les candidatures (cms/README.md, 9.17), côté site : la page /candidater lit les réglages (les types ouverts, le délai
 * de réponse annoncé, les styles à cocher) et y dépose une candidature. Le serveur écrit en propriétaire des tables,
 * une fois la saisie revérifiée (lireCandidature, les mêmes règles que la page) : le public n'a aucun droit sur ces
 * tables. Rien de l'auditeur n'est gardé d'autre que ce qu'il écrit : pas d'adresse IP. Contre les envois en masse,
 * outre la vérification Turnstile de la route : une candidature en cours par compte Instagram ou par adresse e-mail, et
 * un plafond par heure pour toutes. La tâche de nuit efface les refus six mois après la réponse.
 */
import { and, asc, count, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db.ts";
import { application, applicationSettings, applicationTag, facet, tag, tagGroup, type ShowType } from "../schema.ts";
import { lireCandidature, TYPES_AU_PLURIEL, type CandidatureErrors, type CandidatureForm, type TypeCandidature } from "./regles.ts";

/** Au plus, tant de candidatures par heure, toutes ensemble : de quoi arrêter un envoi en masse sans rien garder de personne. */
export const PAR_HEURE = 30;
/** Un refus est effacé tant de mois après la réponse. */
export const MOIS_GARDES = 6;
/** Les réglages d'une base qui n'aurait pas encore sa ligne. */
const REGLAGES_PAR_DEFAUT: Reglages = { openTypes: ["dj_set", "podcast", "playlist"], replyDays: 21 };

export type Reglages = { openTypes: ShowType[]; replyDays: number };

/** Les styles à cocher pour un type : les groupes du premier filtre des émissions qui vaut pour lui. */
export type StylesDuType = { type: TypeCandidature; filtre: string; groupes: { slug: string; name: string }[] };

export type Depot = { ok: true; id: string } | { ok: false; errors: CandidatureErrors; status: 409 | 422 | 429 };

/** Les groupes des filtres des émissions qui valent pour un type (cardinality nulle : tous les types). */
const groupesDuType = (type: ShowType) =>
  and(eq(facet.scope, "show"), sql`(cardinality(${facet.showTypes}) = 0 or ${type}::public.show_type = any(${facet.showTypes}))`);

/** Il y a tant de mois, à la même heure. */
function moisAvant(date: Date, mois: number): Date {
  const avant = new Date(date);
  avant.setUTCMonth(avant.getUTCMonth() - mois);
  return avant;
}

export function createCandidatures(db: Db, { now: clock = () => new Date() }: { now?: () => Date } = {}) {
  async function reglages(): Promise<Reglages> {
    const [ligne] = await db.select({ openTypes: applicationSettings.openTypes, replyDays: applicationSettings.replyDays }).from(applicationSettings).limit(1);
    return ligne ?? REGLAGES_PAR_DEFAUT;
  }

  return {
    reglages,

    /** Les styles à cocher, type par type : les groupes du premier filtre des émissions de chaque type, dans l'ordre. */
    styles: async (): Promise<StylesDuType[]> => {
      const types: TypeCandidature[] = ["dj_set", "podcast", "playlist"];
      return Promise.all(
        types.map(async (type) => {
          const [premier] = await db.select({ id: facet.id, name: facet.name }).from(facet).where(groupesDuType(type)).orderBy(asc(facet.position), asc(facet.name)).limit(1);
          if (!premier) return { type, filtre: "", groupes: [] };
          const groupes = await db
            .select({ slug: tag.slug, name: tag.name })
            .from(tagGroup)
            .innerJoin(tag, eq(tag.id, tagGroup.tagId))
            .where(eq(tagGroup.facetId, premier.id))
            .orderBy(asc(tagGroup.position), asc(tag.name));
          return { type, filtre: premier.name, groupes };
        }),
      );
    },

    /**
     * Dépose une candidature : revérifiée, puis refusée si son type est fermé, si la même personne (son Instagram ou son
     * e-mail) en a déjà une en cours, ou si trop sont arrivées dans l'heure. Ses styles sont gardés s'ils sont bien des
     * groupes des filtres de son type ; les autres sont ignorés.
     */
    deposer: (form: CandidatureForm): Promise<Depot> =>
      db.transaction(async (tx): Promise<Depot> => {
        const lu = lireCandidature(form);
        if (!lu.values) return { ok: false, errors: lu.errors, status: 422 };
        const values = lu.values;
        const now = clock();

        const [ligne] = await tx.select({ openTypes: applicationSettings.openTypes }).from(applicationSettings).limit(1);
        const ouverts = ligne?.openTypes ?? REGLAGES_PAR_DEFAUT.openTypes;
        if (!ouverts.includes(values.type))
          return {
            ok: false,
            status: 409,
            errors: { type: `Les ${TYPES_AU_PLURIEL[values.type]} sont complets pour le moment : choisis un autre type, ou reviens plus tard.` },
          };

        const [heure] = await tx
          .select({ n: count() })
          .from(application)
          .where(gte(application.createdAt, new Date(now.getTime() - 60 * 60 * 1000)));
        if ((heure?.n ?? 0) >= PAR_HEURE)
          return { ok: false, status: 429, errors: { form: "Beaucoup de candidatures arrivent en ce moment : réessaie dans une heure. Tes réponses restent gardées." } };

        const memes = [
          values.instagram ? sql`lower(${application.instagram}) = lower(${values.instagram})` : undefined,
          values.email ? sql`lower(${application.email}) = lower(${values.email})` : undefined,
        ].filter(Boolean);
        const [deja] = await tx
          .select({ id: application.id })
          .from(application)
          .where(and(inArray(application.status, ["new", "shortlisted"]), or(...memes)))
          .limit(1);
        if (deja) return { ok: false, status: 409, errors: { form: "Tu as déjà une candidature en cours : on l'écoute, et on te répond bientôt." } };

        const [cree] = await tx
          .insert(application)
          .values({
            type: values.type,
            ready: values.ready,
            regular: values.regular,
            name: values.name,
            city: values.city,
            instagram: values.instagram,
            email: values.email,
            pitch: values.pitch,
            listenUrl: values.listenUrl,
          })
          .returning({ id: application.id });

        if (values.styles.length) {
          const coches = await tx
            .selectDistinct({ id: tag.id })
            .from(tagGroup)
            .innerJoin(tag, eq(tag.id, tagGroup.tagId))
            .innerJoin(facet, eq(facet.id, tagGroup.facetId))
            .where(and(inArray(tag.slug, values.styles), groupesDuType(values.type)));
          if (coches.length) await tx.insert(applicationTag).values(coches.map(({ id }) => ({ applicationId: cree!.id, tagId: id })));
        }
        return { ok: true, id: cree!.id };
      }),

    /** Le ménage de la tâche de nuit : les refus de plus de six mois sont effacés. Rend leur nombre. */
    menage: async (): Promise<number> => {
      const limite = moisAvant(clock(), MOIS_GARDES);
      const effaces = await db
        .delete(application)
        .where(and(eq(application.status, "declined"), lt(application.answeredAt, limite)))
        .returning({ id: application.id });
      return effaces.length;
    },
  };
}

export type Candidatures = ReturnType<typeof createCandidatures>;
export * from "./regles.ts";
