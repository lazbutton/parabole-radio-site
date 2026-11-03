/**
 * La page À propos (cms/README.md, 9.10), rangée comme sur le site : DESCRIPTION et les réseaux sociaux, L'ÉQUIPE et
 * les CRÉDITS, CONTACT et CANDIDATER, puis les mentions légales, une page à part ; à côté, le film qu'on lance depuis
 * la page. Les textes et les listes s'enregistrent ensemble (Enregistrer, ⌘S), sans brouillon : la page est toujours
 * en ligne, et le site prend chaque changement en une minute environ. Le film, lui, se met en place dès son envoi,
 * comme la photo d'un artiste.
 *
 * Envoyer un film : le navigateur le lit (durée, cadre), on choisit son image fixe en le faisant défiler, puis il part
 * directement sur Vercel Blob avec cette image, sous des jetons signés par le serveur, comme les vidéos de fond.
 * L'envoi continue si l'on change d'écran : sa progression est gardée hors de l'écran, une notification annonce la fin.
 */
import type { AboutForm, FieldErrors } from "@parabole/cms";
import { formatTimecode } from "@parabole/cms/tracklist";
import { ExclamationTriangleIcon, ExternalLinkIcon, ImageIcon, InfoCircledIcon, PlayIcon, ReloadIcon, TrashIcon, VideoIcon } from "@radix-ui/react-icons";
import { AlertDialog, Button, Callout, Dialog, DropdownMenu, Flex, Progress, Slider, Text, TextField } from "@radix-ui/themes";
import { put } from "@vercel/blob/client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { PageHeader } from "./AdminShell";
import { useBlocker, useRouter } from "./router";
import { filledRow, newRow, RowsEditor, type Row, type RowColumn } from "./RowsEditor";
import { Field, filledPlaces, FormError, mergeSaved, placeErrors, postForm, Section, SheetBar, SidePanel, useSheetKeys, type Intent } from "./sheet";
import { TextEditor } from "./TextEditor";
import { useNotify } from "./toast";
import type { AboutData, AboutSheet, FilmResponse, FilmView, Flash, SaveResponse } from "./types";

const HREF = "/admin/a-propos";
const TITLE = "À propos";

const SOCIAL_FIELDS = ["label", "url"] as const;
const CREDIT_FIELDS = ["role", "name", "url"] as const;
type SocialRow = Row<(typeof SOCIAL_FIELDS)[number]>;
type CreditRow = Row<(typeof CREDIT_FIELDS)[number]>;

/** Les colonnes de L'ÉQUIPE et des CRÉDITS ; `who` complète ce qu'entendent les lecteurs d'écran. */
const creditColumns = (who: string): RowColumn<(typeof CREDIT_FIELDS)[number]>[] => [
  { field: "role", label: `Rôle ${who}`, placeholder: "Rôle (programmation…)" },
  { field: "name", label: `Nom ${who}`, placeholder: "Nom" },
  { field: "url", label: `Lien ${who}`, placeholder: "Lien, facultatif", url: true },
];
type EditorForm = Omit<AboutForm, "socials" | "team" | "credits"> & { socials: SocialRow[]; team: CreditRow[]; credits: CreditRow[] };

const toEditor = (form: AboutForm): EditorForm => ({
  ...form,
  socials: form.socials.map((link) => newRow(SOCIAL_FIELDS, link)),
  team: form.team.map((row) => newRow(CREDIT_FIELDS, row)),
  credits: form.credits.map((row) => newRow(CREDIT_FIELDS, row)),
});
/** Une ligne remplie ; les vides ne partent pas au serveur. */
const filledSocial = (row: SocialRow) => filledRow(row, SOCIAL_FIELDS);
const filledCredit = (row: CreditRow) => filledRow(row, CREDIT_FIELDS);
const strip = <R extends { key: string }>(rows: R[], filled: (row: R) => boolean) => rows.filter(filled).map(({ key: _key, ...row }) => row);
const fingerprint = (form: EditorForm) =>
  JSON.stringify({ ...form, socials: strip(form.socials, filledSocial), team: strip(form.team, filledCredit), credits: strip(form.credits, filledCredit) });

