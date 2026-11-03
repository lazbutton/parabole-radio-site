/**
 * La fiche d'un artiste (cms/README.md, 9.2) : la barre de la fiche en haut (sheet.tsx), puis le nom en grand, le
 * rôle, ses étiquettes (une ligne par filtre des artistes : Activité — podcast, playlist, DJ), la bio et les liens
 * (dans l'ordre) ; à côté, la photo, ses shows et les informations. Même enregistrement que la fiche d'un show, sans
 * quitter l'écran. La photo, elle, se met en place dès son envoi (ImageField).
 */
import { LABELS } from "@parabole/cms/labels";
import type { ArtistForm, FieldErrors } from "@parabole/cms";
import { ArrowDownIcon, ArrowUpIcon, BookmarkIcon, DotsHorizontalIcon, DragHandleDots2Icon, ExternalLinkIcon, PersonIcon, PlusIcon, TrashIcon } from "@radix-ui/react-icons";
import { Badge, Button, DataList, DropdownMenu, Flex, IconButton, SegmentedControl, Select, Text, TextField } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { FacetPicker } from "./FacetPicker";
import { ImageField, placeImage } from "./ImageField";
import { StatusBadge, TypeTile } from "./marks";
import { forgetRecent, rememberRecent } from "./recents";
import { useBlocker, useRouter } from "./router";
import { Field, filledPlaces, FormError, mergeSaved, placeErrors, postForm, Property, Section, SheetBar, SidePanel, TitleInput, useSheetKeys, type Intent, type SaveIntent } from "./sheet";
import { useSortable } from "./sortable";
import { counted } from "./text";
import { TextEditor } from "./TextEditor";
import { useNotify } from "./toast";
import type { ArtistEditorData, ArtistSheet, MediaView, SaveResponse } from "./types";

type LinkRow = { label: string; url: string; key: string };
type EditorForm = Omit<ArtistForm, "links"> & { links: LinkRow[] };

let counter = 0;
const linkRow = (link: Partial<LinkRow> = {}): LinkRow => ({ label: "", url: "", ...link, key: `l${++counter}` });
const toEditor = (form: ArtistForm): EditorForm => ({ ...form, links: form.links.map((link) => linkRow(link)) });
/** Un lien rempli ; les vides ne partent pas au serveur. */
const filled = (link: LinkRow) => Boolean(link.label.trim() || link.url.trim());
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
  return data;
}

