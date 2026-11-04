/**
 * La fiche d'un show (cms/README.md, 9.2). En haut, la barre de la fiche (sheet.tsx) : toutes les actions au même
 * endroit. Dessous, le titre en grand, puis les propriétés en lignes — type, diffusion, durée, artistes, étiquettes,
 * mood —, la description et la tracklist ; à côté, la pochette, le son et les informations. Enregistrer, Publier et
 * Dépublier envoient la fiche sans quitter l'écran : le serveur vérifie, écrit sous le rôle de la personne connectée,
 * et renvoie la fiche à jour ; une erreur s'affiche à côté du champ fautif. Une fiche modifiée retient la navigation.
 * La pochette, elle, se met en place dès son envoi (ImageField).
 *
 * Les étiquettes se choisissent à la souris, filtre par filtre : ceux du type du show (Genre et Géographie pour un DJ
 * set ou une playlist, Thème pour un podcast), en pastilles (FacetPicker). Une étiquette hors des filtres se tape dans
 * « Autres » : elle sera à classer.
 */
import { ENERGY, LABELS } from "@parabole/cms/labels";
import type { FieldErrors, ShowForm } from "@parabole/cms";
import { BookmarkIcon, CalendarIcon, Cross2Icon, ExclamationTriangleIcon, ExternalLinkIcon, LayersIcon, MixerHorizontalIcon, PersonIcon, PlusIcon, TimerIcon } from "@radix-ui/react-icons";
import { Button, DataList, Flex, IconButton, SegmentedControl, Text, TextField } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { forgetRecent, rememberRecent } from "./recents";
import { useBlocker, useRouter } from "./router";
import { ReceivedParts, ReceivedSound, SubmissionPanel } from "./EnvoiPanels";
import { FacetPicker } from "./FacetPicker";
import { ImageField, placeImage } from "./ImageField";
import { Field, filledPlaces, FormError, mergeSaved, placeErrors, postForm, Property, Section, SheetBar, SidePanel, TitleInput, useSheetKeys, type Intent, type SaveIntent } from "./sheet";
import { TextEditor } from "./TextEditor";
import { useNotify } from "./toast";
import { TokenPicker } from "./TokenPicker";
import { useTagChoices } from "./tagChoices";
import { trackRow, TracklistEditor, type TrackRow } from "./TracklistEditor";
import type { MediaView, SaveResponse, ShowEditorData, ShowSheet } from "./types";

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
  for (const field of ["title", "slug", "type", "broadcastAt", "duration", "energy", "description", "soundcloudUrl", "soundcloudTrackId"] as const) data.set(field, form[field]);
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
const PLURALS = { dj_set: "DJ sets", playlist: "playlists", podcast: "podcasts" };
const ENERGY_STEPS = Array.from({ length: ENERGY.max - ENERGY.min + 1 }, (_, index) => String(ENERGY.min + index));

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

  // La fiche rejoint les « ouverts récemment » de la recherche (⌘K), sous son titre enregistré.
  useEffect(() => {
    if (sheet.id) rememberRecent({ href: `/admin/shows/${sheet.id}`, title: sheet.form.title || "Sans titre", kind: "show" });
  }, [sheet.id, sheet.form.title]);

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

  /** Met une image à la place de la pochette, ou la retire : tout de suite, sans enregistrer le reste de la fiche. */
  async function placeCover(image: MediaView | null): Promise<string | null> {
    const result = await placeImage(url, "cover", image, sheet.version);
    if (!result.ok) return result.errors.form ?? result.errors.image ?? "Le serveur a refusé.";
    setSheet((current) => ({ ...current, cover: result.image, version: result.version ?? current.version, updated: result.updated ?? current.updated }));
    router.invalidate();
    return null;
  }

  async function remove() {
    setBusy("delete");
    const result = await postForm<SaveResponse<ShowSheet>>(url, formData(form, "delete", sheet.version));
    if (result.ok && "redirect" in result) {
      forgetRecent(url);
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
  const name = form.title.trim() || (sheet.id ? "Sans titre" : "Nouveau show");
  const tags = useTagChoices(sheet, form.tags, form.type);
  const [moreTags, setMoreTags] = useState(false);
  const toggleTag = (id: string) => set("tags", form.tags.includes(id) ? form.tags.filter((value) => value !== id) : [...form.tags, id]);
  const typePlural = PLURALS[form.type as keyof typeof PLURALS];
  const soundcloud = /^https?:\/\//.test(form.soundcloudUrl.trim()) ? form.soundcloudUrl.trim() : null;

  return (
    <form
      noValidate
      className="admin-sheet"
      onSubmit={(event) => {
        event.preventDefault();
        void save("save");
      }}
    >
      <SheetBar
        back={{ label: "Shows", href: "/admin/shows" }}
        name={name}
        status={sheet.status}
        isNew={!sheet.id}
        dirty={dirty}
        busy={busy}
        updated={sheet.updated}
        onSave={(intent) => void save(intent)}
        deleteTitle={sheet.id ? `Supprimer « ${sheet.form.title} » ?` : undefined}
        deleteNote="Le show, sa tracklist et ses liens aux artistes et aux étiquettes seront supprimés."
        onDelete={remove}
      />
      <div className="admin-sheet-body">
        <FormError message={errors.form} />
        <div className="admin-sheet-grid">
          <div className="admin-sheet-main">
            <TitleInput id="title" label="Titre du show" value={form.title} onChange={(value) => set("title", value)} placeholder="Titre du show" error={errors.title} />
            <div className="admin-props">
              <Property label="Type" icon={<LayersIcon />} error={errors.type}>
                <SegmentedControl.Root value={form.type} onValueChange={(value) => set("type", value)} aria-label="Type" size="2">
                  {Object.entries(LABELS.showType).map(([value, label]) => (
                    <SegmentedControl.Item key={value} value={value}>
                      {label}
                    </SegmentedControl.Item>
                  ))}
                </SegmentedControl.Root>
              </Property>
              <Property label="Diffusion" icon={<CalendarIcon />} htmlFor="broadcastAt" hint="Heure de Paris. Il en faut une pour publier." error={errors.broadcastAt}>
                <TextField.Root
                  id="broadcastAt"
                  type="datetime-local"
                  value={form.broadcastAt}
                  onChange={(e) => set("broadcastAt", e.target.value)}
                  color={errors.broadcastAt ? "red" : undefined}
                  className="admin-date-field"
                />
              </Property>
              <Property label="Durée" icon={<TimerIcon />} htmlFor="duration" hint="h:mm:ss, par exemple 1:30:00." error={errors.duration}>
                <TextField.Root
                  id="duration"
                  value={form.duration}
                  onChange={(e) => set("duration", e.target.value)}
                  placeholder="2:00:00"
                  color={errors.duration ? "red" : undefined}
                  autoComplete="off"
                  className="admin-short-field"
                />
              </Property>
              <Property
                label="Artistes"
                icon={<PersonIcon />}
                htmlFor="show-artists"
                hint="Dans l'ordre d'affichage (« A b2b B ») : glisse une pastille pour la déplacer. Un nom inconnu crée un artiste, en brouillon."
                error={errors.artists}
              >
                <TokenPicker
                  id="show-artists"
                  label="Artistes"
                  values={form.artists}
                  options={sheet.artists}
                  onChange={(values) => set("artists", values)}
                  placeholder="Ajouter un artiste…"
                  error={errors.artists}
                  ordered
                />
              </Property>
              {tags.shown.map((facet) => (
                <Property key={facet.id} label={facet.name} icon={<BookmarkIcon />}>
                  <FacetPicker
                    facet={facet}
                    names={tags.names}
                    elsewhere={(tagId, groupId) => tags.elsewhere(tagId, facet.id, groupId)}
                    value={form.tags}
                    onToggle={toggleTag}
                  />
                </Property>
              ))}
              {form.type !== "podcast" && (
                <Property
                  label="Mood"
                  icon={<MixerHorizontalIcon />}
                  hint={`De ${LABELS.energy.low.toLowerCase()} (${ENERGY.min}) à ${LABELS.energy.high.toLowerCase()} (${ENERGY.max}) : le curseur des filtres du site, pour les DJ sets et les playlists.`}
                  error={errors.energy}
                >
                  <Flex align="center" gap="3" wrap="wrap">
                    <Text size="2" color="gray">
                      {LABELS.energy.low}
                    </Text>
                    <SegmentedControl.Root value={form.energy} onValueChange={(value) => set("energy", value)} aria-label="Mood, de calme à énergique" size="2" className="admin-energy">
                      {ENERGY_STEPS.map((step) => (
                        <SegmentedControl.Item key={step} value={step}>
                          {step}
                        </SegmentedControl.Item>
                      ))}
                    </SegmentedControl.Root>
                    <Text size="2" color="gray">
                      {LABELS.energy.high}
                    </Text>
                    {form.energy && (
                      <Button type="button" size="1" variant="ghost" color="gray" onClick={() => set("energy", "")}>
                        Retirer
                      </Button>
                    )}
                  </Flex>
                </Property>
              )}
              {tags.stray.length > 0 && (
                <Property
                  label="Hors de ce type"
                  icon={<ExclamationTriangleIcon />}
                  hint={`Ces étiquettes ne comptent pas pour les ${typePlural ?? "shows de ce type"} : retire-les, ou change le type.`}
                >
                  <div className="admin-picked">
                    {tags.stray.map((id) => (
                      <span key={id} className="admin-picked-chip" data-warn>
                        {tags.names.get(id) ?? "?"}
                        <button type="button" className="admin-picked-remove" onClick={() => toggleTag(id)} aria-label={`Retirer ${tags.names.get(id) ?? ""}`}>
                          <Cross2Icon />
                        </button>
                      </span>
                    ))}
                    {tags.stray.length > 1 && (
                      <Button type="button" size="1" variant="ghost" color="gray" onClick={() => set("tags", form.tags.filter((value) => !tags.stray.includes(value)))}>
                        Tout retirer
                      </Button>
                    )}
                  </div>
                </Property>
              )}
              <Property
                label="Autres"
                icon={<BookmarkIcon />}
                htmlFor={tags.loose.length || moreTags ? "show-other-tags" : undefined}
                hint={tags.loose.length || moreTags ? "Une étiquette qui n'est dans aucun filtre : tape son nom. Elle sera à classer dans Étiquettes." : undefined}
                error={errors.tags}
              >
                {tags.loose.length || moreTags ? (
                  <TokenPicker
                    id="show-other-tags"
                    label="Autres étiquettes"
                    values={tags.loose}
                    options={tags.looseOptions}
                    onChange={(values) => set("tags", [...form.tags.filter((value) => !tags.loose.includes(value)), ...values])}
                    placeholder="Nom de l'étiquette…"
                    newLabel="nouvelle"
                    newNote="à classer"
                    error={errors.tags}
                  />
                ) : (
                  <Button type="button" variant="ghost" size="2" onClick={() => setMoreTags(true)} className="admin-ghost-add">
                    <PlusIcon /> Une étiquette qui n'est dans aucun filtre
                  </Button>
                )}
              </Property>
            </div>
            <Section title="Description">
              <TextEditor
                id="description"
                label="Description"
                value={form.description}
                onChange={(value) => set("description", value)}
                error={errors.description}
                placeholder="Le show en quelques lignes : l'ambiance, les invités, l'occasion…"
              />
            </Section>
            <TracklistEditor rows={form.tracks} onChange={(tracks) => set("tracks", tracks)} errors={errors} />
            <ReceivedParts url={url} envoi={sheet.envoi} onChange={(envoi) => setSheet((current) => ({ ...current, envoi }))} />
          </div>

          <aside className="admin-sheet-side" aria-label="Pochette, son et informations">
            <SidePanel title="Pochette">
              <ImageField
                image={sheet.cover}
                kind="pochette"
                shape="square"
                suggestion={form.title.trim() ? `Pochette de « ${form.title.trim()} »` : ""}
                uploads={sheet.uploads}
                blocked={sheet.id ? undefined : "Enregistre d'abord la fiche : sa pochette s'ajoute ensuite."}
                onPlace={placeCover}
                onDescribed={(cover) => setSheet((current) => ({ ...current, cover }))}
              />
            </SidePanel>
            <SubmissionPanel url={url} envoi={sheet.envoi} dirty={dirty} />
            <SidePanel title="Son">
              <ReceivedSound url={url} envoi={sheet.envoi} onChange={(envoi) => setSheet((current) => ({ ...current, envoi }))} />
              <Field label="Piste SoundCloud" htmlFor="soundcloudUrl" optional error={errors.soundcloudUrl}>
                <TextField.Root
                  id="soundcloudUrl"
                  value={form.soundcloudUrl}
                  onChange={(e) => set("soundcloudUrl", e.target.value)}
                  placeholder="https://soundcloud.com/…"
                  inputMode="url"
                  color={errors.soundcloudUrl ? "red" : undefined}
                  autoComplete="off"
                >
                  {soundcloud && (
                    <TextField.Slot side="right">
                      <IconButton asChild size="1" variant="ghost" color="gray">
                        <a href={soundcloud} target="_blank" rel="noopener noreferrer" aria-label="Ouvrir la piste sur SoundCloud">
                          <ExternalLinkIcon />
                        </a>
                      </IconButton>
                    </TextField.Slot>
                  )}
                </TextField.Root>
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
            </SidePanel>
            <SidePanel title="Informations">
              <Field label="Adresse sur le site" htmlFor="slug" optional hint="Minuscules, chiffres et tirets. Vide, elle est tirée du titre." error={errors.slug}>
                <TextField.Root
                  id="slug"
                  value={form.slug}
                  onChange={(e) => set("slug", e.target.value)}
                  color={errors.slug ? "red" : undefined}
                  autoComplete="off"
                  autoCapitalize="off"
                  className="admin-mono"
                />
              </Field>
              {(sheet.created || sheet.radiocultEventId) && (
                <DataList.Root size="1" className="admin-facts">
                  {sheet.created && (
                    <DataList.Item>
                      <DataList.Label minWidth="80px">Créé</DataList.Label>
                      <DataList.Value>{sheet.created}</DataList.Value>
                    </DataList.Item>
                  )}
                  {sheet.updated && (
                    <DataList.Item>
                      <DataList.Label minWidth="80px">Modifié</DataList.Label>
                      <DataList.Value>{sheet.updated}</DataList.Value>
                    </DataList.Item>
                  )}
                  {sheet.radiocultEventId && (
                    <DataList.Item>
                      <DataList.Label minWidth="80px">Radio Cult</DataList.Label>
                      <DataList.Value>
                        <Text className="admin-break" title={`Créneau ${sheet.radiocultEventId}`}>
                          Importé de la programmation.{" "}
                          {sheet.status === "draft"
                            ? "Tant qu'il est en brouillon, sa date et sa durée suivent le créneau de Radio Cult."
                            : "Publié, il ne suit plus Radio Cult : un créneau déplacé est signalé à l'accueil."}
                        </Text>
                      </DataList.Value>
                    </DataList.Item>
                  )}
                </DataList.Root>
              )}
            </SidePanel>
          </aside>
        </div>
      </div>
    </form>
  );
}
