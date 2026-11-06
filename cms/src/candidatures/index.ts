/**
 * Les candidatures (cms/README.md, 9.17), côté site. Quelqu'un qu'on ne connaît pas encore envoie son émission depuis
 * /candidater : l'émission et l'artiste (écrans 1 et 2), puis le son (écran 3). Le serveur écrit en propriétaire des
 * tables, une fois la saisie revérifiée avec les règles de la page (regles.ts) : le public n'a aucun droit sur ces
 * tables, et rien de ce qu'il envoie ne touche une fiche existante.
 *
 * L'envoi passe par un dossier : à la fin de l'écran 2, la page l'ouvre (`ouvrirDossier`, après la vérification
 * Turnstile de la route) et reçoit son jeton, dont la base ne garde que l'empreinte. Le jeton lui permet ensuite de
 * déposer son MP3 dans le seau R2 (`preparerSon`, une adresse signée par la route), d'inscrire sa photo (`ajouterPhoto`)
 * et d'envoyer la candidature (`deposer`). Un dossier jamais envoyé est oublié au bout d'un jour, avec ses fichiers.
 *
 * Contre les envois en masse, outre Turnstile : une candidature en cours par compte Instagram ou par adresse e-mail, et
 * un plafond par heure pour toutes. Rien n'est gardé de la personne d'autre que ce qu'elle envoie : pas d'adresse IP.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Tx } from "../access.ts";
import { addMedia, releaseMedia, type AdminMedia, type MediaUpload } from "../admin/media.ts";
import type { NotSaved } from "../admin/common.ts";
import type { Db } from "../db.ts";
import { audioKey, audioRefusal, audioTypeOf } from "../envois/fichiers.ts";
import { application, applicationSettings, applicationTag, audioFile, facet, tag, tagGroup, type ShowType } from "../schema.ts";
import { lireDossier, lireEnvoi, TYPES_AU_PLURIEL, type CandidatureErrors, type CandidatureForm, type DossierValues, type TypeCandidature } from "./regles.ts";

/** Au plus, tant de dossiers ouverts par heure, tous ensemble : de quoi arrêter un envoi en masse sans rien garder de personne. */
export const PAR_HEURE = 30;
/** Un refus est effacé tant de mois après la réponse. */
export const MOIS_GARDES = 6;
/** Un dossier jamais envoyé est oublié au bout d'un jour (le dépôt signé du son vaut 6 heures). */
export const DOSSIER_MS = 24 * 3600 * 1000;
/** Les réglages d'une base qui n'aurait pas encore sa ligne. */
const REGLAGES_PAR_DEFAUT: Reglages = { openTypes: ["dj_set", "podcast", "playlist"], replyDays: 21 };

export type Reglages = { openTypes: ShowType[]; replyDays: number };

/** Les styles à cocher pour un type : les groupes du premier filtre des émissions qui vaut pour lui. */
export type StylesDuType = { type: TypeCandidature; filtre: string; groupes: { slug: string; name: string }[] };

type Refus = { ok: false; errors: CandidatureErrors; status: 404 | 409 | 422 | 429 };
export type Dossier = { ok: true; jeton: string } | Refus;
export type SonPrepare = { ok: true; id: string; key: string; mime: string; removedKeys: string[] } | Refus;
export type Depot = { ok: true; id: string; removedKeys: string[] } | Refus;

/** Le jeton d'un dossier : 32 octets aléatoires, en base64url (43 caractères). La base n'en garde que l'empreinte. */
export const JETON_DOSSIER = /^[A-Za-z0-9_-]{43}$/;
const empreinte = (jeton: string) => createHash("sha256").update(jeton).digest("hex");
const PERDU: Refus = { ok: false, status: 404, errors: { form: "Ton envoi a expiré : recharge la page pour recommencer. Tes réponses sont gardées." } };

/** Les groupes des filtres des émissions qui valent pour un type (cardinality nulle : tous les types). */
const groupesDuType = (type: ShowType) =>
  and(eq(facet.scope, "show"), sql`(cardinality(${facet.showTypes}) = 0 or ${type}::public.show_type = any(${facet.showTypes}))`);

/** Il y a tant de mois, à la même heure. */
function moisAvant(date: Date, mois: number): Date {
  const avant = new Date(date);
  avant.setUTCMonth(avant.getUTCMonth() - mois);
  return avant;
}

