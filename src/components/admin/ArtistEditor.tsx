/**
 * La fiche d'un artiste (cms/README.md, 9.2) : la barre de la fiche en haut (sheet.tsx), puis le nom en grand, le
 * rôle, ses étiquettes (une ligne par filtre des artistes : Activité — podcast, playlist, DJ), la bio, les liens (dans
 * l'ordre) et ses émissions ; à côté, la photo et les informations (le lien de sa page, sa fiche Radio Cult). Même
 * enregistrement que la fiche d'une émission, sans quitter l'écran. La photo, elle, se met en place dès son envoi (ImageField).
 */
import { LABELS } from "@parabole/cms/labels";
import type { ArtistForm, FieldErrors } from "@parabole/cms";
import { BookmarkIcon, CalendarIcon, PersonIcon } from "@radix-ui/react-icons";
import { Badge, DataList, Flex, SegmentedControl, Select, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { UploadLinkPanel } from "./EnvoiPanels";
import { FacetPicker } from "./FacetPicker";
import { ImageField, placeImage } from "./ImageField";
import { StatusBadge, TypeTile } from "./marks";
import { forgetRecent, rememberRecent } from "./recents";
import { useBlocker, useRouter } from "./router";
import { filledRow, newRow, RowsEditor, type Row } from "./RowsEditor";
import { Field, filledPlaces, FormError, mergeSaved, placeErrors, postForm, Property, Section, SheetBar, SidePanel, SlugField, TitleInput, useSheetKeys, type Intent, type SaveIntent } from "./sheet";
import { counted } from "./text";
import { TextEditor } from "./TextEditor";
import { useNotify } from "./toast";
import type { ArtistEditorData, ArtistSheet, MediaView, SaveResponse } from "./types";

const LINK_FIELDS = ["label", "url"] as const;
type LinkRow = Row<(typeof LINK_FIELDS)[number]>;
type EditorForm = Omit<ArtistForm, "links"> & { links: LinkRow[] };

const toEditor = (form: ArtistForm): EditorForm => ({ ...form, links: form.links.map((link) => newRow(LINK_FIELDS, link)) });
/** Un lien rempli ; les vides ne partent pas au serveur. */
const filled = (link: LinkRow) => filledRow(link, LINK_FIELDS);
const fingerprint = (form: EditorForm) => JSON.stringify({ ...form, tags: [...form.tags].sort(), links: form.links.filter(filled).map(({ key: _key, ...link }) => link) });

/** `radiocult` : la liste de Radio Cult était là, le choix s'envoie ; sinon le lien de la fiche ne change pas. */
function formData(form: EditorForm, intent: Intent, version: string, radiocult: boolean): FormData {
  const data = new FormData();
  data.set("intent", intent);
  data.set("version", version);
  for (const field of ["name", "slug", "role", "bio"] as const) data.set(field, form[field]);
  for (const tag of form.tags) data.append("tag", tag);
  for (const link of form.links.filter(filled)) {
    data.append("linkLabel", link.label);
    data.append("linkUrl", link.url);
  }
  if (radiocult) data.set("radiocultArtistId", form.radiocultArtistId ?? "");
  // Les groupes de diffusion sont ceux des résidents : un invité n'en a pas.
  data.set("broadcastGroup", form.role === "resident" ? (form.broadcastGroup ?? "") : "");
  return data;
}

/** La valeur « aucun » de la liste des artistes de Radio Cult (une valeur vide n'est pas permise). */
const NO_RADIOCULT = "aucun";
/** De même pour le groupe de diffusion. */
const NO_GROUP = "aucun";

const DONE: Record<SaveIntent, string> = { save: "Fiche enregistrée", publish: "Artiste publié", unpublish: "Artiste dépublié : repassé en brouillon" };

export function ArtistEditor({ sheet: initialSheet }: ArtistEditorData) {
  const router = useRouter();
  const notify = useNotify();
  const [sheet, setSheet] = useState(initialSheet);
  const [form, setForm] = useState(() => toEditor(initialSheet.form));
  const [saved, setSaved] = useState(() => fingerprint(toEditor(initialSheet.form)));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<Intent | null>(null);
  const dirty = useMemo(() => fingerprint(form) !== saved, [form, saved]);
  const set = <K extends keyof EditorForm>(field: K, value: EditorForm[K]) => setForm((current) => ({ ...current, [field]: value }));
  const tagNames = useMemo(() => new Map(sheet.tags.map((tag) => [tag.id, tag.name])), [sheet.tags]);
  const toggleTag = (id: string) => set("tags", form.tags.includes(id) ? form.tags.filter((value) => value !== id) : [...form.tags, id]);
  const url = sheet.id ? `/admin/artistes/${sheet.id}` : "/admin/artistes/nouveau";

  // La fiche rejoint les « ouverts récemment » de la recherche (⌘K), sous son nom enregistré.
  useEffect(() => {
    if (sheet.id) rememberRecent({ href: `/admin/artistes/${sheet.id}`, title: sheet.form.name || "Sans nom", kind: "artist" });
  }, [sheet.id, sheet.form.name]);

  /** Envoie la fiche ; vrai si elle est enregistrée. */
  async function save(intent: SaveIntent): Promise<boolean> {
    if (busy) return false;
    setBusy(intent);
    const sent = form;
    const result = await postForm<SaveResponse<ArtistSheet>>(url, formData(form, intent, sheet.version, sheet.radiocult.choices !== null));
    setBusy(null);
    if (result.ok && "sheet" in result) {
      setSheet(result.sheet);
      const fresh = toEditor(result.sheet.form);
      // Les lignes gardent leur clé : le champ où l'on tapait reste en place.
      const keys = sent.links.filter(filled).map((link) => link.key);
      fresh.links = fresh.links.map((link, index) => ({ ...link, key: keys[index] ?? link.key }));
      setForm((current) => mergeSaved(current, sent, fresh));
      setSaved(fingerprint(fresh));
      setErrors({});
      // Les listes ont changé ; une fiche créée prend son adresse.
      router.invalidate();
      router.replace(`/admin/artistes/${result.sheet.id}`, { name: "artist", title: result.sheet.form.name, data: { sheet: result.sheet } });
      notify({ kind: "success", title: result.created && intent === "save" ? "Artiste créé, en brouillon" : DONE[intent] });
      return true;
    }
    if (result.ok) return false;
    // La saisie reste telle quelle ; les erreurs des liens reviennent sur leurs lignes.
    setErrors(placeErrors(result.errors, "links", filledPlaces(sent.links, filled)));
    if ("version" in result && result.version) setSheet((current) => ({ ...current, version: result.version! }));
    notify({ kind: "error", title: "La fiche n'est pas enregistrée", description: result.errors.form ?? "Corrige les champs signalés." });
    return false;
  }

  /** Met une image à la place de la photo, ou la retire : tout de suite, sans enregistrer le reste de la fiche. */
  async function placePhoto(image: MediaView | null): Promise<string | null> {
    const result = await placeImage(url, "photo", image, sheet.version);
    if (!result.ok) return result.errors.form ?? result.errors.image ?? "Le serveur a refusé.";
    setSheet((current) => ({ ...current, photo: result.image, version: result.version ?? current.version, updated: result.updated ?? current.updated }));
    // Les listes (artistes sans photo…) ont changé.
    router.invalidate();
    return null;
  }

  async function remove() {
    setBusy("delete");
    const result = await postForm<SaveResponse<ArtistSheet>>(url, formData(form, "delete", sheet.version, false));
    if (result.ok && "redirect" in result) {
      forgetRecent(url);
      router.invalidate();
      router.setBlocker(null);
      notify({ kind: "success", title: result.message ?? "Artiste supprimé" });
      return router.navigate(result.redirect, { replace: true });
    }
    setBusy(null);
    notify({ kind: "error", title: "Suppression impossible", description: result.ok ? undefined : result.errors.form });
  }

  useBlocker(dirty, () => save("save"));
  useSheetKeys(dirty, () => void save("save"));
  const name = form.name.trim() || (sheet.id ? "Sans nom" : "Nouvel artiste");
  const linked = [sheet.shows.length && counted(sheet.shows.length, "émission"), sheet.events && counted(sheet.events, "événement")].filter(Boolean).join(" et ");

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
        back={{ label: "Résidents", href: "/admin/artistes" }}
        name={name}
        status={sheet.status}
        isNew={!sheet.id}
        dirty={dirty}
        busy={busy}
        updated={sheet.updated}
        onSave={(intent) => void save(intent)}
        deleteTitle={sheet.id ? `Supprimer « ${sheet.form.name} » ?` : undefined}
        deleteNote={`La fiche sera supprimée${linked ? `, et l'artiste retiré de ${linked}` : ""}.`}
        onDelete={remove}
      />
      <div className="admin-sheet-body">
        <FormError message={errors.form} />
        <div className="admin-sheet-grid">
          <div className="admin-sheet-main">
            <TitleInput id="name" label="Nom de l'artiste" value={form.name} onChange={(value) => set("name", value)} placeholder="Nom de l'artiste" error={errors.name} />
            <div className="admin-props">
              <Property label="Rôle" icon={<PersonIcon />} hint={form.role === "resident" ? "Résident : une émission régulière sur Parabole." : "Invité : de passage, le temps d'une émission ou d'un événement."} error={errors.role}>
                <SegmentedControl.Root value={form.role} onValueChange={(value) => set("role", value)} aria-label="Rôle" size="2">
                  {Object.entries(LABELS.artistRole).map(([value, label]) => (
                    <SegmentedControl.Item key={value} value={value}>
                      {label}
                    </SegmentedControl.Item>
                  ))}
                </SegmentedControl.Root>
              </Property>
              {form.role === "resident" && (
                <Property
                  label="Groupe"
                  icon={<CalendarIcon />}
                  hint="Les deux groupes alternent à l'antenne par blocs de deux semaines : la deadline de ses envois suit son groupe."
                  error={errors.broadcastGroup}
                >
                  <SegmentedControl.Root value={form.broadcastGroup || NO_GROUP} onValueChange={(value) => set("broadcastGroup", value === NO_GROUP ? "" : value)} aria-label="Groupe de diffusion" size="2">
                    <SegmentedControl.Item value={NO_GROUP}>Aucun</SegmentedControl.Item>
                    <SegmentedControl.Item value="1">Groupe 1</SegmentedControl.Item>
                    <SegmentedControl.Item value="2">Groupe 2</SegmentedControl.Item>
                  </SegmentedControl.Root>
                </Property>
              )}
              {sheet.facets.map((facet) => (
                <Property key={facet.id} label={facet.name} icon={<BookmarkIcon />} error={errors.tags}>
                  {facet.groups.length ? (
                    <FacetPicker facet={facet} names={tagNames} elsewhere={() => []} value={form.tags} onToggle={toggleTag} />
                  ) : (
                    <Text size="2" color="gray">
                      Pas encore d'étiquette dans ce filtre : ajoute-les dans Étiquettes.
                    </Text>
                  )}
                </Property>
              ))}
            </div>
            <Section title="Bio">
              <TextEditor id="bio" label="Bio" value={form.bio} onChange={(value) => set("bio", value)} error={errors.bio} placeholder="Qui est-ce, ce qu'on entend dans ses émissions, d'où ça vient…" />
            </Section>
            <RowsEditor
              title="Liens"
              name="links"
              hint="Dans l'ordre d'affichage. Sans libellé, le nom du site est repris (Instagram, SoundCloud…)."
              addLabel="Ajouter un lien"
              rows={form.links}
              columns={[
                { field: "label", label: "Libellé du lien", placeholder: "Libellé" },
                { field: "url", label: "Adresse du lien", placeholder: "https://…", url: true },
              ]}
              errors={errors}
              onChange={(links) => set("links", links)}
            />
            {sheet.id && (
              <Section title="Ses émissions" count={sheet.shows.length ? <Badge color="gray" radius="full">{sheet.shows.length}</Badge> : undefined}>
                {sheet.shows.length ? (
                  <div className="admin-mini-list admin-mini-grid">
                    {sheet.shows.map((show) => (
                      <a key={show.id} className="admin-mini-item" href={`/admin/shows/${show.id}`} data-astro-prefetch="false">
                        <TypeTile type={show.type} size={28} />
                        <Flex direction="column" minWidth="0" flexGrow="1">
                          <Text size="2" weight="medium" className="admin-break">
                            {show.title}
                          </Text>
                          <Text size="1" color="gray">
                            {LABELS.showType[show.type]} · {show.date}
                          </Text>
                        </Flex>
                        {show.status === "draft" && <StatusBadge status="draft" />}
                      </a>
                    ))}
                  </div>
                ) : (
                  <Text as="p" size="2" color="gray">
                    Aucune émission pour l'instant. Elles arrivent avec l'import de Radio Cult (si l'artiste y est relié, ci-contre), ou depuis la fiche d'une émission.
                  </Text>
                )}
              </Section>
            )}
          </div>

          <aside className="admin-sheet-side" aria-label="Photo, lien d'envoi et informations">
            <SidePanel title="Photo">
              <ImageField
                image={sheet.photo}
                kind="photo"
                shape="square"
                suggestion={`Portrait de ${form.name.trim() || "l'artiste"}`}
                uploads={sheet.uploads}
                blocked={sheet.id ? undefined : "Enregistre d'abord la fiche : sa photo s'ajoute ensuite."}
                onPlace={placePhoto}
                onDescribed={(photo) => setSheet((current) => ({ ...current, photo }))}
              />
            </SidePanel>
            {sheet.id && <UploadLinkPanel url={url} name={sheet.form.name || "l'artiste"} link={sheet.uploadLink} onChange={(uploadLink) => setSheet((current) => ({ ...current, uploadLink }))} />}
            <SidePanel title="Informations">
              <SlugField base="/residents" value={form.slug} saved={sheet.form.slug} published={sheet.status === "published"} from="du nom" error={errors.slug} onChange={(value) => set("slug", value)} />
              <RadioCultField
                value={form.radiocultArtistId ?? ""}
                choices={sheet.radiocult.choices}
                taken={sheet.radiocult.taken}
                error={errors.radiocultArtistId}
                onChange={(value) => set("radiocultArtistId", value)}
              />
              {sheet.created && (
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
                </DataList.Root>
              )}
            </SidePanel>
          </aside>
        </div>
      </div>
    </form>
  );
}

/**
 * L'artiste de Radio Cult de la fiche, choisi dans la liste de la station : l'import de la programmation relie ses
 * créneaux à cette fiche. Un artiste déjà relié à une autre fiche est grisé, avec son nom. Sans la liste (pas de clé
 * publishable, ou Radio Cult ne répond pas), le lien reste tel quel.
 */
function RadioCultField({
  value,
  choices,
  taken,
  error,
  onChange,
}: {
  value: string;
  choices: { id: string; name: string }[] | null;
  taken: Record<string, string>;
  error?: string;
  onChange(value: string): void;
}) {
  const label = (choice: { id: string; name: string }) => choice.name || `Sans nom (${choice.id.slice(0, 8)})`;
  const hint =
    "Sa fiche chez Radio Cult, la station du direct. Reliée, l'import de chaque nuit fait de ses créneaux de la grille des émissions sur cette fiche, en brouillon à compléter.";
  if (!choices)
    return (
      <Field label="Fiche Radio Cult" optional hint={hint} error={error}>
        <Text size="2" color="gray">
          {value ? "Relié à un artiste de Radio Cult." : "Relié à aucun artiste."} La liste de Radio Cult ne répond pas : le lien reste tel quel.
        </Text>
      </Field>
    );
  // Un artiste relié puis retiré de Radio Cult reste visible, pour qu'on voie le lien à défaire.
  const listed = value && !choices.some((choice) => choice.id === value) ? [...choices, { id: value, name: "" }] : choices;
  return (
    <Field label="Fiche Radio Cult" htmlFor="radiocult" optional hint={hint} error={error}>
      <Select.Root value={value || NO_RADIOCULT} onValueChange={(next) => onChange(next === NO_RADIOCULT ? "" : next)}>
        <Select.Trigger id="radiocult" color={error ? "red" : undefined} />
        <Select.Content position="popper">
          <Select.Item value={NO_RADIOCULT}>Aucun</Select.Item>
          {listed.length > 0 && <Select.Separator />}
          {listed.map((choice) => (
            <Select.Item key={choice.id} value={choice.id} disabled={choice.id in taken}>
              {choice.id in taken ? `${label(choice)}, relié à ${taken[choice.id]}` : choices.includes(choice) ? label(choice) : `Introuvable chez Radio Cult (${choice.id.slice(0, 8)})`}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Field>
  );
}