/** Les textes de la page, et les lignes remplies de ses listes, dans l'ordre. */
function formData(form: EditorForm, version: string): FormData {
  const data = new FormData();
  data.set("intent", "save");
  data.set("version", version);
  for (const field of ["description", "contactEmail", "applyText", "applyUrl", "applyLabel", "filmTitle", "legal"] as const) data.set(field, form[field]);
  for (const row of form.socials.filter(filledSocial)) {
    data.append("socialLabel", row.label);
    data.append("socialUrl", row.url);
  }
  for (const [prefix, rows] of [
    ["team", form.team],
    ["credit", form.credits],
  ] as const)
    for (const row of rows.filter(filledCredit)) {
      data.append(`${prefix}Role`, row.role);
      data.append(`${prefix}Name`, row.name);
      data.append(`${prefix}Url`, row.url);
    }
  return data;
}

const fields = (values: Record<string, string>, more: [string, string][] = []) => {
  const data = new FormData();
  for (const [name, value] of [...Object.entries(values), ...more]) data.append(name, value);
  return data;
};
const firstError = (errors: FieldErrors) => errors.film ?? errors.video ?? errors.form ?? Object.values(errors)[0] ?? "Le serveur a refusé.";
const messageOf = (error: unknown) => (error instanceof Error && error.message) || "Quelque chose s'est mal passé. Réessaie.";

// ---------------------------------------------------------------------------------------------------------------
// Le film : lire, choisir l'image fixe, envoyer
// ---------------------------------------------------------------------------------------------------------------

/** Un film plus lourd passe, mais chaque lecture le télécharge : on le signale. */
const HEAVY_BYTES = 50_000_000;
const TYPES_BY_EXTENSION: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm" };
const ACCEPT = "video/mp4,video/webm,.mp4,.m4v,.webm";

/** Le type d'une vidéo acceptée, ou null. */
function typeOf(file: File): string | null {
  if (file.type === "video/mp4" || file.type === "video/webm") return file.type;
  if (file.type && file.type !== "application/octet-stream") return null;
  return TYPES_BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

/** Ce que le navigateur a lu du film : sa durée et son cadre. */
type Facts = { duration: number | null; width: number; height: number };

/** Une image dessinée sur un canevas, en JPEG, 1920 px de large au plus : l'image fixe du film. */
function jpegOf(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const scale = Math.min(1, 1920 / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  return new Promise((resolve, reject) => {
    try {
      canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("L'image n'a pas pu être copiée."))), "image/jpeg", 0.85);
    } catch {
      // Un film d'une autre adresse, servi sans permission de copie : le canevas refuse de rendre son image.
      reject(new Error("Ce navigateur ne laisse pas copier une image du film déposé. Choisis plutôt une image de ton ordinateur."));
    }
  });
}