/** Les styles cochés, s'ils sont bien des groupes des filtres de ce type ; les autres sont ignorés. */
async function poserStyles(tx: Tx, applicationId: string, type: ShowType, styles: string[]) {
  await tx.delete(applicationTag).where(eq(applicationTag.applicationId, applicationId));
  if (!styles.length) return;
  const coches = await tx
    .selectDistinct({ id: tag.id })
    .from(tagGroup)
    .innerJoin(tag, eq(tag.id, tagGroup.tagId))
    .innerJoin(facet, eq(facet.id, tagGroup.facetId))
    .where(and(inArray(tag.slug, styles), groupesDuType(type)));
  if (coches.length) await tx.insert(applicationTag).values(coches.map(({ id }) => ({ applicationId, tagId: id })));
}

const DEJA: Refus = { ok: false, status: 409, errors: { form: "Tu as déjà une candidature en cours : on l'écoute, et on te répond bientôt." } };

/** La même personne (son Instagram ou son e-mail) a-t-elle déjà une candidature envoyée, pas encore répondue ? */
async function dejaEnCours(tx: Tx, values: DossierValues): Promise<boolean> {
  const memes = [
    values.instagram ? sql`lower(${application.instagram}) = lower(${values.instagram})` : undefined,
    values.email ? sql`lower(${application.email}) = lower(${values.email})` : undefined,
  ].filter(Boolean);
  if (!memes.length) return false;
  const [deja] = await tx
    .select({ id: application.id })
    .from(application)
    .where(and(isNotNull(application.submittedAt), inArray(application.status, ["new", "shortlisted"]), or(...memes)))
    .limit(1);
  return Boolean(deja);
}

/** Les champs des écrans 1 et 2, tels qu'ils s'écrivent. */
const champsDuDossier = (values: DossierValues) => ({
  type: values.type,
  regular: values.regular,
  title: values.title,
  pitch: values.pitch,
  name: values.name,
  bio: values.bio,
  city: values.city,
  instagram: values.instagram,
  email: values.email,
});

