/**
 * La fiche d'un show (cms/README.md, 9.2) : à gauche le contenu (titre, adresse, description, tracklist), à droite
 * les réglages (publication, diffusion, artistes et étiquettes, son, pochette). Enregistrer, Publier et Dépublier
 * envoient la fiche sans quitter l'écran : le serveur vérifie, écrit sous le rôle de la personne connectée, et renvoie
 * la fiche à jour ; une erreur s'affiche à côté du champ fautif. Une fiche modifiée retient la navigation.
 */
import { LABELS } from "@parabole/cms/labels";
import type { FieldErrors, ShowForm } from "@parabole/cms";
import { Flex, Grid, SegmentedControl, Text, TextField } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { PageHeader, StatusBadge } from "./AdminShell";
import { MarkdownEditor } from "./MarkdownEditor";
import { useBlocker, useRouter } from "./router";
import { Field, filledPlaces, FormError, MediaSlot, mergeSaved, placeErrors, postForm, PublishCard, SaveBar, Section, useSheetKeys, type Intent, type SaveIntent } from "./sheet";
import { useNotify } from "./toast";
import { TokenPicker } from "./TokenPicker";
import { trackRow, TracklistEditor, type TrackRow } from "./TracklistEditor";
import type { SaveResponse, ShowEditorData, ShowSheet } from "./types";

type EditorForm = Omit<ShowForm, "tracks"> & { tracks: TrackRow[] };

const toEditor = (form: ShowForm): EditorForm => ({ ...form, tracks: form.tracks.map((line) => trackRow(line)) });
/** Une ligne de tracklist remplie ; les vides ne partent pas au serveur. */
const filled = (line: TrackRow) => Boolean(line.artist.trim() || line.title.trim() || line.start.trim() || line.hopperUrl.trim());
/** Ce qui compte pour savoir si la fiche a changé : tout sauf les clés React et les lignes vides. */
const fingerprint = (form: EditorForm) => JSON.stringify({ ...form, pasted: "", tracks: form.tracks.filter(filled).map(({ key: _key, ...line }) => line) });

function formData(form: EditorForm, intent: Intent, version: string): FormData {
  const data = new FormData();
  data.set("intent", intent);
  data.set("version", version);
  for (const field of ["title", "slug", "type", "broadcastAt", "duration", "description", "soundcloudUrl", "soundcloudTrackId"] as const) data.set(field, form[field]);
  for (const value of form.artists) data.append("artist", value);
  for (const value of form.tags) data.append("tag", value);
  for (const line of form.tracks.filter(filled)) {
    data.append("trackStart", line.start);
    data.append("trackArtist", line.artist);
    data.append("trackTitle", line.title);
    data.append("trackHopper", line.hopperUrl);
  }
  return data;
}

const DONE: Record<SaveIntent, string> = { save: "Show enregistré", publish: "Show publié", unpublish: "Show dépublié : repassé en brouillon" };