/** Une image de l'ordinateur, ramenée à 1920 px de large au plus. */
async function posterFromImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Cette image ne s'ouvre pas : un JPEG, un PNG ou un WebP.");
  }
  try {
    return await jpegOf(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/** Dépose un fichier sur Vercel Blob, avec un jeton que le serveur signe pour lui seul. Rend son adresse. */
async function send(kind: "video" | "poster", body: Blob, type: string, onPercent?: (percent: number) => void): Promise<string> {
  const ticket = await postForm<{ ok: true; pathname: string; token: string }>(HREF, fields({ intent: "ticket", kind, type, size: String(body.size) }));
  if (!ticket.ok) throw new Error(firstError(ticket.errors));
  try {
    const blob = await put(ticket.pathname, body, {
      access: "public",
      token: ticket.token,
      contentType: type,
      multipart: body.size > 8_000_000,
      onUploadProgress: ({ percentage }) => onPercent?.(percentage),
    });
    return blob.url;
  } catch {
    throw new Error("L'envoi vers le stockage a échoué. Vérifie la connexion, puis réessaie.");
  }
}

/** L'envoi en cours (un seul à la fois), gardé hors de l'écran : il continue quand on va ailleurs dans l'admin. */
type Upload = { name: string; step: "envoi" | "inscription"; percent: number };
let upload: Upload | null = null;
const listeners = new Set<() => void>();
const holdPage = (event: BeforeUnloadEvent) => event.preventDefault();
function setUpload(next: Upload | null) {
  // Fermer l'onglet couperait l'envoi : le navigateur demande confirmation tant qu'il dure.
  if (next && !upload) addEventListener("beforeunload", holdPage);
  if (!next && upload) removeEventListener("beforeunload", holdPage);
  upload = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const useUpload = () => useSyncExternalStore(subscribe, () => upload, () => null);

/** Le film changé, tel que le serveur le rend. */
type FilmDone = Extract<FilmResponse, { ok: true }>;
/**
 * L'écran ouvert : sa version de la page (renvoyée avec le film, pour ne pas déclencher de fausse alerte) et ce qu'il
 * fait du film à jour. Fermé, il relira le film à sa prochaine ouverture.
 */
const screen: { version: (() => string) | null; changed: ((done: FilmDone) => void) | null } = { version: null, changed: null };

/** Inscrit un changement du film auprès du serveur, et le passe à l'écran s'il est ouvert. */
async function register(values: Record<string, string>): Promise<FilmDone> {
  const result = await postForm<FilmResponse>(HREF, fields({ ...values, version: screen.version?.() ?? "" }));
  if (!result.ok) throw new Error(firstError(result.errors));
  screen.changed?.(result);
  return result;
}

/** Envoie un film et son image fixe, puis le met sur la page. Les fichiers déjà partis sont effacés en cas d'échec. */
async function uploadFilm(file: File, type: string, poster: Blob, facts: Facts, notify: (flash: Flash) => void) {
  const sent: string[] = [];
  setUpload({ name: file.name, step: "envoi", percent: 0 });
  try {
    const videoUrl = await send("video", file, type, (percent) => upload && setUpload({ ...upload, percent: Math.min(99, percent) }));
    sent.push(videoUrl);
    const posterUrl = await send("poster", poster, "image/jpeg");
    sent.push(posterUrl);
    setUpload({ name: file.name, step: "inscription", percent: 100 });
    const done = await register({
      intent: "film",
      videoUrl,
      posterUrl,
      mimeType: type,
      size: String(file.size),
      duration: facts.duration ? String(facts.duration) : "",
      width: String(facts.width),
      height: String(facts.height),
    });
    notify({ kind: "success", title: done.message, description: "Le site le montre d'ici une minute." });
  } catch (error) {
    if (sent.length) void postForm(HREF, fields({ intent: "abandon" }, sent.map((url) => ["url", url])));
    notify({ kind: "error", title: "Film non envoyé", description: messageOf(error) });
  } finally {
    setUpload(null);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// L'écran
// ---------------------------------------------------------------------------------------------------------------

export function AboutScreen({ sheet }: AboutData) {
  if (sheet) return <AboutEditor initial={sheet} />;
  return (
    <div className="admin-page">
      <PageHeader title={TITLE} />
      <Callout.Root color="amber">
        <Callout.Icon>
          <ExclamationTriangleIcon />
        </Callout.Icon>
        <Callout.Text>La page À propos n'existe pas encore dans la base : il faut y appliquer la migration 0015_a_propos_acces.</Callout.Text>
      </Callout.Root>
    </div>
  );
}

function AboutEditor({ initial }: { initial: AboutSheet }) {
  const router = useRouter();
  const notify = useNotify();
  const [sheet, setSheet] = useState(initial);
  const [form, setForm] = useState(() => toEditor(initial.form));
  const [saved, setSaved] = useState(() => fingerprint(toEditor(initial.form)));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<Intent | null>(null);
  const dirty = useMemo(() => fingerprint(form) !== saved, [form, saved]);
  const set = <K extends keyof EditorForm>(field: K, value: EditorForm[K]) => setForm((current) => ({ ...current, [field]: value }));

  // Un envoi de film qui finit pendant que l'écran est ouvert le met à jour : le film, et la version si elle a suivi.
  const latest = useRef(sheet);
  latest.current = sheet;
  useEffect(() => {
    screen.version = () => latest.current.version;
    screen.changed = (done) => {
      setSheet((current) => ({ ...current, film: done.film, version: done.version ?? current.version, updated: done.updated ?? current.updated }));
      router.invalidate();
    };
    return () => {
      screen.version = null;
      screen.changed = null;
    };
  }, [router]);

  /** Envoie la page ; vrai si elle est enregistrée. */
  async function save(): Promise<boolean> {
    if (busy) return false;
    setBusy("save");
    const sent = form;
    const result = await postForm<SaveResponse<AboutSheet>>(HREF, formData(form, sheet.version));
    setBusy(null);
    if (result.ok && "sheet" in result) {
      const fresh = toEditor(result.sheet.form);
      // Les lignes gardent leur clé : le champ où l'on tapait reste en place.
      const keep = <R extends { key: string }>(rows: R[], before: R[]) => rows.map((row, index) => ({ ...row, key: before[index]?.key ?? row.key }));
      fresh.socials = keep(fresh.socials, sent.socials.filter(filledSocial));
      fresh.team = keep(fresh.team, sent.team.filter(filledCredit));
      fresh.credits = keep(fresh.credits, sent.credits.filter(filledCredit));
      setSheet(result.sheet);
      setForm((current) => mergeSaved(current, sent, fresh));
      setSaved(fingerprint(fresh));
      setErrors({});
      router.replace(HREF, { name: "about", title: TITLE, data: { sheet: result.sheet } });
      notify({ kind: "success", title: "Page enregistrée", description: "Le site la montre d'ici une minute." });
      return true;
    }
    if (result.ok) return false;
    // La saisie reste telle quelle ; les erreurs des listes reviennent sur leurs lignes.
    let placed = placeErrors(result.errors, "socials", filledPlaces(sent.socials, filledSocial));
    placed = placeErrors(placed, "team", filledPlaces(sent.team, filledCredit));
    placed = placeErrors(placed, "credits", filledPlaces(sent.credits, filledCredit));
    setErrors(placed);
    if ("version" in result && result.version) setSheet((current) => ({ ...current, version: result.version! }));
    notify({ kind: "error", title: "La page n'est pas enregistrée", description: result.errors.form ?? "Corrige les champs signalés." });
    return false;
  }

  useBlocker(dirty, save);
  useSheetKeys(dirty, () => void save());

  return (
    <form
      noValidate
      className="admin-sheet"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <SheetBar
        name={TITLE}
        status="published"
        isNew={false}
        dirty={dirty}
        busy={busy}
        updated={sheet.updated}
        onSave={() => void save()}
        live
        view={{ label: "Voir la page", href: "/a-propos" }}
      />
      <div className="admin-sheet-body">
        <FormError message={errors.form} />
        <div className="admin-sheet-grid">
          <div className="admin-sheet-main">
            <PageHeader title={TITLE} description="La page du site, rangée comme elle s'affiche : chaque bloc vide disparaît de la page." />
            <Section title="Description">
              <TextEditor
                id="description"
                label="Description"
                value={form.description}
                onChange={(value) => set("description", value)}
                error={errors.description}
                placeholder="Qui est Parabole, ce qu'on y entend, d'où ça vient…"
              />
            </Section>
            <RowsEditor
              title="Réseaux sociaux"
              name="socials"
              hint="Sous la description, en logos. Sans libellé, le nom du site est repris (Instagram, SoundCloud…)."
              addLabel="Ajouter un réseau"
              rows={form.socials}
              columns={[
                { field: "label", label: "Libellé du réseau", placeholder: "Libellé" },
                { field: "url", label: "Adresse du réseau", placeholder: "https://…", url: true },
              ]}
              errors={errors}
              onChange={(rows) => set("socials", rows)}
            />
            <RowsEditor
              title="L'équipe"
              name="team"
              hint="Dans l'ordre d'affichage. Le lien peut mener à une page de résident (/residents/…) ou à un site."
              addLabel="Ajouter quelqu'un"
              rows={form.team}
              columns={creditColumns("de la personne")}
              errors={errors}
              onChange={(rows) => set("team", rows)}
            />
            <RowsEditor
              title="Crédits"
              name="credits"
              hint="Qui a fait quoi pour la radio et le site, et ce qu'on a emprunté (avec sa licence)."
              addLabel="Ajouter un crédit"
              rows={form.credits}
              columns={creditColumns("du crédit")}
              errors={errors}
              onChange={(rows) => set("credits", rows)}
            />
            <Section title="Contact">
              <Field label="Adresse e-mail" htmlFor="contactEmail" optional hint="Vide, le bloc CONTACT disparaît de la page." error={errors.contactEmail}>
                <TextField.Root
                  id="contactEmail"
                  type="email"
                  inputMode="email"
                  value={form.contactEmail}
                  onChange={(e) => set("contactEmail", e.target.value)}
                  placeholder="contact@…"
                  color={errors.contactEmail ? "red" : undefined}
                  autoComplete="off"
                  autoCapitalize="off"
                />
              </Field>
            </Section>
            <Section title="Candidater">
              <Flex direction="column" gap="4">
                <Field label="Le texte" htmlFor="applyText" optional error={errors.applyText}>
                  <TextEditor id="applyText" label="Le texte de Candidater" value={form.applyText} onChange={(value) => set("applyText", value)} placeholder="Qui la radio cherche…" />
                </Field>
                <Field label="Le bouton" htmlFor="applyLabel" error={errors.applyLabel}>
                  <TextField.Root
                    id="applyLabel"
                    value={form.applyLabel}
                    onChange={(e) => set("applyLabel", e.target.value)}
                    color={errors.applyLabel ? "red" : undefined}
                    autoComplete="off"
                  />
                </Field>
                <Field
                  label="Où mène le bouton"
                  htmlFor="applyUrl"
                  optional
                  hint="Le formulaire des candidatures, ou une adresse e-mail. Vide, le bouton disparaît."
                  error={errors.applyUrl}
                >
                  <TextField.Root
                    id="applyUrl"
                    inputMode="url"
                    value={form.applyUrl}
                    onChange={(e) => set("applyUrl", e.target.value)}
                    placeholder="https://…"
                    color={errors.applyUrl ? "red" : undefined}
                    autoComplete="off"
                    autoCapitalize="off"
                  />
                </Field>
              </Flex>
            </Section>
            <Section title="Mentions légales">
              <Text as="p" size="2" color="gray" mb="3">
                Une page à part (/mentions-legales), avec un lien discret en bas de À propos. Obligatoires en France : qui édite le site, le directeur ou la
                directrice de la publication, l'hébergeur.
              </Text>
              <TextEditor id="legal" label="Mentions légales" value={form.legal} onChange={(value) => set("legal", value)} error={errors.legal} />
            </Section>
          </div>

          <aside className="admin-sheet-side" aria-label="Film et liens vers le site">
            <SidePanel title="Film">
              <FilmPanel film={sheet.film} canUpload={sheet.uploads} maxBytes={sheet.maxBytes} />
              <Field label="Titre du film" htmlFor="filmTitle" optional hint="Dit aux lecteurs d'écran par le grand ▶ de la page (vide : « le film »). S'enregistre avec la page." error={errors.filmTitle}>
                <TextField.Root id="filmTitle" value={form.filmTitle} onChange={(e) => set("filmTitle", e.target.value)} placeholder="Parabole, le film" autoComplete="off" />
              </Field>
            </SidePanel>
            <SidePanel title="Sur le site">
              <Flex direction="column" gap="2">
                <Text size="2">
                  <a href="/a-propos" target="_blank" rel="noopener">
                    À propos <ExternalLinkIcon aria-hidden />
                  </a>
                </Text>
                <Text size="2">
                  <a href="/mentions-legales" target="_blank" rel="noopener">
                    Mentions légales <ExternalLinkIcon aria-hidden />
                  </a>
                </Text>
                <Text size="1" color="gray">
                  Modifiée le {sheet.updated}
                </Text>
              </Flex>
            </SidePanel>
          </aside>
        </div>
      </div>
    </form>
  );
}

/**
 * Le film de la page : son image fixe (▶ pour le voir), ce qu'il pèse, et ses actions (changer l'image fixe, remplacer
 * la vidéo, l'enlever). Sans film, la page garde la vidéo de fond habituelle.
 */
function FilmPanel({ film, canUpload, maxBytes }: { film: FilmView | null; canUpload: boolean; maxBytes: number }) {
  const notify = useNotify();
  const running = useUpload();
  const videoPicker = useRef<HTMLInputElement>(null);
  const imagePicker = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [watching, setWatching] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  /** Un changement qui ne passe pas par l'envoi d'un film : l'image fixe, le retrait. */
  async function change(label: string, run: () => Promise<FilmDone>) {
    setWorking(label);
    try {
      const done = await run();
      notify({ kind: "success", title: done.message, description: "Le site le montre d'ici une minute." });
    } catch (error) {
      notify({ kind: "error", title: "Rien n'a changé", description: messageOf(error) });
    } finally {
      setWorking(null);
    }
  }

  /** Une nouvelle image fixe (tirée du film, ou d'une image de l'ordinateur) : l'envoyer, puis la mettre sur la page. */
  const placePoster = (make: () => Promise<Blob>) =>
    change("Envoi de l'image…", async () => {
      const posterUrl = await send("poster", await make(), "image/jpeg");
      try {
        return await register({ intent: "poster", posterUrl });
      } catch (error) {
        void postForm(HREF, fields({ intent: "abandon" }, [["url", posterUrl]]));
        throw error;
      }
    });

  const chooseVideo = (file: File) => {
    const type = typeOf(file);
    if (!type) return notify({ kind: "error", title: "Vidéo refusée", description: "Une vidéo MP4 (H.264) ou WebM seulement. Une vidéo .mov s'exporte en MP4 depuis la plupart des logiciels." });
    if (file.size > maxBytes)
      return notify({ kind: "error", title: "Film trop lourd", description: `${Math.round(file.size / 1_000_000)} Mo : ${maxBytes / 1_000_000} Mo au plus. Exporte-le en 720p pour l'alléger.` });
    if (file.size > HEAVY_BYTES) notify({ kind: "info", title: "Film lourd", description: "Il passera, mais chaque lecture le télécharge en entier : vise moins de 50 Mo (720p suffit)." });
    setSource({ file, type });
  };

  const busy = running !== null || working !== null;
  return (
    <Flex direction="column" gap="3">
      <input
        ref={videoPicker}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) chooseVideo(file);
        }}
      />
      <input
        ref={imagePicker}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void placePoster(() => posterFromImage(file));
        }}
      />

      {running ? (
        <Flex direction="column" gap="2" className="admin-film-empty">
          <Text size="2" weight="medium" truncate>
            {running.name}
          </Text>
          <Text size="1" color="gray">
            {running.step === "envoi" ? `Envoi · ${Math.round(running.percent)} %` : "Mise en place sur la page…"}
          </Text>
          <Progress size="1" value={running.percent} aria-label={`Envoi de ${running.name}`} />
        </Flex>
      ) : film ? (
        <div className="admin-film">
          {film.poster ? <img src={film.poster} alt="" /> : null}
          <button type="button" className="admin-film-play" onClick={() => setWatching(true)} aria-label="Voir le film">
            <span>
              <PlayIcon width="20" height="20" />
            </span>
          </button>
        </div>
      ) : (
        <div className="admin-film-empty">
          <VideoIcon width="22" height="22" aria-hidden />
          <Text size="2">Pas de film : la page garde la vidéo de fond habituelle.</Text>
        </div>
      )}

      {film && !running && (
        <Text size="1" color="gray">
          {film.facts}
        </Text>
      )}
      {working && (
        <Text size="1" color="gray" role="status">
          {working}
        </Text>
      )}

      {!canUpload ? (
        <Callout.Root color="amber" size="1">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>L'envoi de vidéos n'est pas branché : il faut relier un magasin Vercel Blob au projet (BLOB_READ_WRITE_TOKEN).</Callout.Text>
        </Callout.Root>
      ) : film ? (
        <Flex gap="2" wrap="wrap">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button type="button" variant="soft" disabled={busy}>
                <ImageIcon /> Image fixe
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content size="2">
              <DropdownMenu.Item onSelect={() => setSource({ url: film.url })}>Un autre moment du film</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => imagePicker.current?.click()}>Une image de mon ordinateur…</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button type="button" variant="soft" color="gray" disabled={busy}>
                Film
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content size="2">
              <DropdownMenu.Item onSelect={() => videoPicker.current?.click()}>
                <ReloadIcon /> Remplacer la vidéo…
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item color="red" onSelect={() => setRemoving(true)}>
                <TrashIcon /> Retirer le film…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Flex>
      ) : (
        <Button type="button" onClick={() => videoPicker.current?.click()} disabled={busy}>
          <VideoIcon /> Ajouter un film
        </Button>
      )}
      <Callout.Root color="gray" variant="surface" size="1">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Callout.Text>
          MP4 (H.264) ou WebM, {maxBytes / 1_000_000} Mo au plus. Il ne se charge qu'au clic sur ▶, mais chaque lecture le télécharge sur le stockage, compté au
          mois : 720p et moins de 50 Mo, c'est l'idéal.
        </Callout.Text>
      </Callout.Root>

      <FramePicker
        source={source}
        onClose={() => setSource(null)}
        onImage={() => {
          setSource(null);
          imagePicker.current?.click();
        }}
        onPicked={(poster, facts) => {
          const picked = source;
          setSource(null);
          if (picked && "file" in picked) void uploadFilm(picked.file, picked.type, poster, facts, notify);
          else void placePoster(async () => poster);
        }}
      />
      {film && (
        <Dialog.Root open={watching} onOpenChange={setWatching}>
          <Dialog.Content maxWidth="860px" aria-describedby={undefined}>
            <Dialog.Title size="4">Le film de la page</Dialog.Title>
            <video className="admin-clip-preview" src={film.url} poster={film.poster ?? undefined} controls autoPlay playsInline />
            <Flex justify="end" mt="4">
              <Dialog.Close>
                <Button variant="soft" color="gray">
                  Fermer
                </Button>
              </Dialog.Close>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
      )}
      <AlertDialog.Root open={removing} onOpenChange={setRemoving}>
        <AlertDialog.Content maxWidth="460px">
          <AlertDialog.Title>Retirer le film de la page ?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            La page reprend la vidéo de fond habituelle, et le film est effacé du stockage : pour le remettre, il faudra le renvoyer.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Annuler
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" onClick={() => void change("Retrait du film…", () => register({ intent: "remove-film" }))}>
                <TrashIcon /> Retirer
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  );
}