export function createCandidatures(db: Db, { now: clock = () => new Date() }: { now?: () => Date } = {}) {
  /** Le dossier en cours de ce jeton, s'il n'a pas expiré. */
  async function dossierDe(tx: Tx, jeton: string): Promise<{ id: string; type: ShowType; name: string; photoId: string | null } | null> {
    if (!JETON_DOSSIER.test(jeton)) return null;
    const [ligne] = await tx
      .select({ id: application.id, type: application.type, name: application.name, photoId: application.photoId })
      .from(application)
      .where(and(eq(application.dossierHash, empreinte(jeton)), isNull(application.submittedAt), gte(application.createdAt, new Date(clock().getTime() - DOSSIER_MS))))
      .for("update")
      .limit(1);
    return ligne ?? null;
  }

  return {
    /** Ce jeton ouvre-t-il un dossier en cours ? Avant de signer quoi que ce soit pour lui (une photo à déposer). */
    dossierOuvert: (jeton: string): Promise<boolean> => db.transaction(async (tx) => Boolean(await dossierDe(tx, jeton))),

    /** Les réglages : les types ouverts, le délai de réponse annoncé. */
    reglages: async (): Promise<Reglages> => {
      const [ligne] = await db.select({ openTypes: applicationSettings.openTypes, replyDays: applicationSettings.replyDays }).from(applicationSettings).limit(1);
      return ligne ?? REGLAGES_PAR_DEFAUT;
    },

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
     * Ouvre le dossier de l'envoi, une fois les écrans 1 et 2 remplis : revérifiés, puis refusés si le type est fermé,
     * si la même personne (son Instagram ou son e-mail) a déjà une candidature en cours, ou si trop de dossiers ont été
     * ouverts dans l'heure. Avec le jeton d'un dossier encore ouvert, le met à jour (on est revenu en arrière).
     */
    ouvrirDossier: (form: CandidatureForm, jeton = ""): Promise<Dossier> =>
      db.transaction(async (tx): Promise<Dossier> => {
        const lu = lireDossier(form);
        if (!lu.values) return { ok: false, errors: lu.errors, status: 422 };
        const values = lu.values;
        const now = clock();

        const [ligne] = await tx.select({ openTypes: applicationSettings.openTypes }).from(applicationSettings).limit(1);
        if (!(ligne?.openTypes ?? REGLAGES_PAR_DEFAUT.openTypes).includes(values.type))
          return {
            ok: false,
            status: 409,
            errors: { type: `Les ${TYPES_AU_PLURIEL[values.type]} sont complets pour le moment : choisis un autre type, ou reviens plus tard.` },
          };

        const ouvert = jeton ? await dossierDe(tx, jeton) : null;
        if (await dejaEnCours(tx, values)) return DEJA;

        if (ouvert) {
          await tx.update(application).set(champsDuDossier(values)).where(eq(application.id, ouvert.id));
          await poserStyles(tx, ouvert.id, values.type, values.styles);
          return { ok: true, jeton };
        }

        const [heure] = await tx
          .select({ n: count() })
          .from(application)
          .where(gte(application.createdAt, new Date(now.getTime() - 60 * 60 * 1000)));
        if ((heure?.n ?? 0) >= PAR_HEURE)
          return { ok: false, status: 429, errors: { form: "Beaucoup de candidatures arrivent en ce moment : réessaie dans une heure. Tes réponses restent gardées." } };

        const nouveau = randomBytes(32).toString("base64url");
        const [cree] = await tx
          .insert(application)
          .values({ ...champsDuDossier(values), dossierHash: empreinte(nouveau), submittedAt: null })
          .returning({ id: application.id });
        await poserStyles(tx, cree!.id, values.type, values.styles);
        return { ok: true, jeton: nouveau };
      }),

    /**
     * Prépare le dépôt du MP3 d'un dossier : sa ligne (en route) et sa clé dans le seau ; la route signe l'adresse. Un
     * dossier n'a qu'un son : un nouveau remplace le précédent, dont la clé est rendue, à effacer du seau.
     */
    preparerSon: (jeton: string, ask: { fileName: string; size: number }): Promise<SonPrepare> =>
      db.transaction(async (tx): Promise<SonPrepare> => {
        const dossier = await dossierDe(tx, jeton);
        if (!dossier) return PERDU;
        const refused = audioRefusal(ask.fileName, ask.size, "main");
        if (refused) return { ok: false, status: 422, errors: { son: refused } };
        const remplaces = await tx.delete(audioFile).where(eq(audioFile.applicationId, dossier.id)).returning({ key: audioFile.key });
        const type = audioTypeOf(ask.fileName, "main")!;
        const id = randomUUID();
        const key = audioKey(id, type.ext, clock());
        const nom = ask.fileName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200) || `son.${type.ext}`;
        await tx.insert(audioFile).values({ id, applicationId: dossier.id, role: "main", key, fileName: nom, mimeType: type.mime, status: "uploading" });
        return { ok: true, id, key, mime: type.mime, removedKeys: remplaces.map((one) => one.key) };
      }),

    /** La clé d'un son en route de ce dossier, pour vérifier dans le seau qu'il est arrivé ; null sinon. */
    cleSon: (jeton: string, id: string): Promise<string | null> =>
      db.transaction(async (tx) => {
        const dossier = await dossierDe(tx, jeton);
        if (!dossier || !/^[0-9a-f-]{36}$/.test(id)) return null;
        const [son] = await tx
          .select({ key: audioFile.key })
          .from(audioFile)
          .where(and(eq(audioFile.id, id), eq(audioFile.applicationId, dossier.id), eq(audioFile.status, "uploading")))
          .limit(1);
        return son?.key ?? null;
      }),

    /**
     * Inscrit la photo du dossier (déjà recadrée et déposée par la route), à la place de la précédente ; son texte
     * alternatif est le nom de l'artiste. Rend l'image, et les clés du Storage de l'ancienne, à retirer.
     */
    ajouterPhoto: (jeton: string, file: Omit<MediaUpload, "alt" | "credit">): Promise<{ ok: true; media: AdminMedia; removedImages: string[] } | NotSaved> =>
      db.transaction(async (tx) => {
        const dossier = await dossierDe(tx, jeton);
        if (!dossier) return { ok: false, errors: { photo: PERDU.errors.form! } };
        const added = await addMedia(tx, { ...file, alt: dossier.name, credit: null });
        if (!added.ok) return added;
        await tx.update(application).set({ photoId: added.media.id }).where(eq(application.id, dossier.id));
        return { ok: true, media: added.media, removedImages: await releaseMedia(tx, [dossier.photoId]) };
      }),

    /** Retire la photo du dossier. Rend les clés du Storage à effacer. */
    retirerPhoto: (jeton: string): Promise<string[]> =>
      db.transaction(async (tx) => {
        const dossier = await dossierDe(tx, jeton);
        if (!dossier?.photoId) return [];
        await tx.update(application).set({ photoId: null }).where(eq(application.id, dossier.id));
        return releaseMedia(tx, [dossier.photoId]);
      }),

    /**
     * Envoie la candidature : les trois écrans revérifiés, le son arrivé dans le seau (`son`, sa taille réelle lue par la
     * route) ou, pour une playlist, son lien. Les autres sons du dossier (remplacés) sont oubliés : rend leurs clés.
     */
    deposer: (jeton: string, form: CandidatureForm, son: { id: string; size: number } | null): Promise<Depot> =>
      db.transaction(async (tx): Promise<Depot> => {
        const dossier = await dossierDe(tx, jeton);
        if (!dossier) return PERDU;
        const dossierLu = lireDossier(form);
        const envoiLu = lireEnvoi(form, { aSon: Boolean(son) });
        if (!dossierLu.values || !envoiLu.values) return { ok: false, status: 422, errors: { ...dossierLu.errors, ...envoiLu.errors } };
        // Deux dossiers ouverts côte à côte par la même personne : le second envoyé est refusé.
        if (await dejaEnCours(tx, dossierLu.values)) return DEJA;
        if (son) {
          const recu = await tx
            .update(audioFile)
            .set({ status: "received", sizeBytes: son.size })
            .where(and(eq(audioFile.id, son.id), eq(audioFile.applicationId, dossier.id), eq(audioFile.status, "uploading")))
            .returning({ id: audioFile.id });
          if (!recu.length) return { ok: false, status: 422, errors: { son: "Ton fichier n'est pas arrivé en entier : envoie-le de nouveau." } };
        }
        const autres = await tx
          .delete(audioFile)
          .where(and(eq(audioFile.applicationId, dossier.id), son ? sql`${audioFile.id} <> ${son.id}` : undefined))
          .returning({ key: audioFile.key });
        await tx
          .update(application)
          .set({ ...champsDuDossier(dossierLu.values), ...envoiLu.values, dossierHash: null, submittedAt: sql`now()` })
          .where(eq(application.id, dossier.id));
        await poserStyles(tx, dossier.id, dossierLu.values.type, dossierLu.values.styles);
        return { ok: true, id: dossier.id, removedKeys: autres.map((one) => one.key) };
      }),

    /**
     * Le ménage de la tâche de nuit : les dossiers jamais envoyés (plus d'un jour) sont oubliés, avec leurs sons et leur
     * photo ; les refus de plus de six mois sont effacés. Rend leur nombre, et les clés à effacer du seau et du Storage.
     */
    menage: (): Promise<{ abandoned: number; erased: number; keys: string[]; images: string[] }> =>
      db.transaction(async (tx) => {
        const now = clock();
        const perdus = and(isNull(application.submittedAt), lt(application.createdAt, new Date(now.getTime() - DOSSIER_MS)));
        const vieux = and(eq(application.status, "declined"), lt(application.answeredAt, moisAvant(now, MOIS_GARDES)));
        const visees = await tx.select({ id: application.id, photoId: application.photoId, submitted: application.submittedAt }).from(application).where(or(perdus, vieux));
        if (!visees.length) return { abandoned: 0, erased: 0, keys: [], images: [] };
        const ids = visees.map((one) => one.id);
        const sons = await tx.select({ key: audioFile.key }).from(audioFile).where(inArray(audioFile.applicationId, ids));
        await tx.delete(application).where(inArray(application.id, ids));
        const images = await releaseMedia(tx, visees.map((one) => one.photoId));
        return {
          abandoned: visees.filter((one) => !one.submitted).length,
          erased: visees.filter((one) => one.submitted).length,
          keys: sons.map((one) => one.key),
          images,
        };
      }),
  };
}

export type Candidatures = ReturnType<typeof createCandidatures>;
export * from "./regles.ts";