export function ShowEditor({ sheet: initialSheet }: ShowEditorData) {
  const router = useRouter();
  const notify = useNotify();
  const [sheet, setSheet] = useState(initialSheet);
  const [form, setForm] = useState(() => toEditor(initialSheet.form));
  const [saved, setSaved] = useState(() => fingerprint(toEditor(initialSheet.form)));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<Intent | null>(null);
  const dirty = useMemo(() => fingerprint(form) !== saved, [form, saved]);
  const set = <K extends keyof EditorForm>(field: K, value: EditorForm[K]) => setForm((current) => ({ ...current, [field]: value }));
  const url = sheet.id ? `/admin/shows/${sheet.id}` : "/admin/shows/nouveau";

  /** Envoie la fiche ; vrai si elle est enregistrée. */
  async function save(intent: SaveIntent): Promise<boolean> {
    if (busy) return false;
    const publishing = intent === "publish" || (intent === "save" && sheet.status === "published");
    if (publishing && !form.broadcastAt) {
      setErrors({ broadcastAt: "Il faut une date de diffusion pour publier." });
      document.getElementById("broadcastAt")?.focus();
      notify({ kind: "error", title: "Pas encore publiable", description: "Ajoute la date et l'heure de diffusion." });
      return false;
    }
    setBusy(intent);
    const sent = form;
    const result = await postForm<SaveResponse<ShowSheet>>(url, formData(form, intent, sheet.version));
    setBusy(null);
    if (result.ok && "sheet" in result) {
      setSheet(result.sheet);
      const fresh = toEditor(result.sheet.form);
      // Les lignes gardent leur clé : le champ où l'on tapait reste en place.
      const keys = sent.tracks.filter(filled).map((line) => line.key);
      fresh.tracks = fresh.tracks.map((line, index) => ({ ...line, key: keys[index] ?? line.key }));
      setForm((current) => mergeSaved(current, sent, fresh));
      setSaved(fingerprint(fresh));
      setErrors({});
      // Les listes ont changé ; une fiche créée prend son adresse.
      router.invalidate();
      router.replace(`/admin/shows/${result.sheet.id}`, { name: "show", title: result.sheet.form.title, data: { sheet: result.sheet } });
      const born = result.newArtists ?? 0;
      notify({
        kind: "success",
        title: result.created && intent === "save" ? "Show créé, en brouillon" : DONE[intent],
        description: born ? `${born > 1 ? `${born} artistes créés` : "Un artiste créé"} en brouillon : complète leur fiche dans Artistes.` : undefined,
      });
      return true;
    }
    if (result.ok) return false;
    // La saisie reste telle quelle ; les erreurs de la tracklist reviennent sur leurs lignes.
    setErrors(placeErrors(result.errors, "tracks", filledPlaces(sent.tracks, filled)));
    if ("version" in result && result.version) setSheet((current) => ({ ...current, version: result.version! }));
    notify({ kind: "error", title: "La fiche n'est pas enregistrée", description: result.errors.form ?? "Corrige les champs signalés." });
    return false;
  }

  async function remove() {
    setBusy("delete");
    const result = await postForm<SaveResponse<ShowSheet>>(url, formData(form, "delete", sheet.version));
    if (result.ok && "redirect" in result) {
      router.invalidate();
      router.setBlocker(null);
      notify({ kind: "success", title: result.message ?? "Show supprimé" });
      return router.navigate(result.redirect, { replace: true });
    }
    setBusy(null);
    notify({ kind: "error", title: "Suppression impossible", description: result.ok ? undefined : result.errors.form });
  }

  useBlocker(dirty, () => save("save"));
  useSheetKeys(dirty, () => void save("save"));
  const title = form.title.trim() || (sheet.id ? "Sans titre" : "Nouveau show");
  /** Le type d'une étiquette choisie : « nouveau:genre:… », ou celui de l'étiquette connue. */
  const kindOf = (value: string) => (value.startsWith("nouveau:") ? value.split(":")[1] : sheet.tags.find((tag) => tag.id === value)?.kind);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save("save");
      }}
    >
      <PageHeader title={title} crumbs={[{ label: "Shows", href: "/admin/shows" }]} badge={sheet.id ? <StatusBadge status={sheet.status} /> : undefined} />
      <FormError message={errors.form} />
      <Grid columns={{ initial: "1", md: "minmax(0, 1fr) 340px" }} gap="5" align="start">
        <Flex direction="column" gap="5" minWidth="0">
          <Section title="Informations">
            <Field label="Titre" htmlFor="title" error={errors.title}>
              <TextField.Root id="title" size="3" value={form.title} onChange={(e) => set("title", e.target.value)} color={errors.title ? "red" : undefined} autoComplete="off" />
            </Field>
            <Field label="Adresse" htmlFor="slug" optional hint="Le bout d'adresse du show sur le site : minuscules, chiffres et tirets. Vide, il est tiré du titre." error={errors.slug}>
              <TextField.Root id="slug" value={form.slug} onChange={(e) => set("slug", e.target.value)} color={errors.slug ? "red" : undefined} autoComplete="off" autoCapitalize="off" />
            </Field>
            <MarkdownEditor label="Description" value={form.description} onChange={(value) => set("description", value)} error={errors.description} />
          </Section>
          <TracklistEditor rows={form.tracks} onChange={(tracks) => set("tracks", tracks)} errors={errors} />
        </Flex>

        <Flex direction="column" gap="5" minWidth="0">
          <PublishCard
            status={sheet.status}
            created={sheet.created}
            updated={sheet.updated}
            deleteTitle={sheet.id ? `Supprimer « ${sheet.form.title} » ?` : undefined}
            deleteNote="Le show, sa tracklist et ses liens aux artistes et aux étiquettes seront supprimés."
            onDelete={remove}
            deleting={busy === "delete"}
          />
          <Section title="Diffusion">
            <Field label="Type" error={errors.type}>
              <SegmentedControl.Root value={form.type} onValueChange={(value) => set("type", value)} aria-label="Type">
                {Object.entries(LABELS.showType).map(([value, label]) => (
                  <SegmentedControl.Item key={value} value={value}>
                    {label}
                  </SegmentedControl.Item>
                ))}
              </SegmentedControl.Root>
            </Field>
            <Field label="Date et heure" htmlFor="broadcastAt" hint="Heure de Paris. Obligatoire pour publier." error={errors.broadcastAt}>
              <TextField.Root id="broadcastAt" type="datetime-local" value={form.broadcastAt} onChange={(e) => set("broadcastAt", e.target.value)} color={errors.broadcastAt ? "red" : undefined} />
            </Field>
            <Field label="Durée" htmlFor="duration" optional hint="h:mm:ss, par exemple 1:30:00." error={errors.duration}>
              <TextField.Root id="duration" value={form.duration} onChange={(e) => set("duration", e.target.value)} placeholder="2:00:00" color={errors.duration ? "red" : undefined} autoComplete="off" />
            </Field>
          </Section>
          <Section title="Artistes et étiquettes">
            <TokenPicker
              label="Artistes"
              values={form.artists}
              options={sheet.artists}
              onChange={(values) => set("artists", values)}
              placeholder="Ajouter un artiste…"
              hint="Dans l'ordre d'affichage (« A b2b B »). Un nom inconnu crée un artiste, en brouillon."
              error={errors.artists}
              ordered
            />
            {(["genre", "mood", "theme"] as const).map((kind) => (
              <TokenPicker
                key={kind}
                label={LABELS.tagKind[kind]}
                kind={kind}
                values={form.tags.filter((value) => kindOf(value) === kind)}
                options={sheet.tags.filter((tag) => tag.kind === kind)}
                onChange={(values) => set("tags", [...form.tags.filter((value) => kindOf(value) !== kind), ...values])}
                placeholder={`Ajouter un ${LABELS.tagKind[kind].toLowerCase()}…`}
                newLabel="nouvelle"
              />
            ))}
            {errors.tags && (
              <Text size="1" color="red">
                {errors.tags}
              </Text>
            )}
          </Section>
          <Section title="Son">
            <Field label="Piste SoundCloud" htmlFor="soundcloudUrl" optional error={errors.soundcloudUrl}>
              <TextField.Root
                id="soundcloudUrl"
                value={form.soundcloudUrl}
                onChange={(e) => set("soundcloudUrl", e.target.value)}
                placeholder="https://soundcloud.com/…"
                inputMode="url"
                color={errors.soundcloudUrl ? "red" : undefined}
                autoComplete="off"
              />
            </Field>
            <Field
              label="Identifiant de la piste"
              htmlFor="soundcloudTrackId"
              optional
              hint="Dans SoundCloud : Partager › Intégrer, le nombre après « tracks/ ». C'est la piste que jouera le lecteur."
              error={errors.soundcloudTrackId}
            >
              <TextField.Root
                id="soundcloudTrackId"
                value={form.soundcloudTrackId}
                onChange={(e) => set("soundcloudTrackId", e.target.value)}
                placeholder="1234567890"
                inputMode="numeric"
                color={errors.soundcloudTrackId ? "red" : undefined}
                autoComplete="off"
              />
            </Field>
          </Section>
          <Section title="Pochette">
            <MediaSlot media={sheet.cover} />
          </Section>
          {sheet.radiocultEventId && (
            <Section title="Radio Cult">
              <Text size="2" className="admin-break">
                Créneau {sheet.radiocultEventId}
              </Text>
              <Text size="1" color="gray">
                Ce show vient de la programmation Radio Cult (import quotidien).
              </Text>
            </Section>
          )}
        </Flex>
      </Grid>
      <SaveBar status={sheet.status} dirty={dirty} busy={busy} isNew={!sheet.id} onSave={(intent) => void save(intent)} />
    </form>
  );
}