/** Ce que l'on fait défiler pour choisir l'image fixe : le film qu'on va envoyer, ou celui déjà sur la page. */
type Source = { file: File; type: string } | { url: string };

/**
 * Choisir l'image fixe : le film, arrêté, qu'on fait défiler avec la glissière jusqu'au bon moment. Il part à un
 * dixième de sa durée (10 s au plus) : la toute première image est souvent noire.
 */
function FramePicker({ source, onClose, onPicked, onImage }: { source: Source | null; onClose(): void; onPicked(poster: Blob, facts: Facts): void; onImage(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);
  const local = source !== null && "file" in source;

  useEffect(() => {
    setProblem(null);
    setDuration(0);
    setTime(0);
    setTaking(false);
    if (!source) return setSrc(null);
    if ("url" in source) return setSrc(source.url);
    const url = URL.createObjectURL(source.file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);

  async function take() {
    const element = video.current;
    if (!element || !element.videoWidth) return;
    setTaking(true);
    try {
      const poster = await jpegOf(element, element.videoWidth, element.videoHeight);
      onPicked(poster, { duration: Number.isFinite(element.duration) && element.duration > 0 ? element.duration : null, width: element.videoWidth, height: element.videoHeight });
    } catch (error) {
      setProblem(messageOf(error));
      setTaking(false);
    }
  }

  return (
    <Dialog.Root
      open={source !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content maxWidth="760px">
        <Dialog.Title size="4">{local ? "L'image fixe du film" : "Un autre moment du film"}</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          C'est l'image qui reste sur la page tant qu'on n'a pas lancé le film, derrière les panneaux. Fais défiler jusqu'au bon moment.
        </Dialog.Description>
        {src && (
          <video
            key={src}
            ref={video}
            className="admin-film-picker"
            src={src}
            crossOrigin={local ? undefined : "anonymous"}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => {
              const element = event.currentTarget;
              if (!element.videoWidth || !element.videoHeight) return setProblem("Ce fichier n'a pas d'image : il faut une vidéo.");
              const length = Number.isFinite(element.duration) ? element.duration : 0;
              const start = Math.min(length / 10, 10);
              setDuration(length);
              setTime(start);
              element.currentTime = start;
            }}
            onError={() =>
              setProblem(
                local
                  ? "Ce navigateur ne sait pas lire cette vidéo, les visiteurs non plus sans doute : exporte-la en MP4 (H.264)."
                  : "Le film déposé ne se laisse pas lire ici pour en tirer une image. Choisis plutôt une image de ton ordinateur.",
              )
            }
          />
        )}
        <Flex align="center" gap="3" mt="3">
          <Slider
            value={[time]}
            min={0}
            max={duration || 1}
            step={0.1}
            disabled={!duration || problem !== null}
            onValueChange={([value]) => {
              setTime(value ?? 0);
              if (video.current) video.current.currentTime = value ?? 0;
            }}
            aria-label="Moment du film"
          />
          <Text size="2" color="gray" className="admin-nowrap admin-tabular">
            {formatTimecode(Math.floor(time))} / {formatTimecode(Math.floor(duration))}
          </Text>
        </Flex>
        {problem && (
          <Callout.Root color="red" size="1" mt="3">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>{problem}</Callout.Text>
          </Callout.Root>
        )}
        <Flex gap="3" mt="4" justify="end" wrap="wrap">
          {!local && (
            <Button type="button" variant="soft" color="gray" onClick={onImage}>
              <ImageIcon /> Une image de mon ordinateur…
            </Button>
          )}
          <Dialog.Close>
            <Button type="button" variant="soft" color="gray">
              Annuler
            </Button>
          </Dialog.Close>
          <Button type="button" loading={taking} disabled={!duration || problem !== null} onClick={() => void take()}>
            {local ? "Envoyer le film" : "Prendre cette image"}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