/** La valeur « aucun » de la liste des artistes de Radio Cult (une valeur vide n'est pas permise). */
const NO_RADIOCULT = "aucun";

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
  const linked = [sheet.shows.length && counted(sheet.shows.length, "show"), sheet.events && counted(sheet.events, "événement")].filter(Boolean).join(" et ");

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
        back={{ label: "Artistes", href: "/admin/artistes" }}
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
              <Property label="Rôle" icon={<PersonIcon />} hint={form.role === "resident" ? "Résident : une émission régulière sur Parabole." : "Invité : de passage, le temps d'un show ou d'un événement."} error={errors.role}>
                <SegmentedControl.Root value={form.role} onValueChange={(value) => set("role", value)} aria-label="Rôle" size="2">
                  {Object.entries(LABELS.artistRole).map(([value, label]) => (
                    <SegmentedControl.Item key={value} value={value}>
                      {label}
                    </SegmentedControl.Item>
                  ))}
                </SegmentedControl.Root>
              </Property>
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
              <TextEditor id="bio" label="Bio" value={form.bio} onChange={(value) => set("bio", value)} error={errors.bio} placeholder="Qui est-ce, ce qu'on entend dans ses shows, d'où ça vient…" />
            </Section>
            <LinksEditor links={form.links} onChange={(links) => set("links", links)} errors={errors} />
          </div>

          <aside className="admin-sheet-side" aria-label="Photo, shows et informations">
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
            {sheet.id && (
              <SidePanel title="Ses shows" aside={sheet.shows.length ? <Badge color="gray" radius="full">{sheet.shows.length}</Badge> : undefined}>
                {sheet.shows.length ? (
                  <div className="admin-mini-list">
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
                  <Text size="2" color="gray">
                    Aucun show pour l'instant. On relie un artiste à un show depuis la fiche du show.
                  </Text>
                )}
              </SidePanel>
            )}
            <SidePanel title="Informations">
              <Field label="Adresse sur le site" htmlFor="slug" optional hint="Minuscules, chiffres et tirets. Vide, elle est tirée du nom." error={errors.slug}>
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
  const hint = "Ses créneaux dans la grille de Radio Cult deviennent ses shows, à chaque import.";
  if (!choices)
    return (
      <Field label="Artiste Radio Cult" optional hint={hint} error={error}>
        <Text size="2" color="gray">
          {value ? "Relié à un artiste de Radio Cult." : "Relié à aucun artiste."} La liste de Radio Cult ne répond pas : le lien reste tel quel.
        </Text>
      </Field>
    );
  // Un artiste relié puis retiré de Radio Cult reste visible, pour qu'on voie le lien à défaire.
  const listed = value && !choices.some((choice) => choice.id === value) ? [...choices, { id: value, name: "" }] : choices;
  return (
    <Field label="Artiste Radio Cult" htmlFor="radiocult" optional hint={hint} error={error}>
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

/** Les liens d'un artiste, dans l'ordre d'affichage : libellé et adresse, comme les lignes d'une tracklist. */
function LinksEditor({ links, onChange, errors }: { links: LinkRow[]; onChange(links: LinkRow[]): void; errors: FieldErrors }) {
  const sortable = useSortable(links, onChange);
  const update = (index: number, field: "label" | "url", value: string) => onChange(links.map((link, i) => (i === index ? { ...link, [field]: value } : link)));
  const add = () => {
    onChange([...links, linkRow()]);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-link="${links.length}"]`)?.focus());
  };
  return (
    <Section
      title="Liens"
      count={
        links.length > 0 && (
          <Badge color="gray" radius="full">
            {links.length}
          </Badge>
        )
      }
      aside={
        <Button type="button" variant="soft" onClick={add}>
          <PlusIcon /> Ajouter un lien
        </Button>
      }
    >
      <Text as="p" size="2" color="gray" mb="2">
        Dans l'ordre d'affichage. Sans libellé, le nom du site est repris (Instagram, SoundCloud…).
      </Text>
      {errors.links && (
        <Text as="p" size="1" color="red" mb="2">
          {errors.links}
        </Text>
      )}
      {links.length > 0 && (
        <div className="admin-links" ref={(element) => void (sortable.container.current = element)}>
          {links.map((link, index) => {
            const problems = [errors[`links.${index}.label`], errors[`links.${index}.url`]].filter(Boolean);
            const href = /^https?:\/\//.test(link.url.trim()) ? link.url.trim() : null;
            return (
              <div key={link.key} className="admin-link" data-sort-index={index} data-dragging={sortable.dragging === index || undefined} data-invalid={problems.length > 0 || undefined}>
                <span className="admin-grip" aria-hidden {...sortable.handle(index)}>
                  <DragHandleDots2Icon />
                </span>
                <input
                  className="admin-cell admin-link-label"
                  value={link.label}
                  onChange={(e) => update(index, "label", e.target.value)}
                  placeholder="Libellé"
                  aria-label={`Libellé du lien ${index + 1}`}
                  aria-invalid={errors[`links.${index}.label`] ? true : undefined}
                  data-link={index}
                  autoComplete="off"
                />
                <input
                  className="admin-cell admin-link-url"
                  value={link.url}
                  onChange={(e) => update(index, "url", e.target.value)}
                  placeholder="https://…"
                  inputMode="url"
                  aria-label={`Adresse du lien ${index + 1}`}
                  aria-invalid={errors[`links.${index}.url`] ? true : undefined}
                  autoComplete="off"
                  autoCapitalize="off"
                />
                {href ? (
                  <IconButton asChild size="1" variant="ghost" color="gray" className="admin-link-open">
                    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir le lien ${index + 1}`}>
                      <ExternalLinkIcon />
                    </a>
                  </IconButton>
                ) : (
                  <span className="admin-link-open" />
                )}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    <IconButton type="button" size="1" variant="ghost" color="gray" aria-label={`Actions du lien ${index + 1}`}>
                      <DotsHorizontalIcon />
                    </IconButton>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end" size="1">
                    <DropdownMenu.Item disabled={index === 0} onSelect={() => sortable.move(index, index - 1)}>
                      <ArrowUpIcon /> Monter
                    </DropdownMenu.Item>
                    <DropdownMenu.Item disabled={index === links.length - 1} onSelect={() => sortable.move(index, index + 1)}>
                      <ArrowDownIcon /> Descendre
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item color="red" onSelect={() => onChange(links.filter((_, i) => i !== index))}>
                      <TrashIcon /> Retirer
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
                {problems.length > 0 && (
                  <Text size="1" color="red" className="admin-link-error">
                    {problems.join(" ")}
                  </Text>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
