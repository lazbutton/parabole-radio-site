/**
 * La fiche d'un événement (cms/README.md, 9.2), sur le modèle de celle d'un show. En haut, la barre de la fiche
 * (sheet.tsx). Dessous, le titre en grand, puis les propriétés en lignes — catégorie, début, fin, lieu, adresse,
 * artistes, inscription —, la description et les photos ; à côté, le visuel et les informations. Enregistrer, Publier
 * et Dépublier envoient la fiche sans quitter l'écran ; une erreur s'affiche à côté du champ fautif. Une fiche modifiée
 * retient la navigation. Le visuel et la galerie, eux, changent dès leur envoi (ImageField, GalleryField).
 *
 * La catégorie se choisit à la souris dans le filtre Catégorie des événements (FacetPicker) ; il en faut une pour
 * publier. Une étiquette hors de ce filtre se tape dans « Autres » : elle sera à classer.
 */
import type { EventForm, FieldErrors } from "@parabole/cms";
import { BookmarkIcon, CalendarIcon, ExternalLinkIcon, HomeIcon, Link2Icon, PersonIcon, PlusIcon, SewingPinIcon } from "@radix-ui/react-icons";
import { Button, DataList, IconButton, Link, Text, TextField } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import { FacetPicker } from "./FacetPicker";
import { GalleryField } from "./GalleryField";
import { ImageField, placeImage } from "./ImageField";
import { forgetRecent, rememberRecent } from "./recents";
import { useBlocker, useRouter } from "./router";
import { Field, FormError, mergeSaved, postForm, Property, Section, SheetBar, SidePanel, TitleInput, useSheetKeys, type Intent, type SaveIntent } from "./sheet";
import { TextEditor } from "./TextEditor";
import { useNotify } from "./toast";
import { TokenPicker } from "./TokenPicker";
import type { Choice, EventEditorData, EventSheet, MediaView, SaveResponse } from "./types";

function formData(form: EventForm, intent: Intent, version: string): FormData {
  const data = new FormData();
  data.set("intent", intent);
  data.set("version", version);
  for (const field of ["title", "slug", "startsAt", "endsAt", "venue", "address", "description", "ticketUrl"] as const) data.set(field, form[field]);
  for (const value of form.artists) data.append("artist", value);
  for (const value of form.tags) data.append("tag", value);
  return data;
}

const DONE: Record<SaveIntent, string> = { save: "Événement enregistré", publish: "Événement publié", unpublish: "Événement dépublié : repassé en brouillon" };

/** Les étiquettes de la fiche : celles du filtre Catégorie, à choisir à la souris, et les autres (« Autres »). */
function useTagChoices(sheet: EventSheet, chosen: string[]) {
  return useMemo(() => {
    const facets = new Map(sheet.facets.map((facet) => [facet.id, facet]));
    const names = new Map(sheet.tags.map((tag) => [tag.id, tag.name]));
    const places = new Map(sheet.tags.map((tag) => [tag.id, tag.places]));
    /** Les autres places d'une étiquette, en mots : l'aide au survol d'une pastille. */
    const elsewhere = (tagId: string, facetId: string, groupId: string | null) =>
      (places.get(tagId) ?? [])
        .filter((place) => !(place.facetId === facetId && place.groupId === groupId))
        .map((place) => (place.groupId ? `${facets.get(place.facetId)?.name} › ${names.get(place.groupId)}` : `${facets.get(place.facetId)?.name}`));
    // Nouvelles, ou dans aucun filtre des événements : les « Autres ».
    const loose = chosen.filter((value) => value.startsWith("nouveau:") || !(places.get(value)?.length ?? 0));
    const looseOptions: Choice[] = sheet.tags.filter((tag) => !tag.places.length).map((tag) => ({ id: tag.id, name: tag.name }));
    return { names, elsewhere, loose, looseOptions };
  }, [sheet.facets, sheet.tags, chosen]);
}

export function EventEditor({ sheet: initialSheet }: EventEditorData) {
  const router = useRouter();
  const notify = useNotify();
  const [sheet, setSheet] = useState(initialSheet);
  const [form, setForm] = useState(initialSheet.form);
  const [saved, setSaved] = useState(() => JSON.stringify(initialSheet.form));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<Intent | null>(null);
  const dirty = useMemo(() => JSON.stringify(form) !== saved, [form, saved]);
  const set = <K extends keyof EventForm>(field: K, value: EventForm[K]) => setForm((current) => ({ ...current, [field]: value }));
  const url = sheet.id ? `/admin/evenements/${sheet.id}` : "/admin/evenements/nouveau";

  // La fiche rejoint les « ouverts récemment » de la recherche (⌘K), sous son titre enregistré.
  useEffect(() => {
    if (sheet.id) rememberRecent({ href: `/admin/evenements/${sheet.id}`, title: sheet.form.title || "Sans titre", kind: "event" });
  }, [sheet.id, sheet.form.title]);

  /** Envoie la fiche ; vrai si elle est enregistrée. */
  async function save(intent: SaveIntent): Promise<boolean> {
    if (busy) return false;
    const publishing = intent === "publish" || (intent === "save" && sheet.status === "published");
    const missing: FieldErrors = {};
    if (!form.startsAt) missing.startsAt = "Il faut une date et une heure de début.";
    if (publishing && !form.tags.length) missing.tags = "Choisis sa catégorie pour publier.";
    if (Object.keys(missing).length) {
      setErrors(missing);
      document.getElementById(missing.startsAt ? "startsAt" : "event-category")?.focus();
      notify({ kind: "error", title: missing.startsAt ? "Il manque le début" : "Pas encore publiable", description: Object.values(missing).join(" ") });
      return false;
    }
    setBusy(intent);
    const sent = form;
    const result = await postForm<SaveResponse<EventSheet>>(url, formData(form, intent, sheet.version));
    setBusy(null);
    if (result.ok && "sheet" in result) {
      setSheet(result.sheet);
      setForm((current) => mergeSaved(current, sent, result.sheet.form));
      setSaved(JSON.stringify(result.sheet.form));
      setErrors({});
      // Les listes ont changé ; une fiche créée prend son adresse.
      router.invalidate();
      router.replace(`/admin/evenements/${result.sheet.id}`, { name: "event", title: result.sheet.form.title, data: { sheet: result.sheet } });
      const born = result.newArtists ?? 0;
      notify({
        kind: "success",
        title: result.created && intent === "save" ? "Événement créé, en brouillon" : DONE[intent],
        description: born ? `${born > 1 ? `${born} artistes créés` : "Un artiste créé"} en brouillon : complète leur fiche dans Artistes.` : undefined,
      });
      return true;
    }
    if (result.ok) return false;
    setErrors(result.errors);
    if ("version" in result && result.version) setSheet((current) => ({ ...current, version: result.version! }));
    notify({ kind: "error", title: "La fiche n'est pas enregistrée", description: result.errors.form ?? "Corrige les champs signalés." });
    return false;
  }

  /** Met une image à la place du visuel, ou la retire : tout de suite, sans enregistrer le reste de la fiche. */
  async function placeVisual(image: MediaView | null): Promise<string | null> {
    const result = await placeImage(url, "visual", image, sheet.version);
    if (!result.ok) return result.errors.form ?? result.errors.image ?? "Le serveur a refusé.";
    setSheet((current) => ({ ...current, visual: result.image, version: result.version ?? current.version, updated: result.updated ?? current.updated }));
    router.invalidate();
    return null;
  }

  async function remove() {
    setBusy("delete");
    const result = await postForm<SaveResponse<EventSheet>>(url, formData(form, "delete", sheet.version));
    if (result.ok && "redirect" in result) {
      forgetRecent(url);
      router.invalidate();
      router.setBlocker(null);
      notify({ kind: "success", title: result.message ?? "Événement supprimé" });
      return router.navigate(result.redirect, { replace: true });
    }
    setBusy(null);
    notify({ kind: "error", title: "Suppression impossible", description: result.ok ? undefined : result.errors.form });
  }

  useBlocker(dirty, () => save("save"));
  useSheetKeys(dirty, () => void save("save"));
  const name = form.title.trim() || (sheet.id ? "Sans titre" : "Nouvel événement");
  const tags = useTagChoices(sheet, form.tags);
  const [moreTags, setMoreTags] = useState(false);
  const toggleTag = (id: string) => set("tags", form.tags.includes(id) ? form.tags.filter((value) => value !== id) : [...form.tags, id]);
  const ticket = /^https?:\/\/\S+\.\S+/.test(form.ticketUrl.trim()) ? form.ticketUrl.trim() : null;
  const page = sheet.id && sheet.status === "published" ? `/evenements/${sheet.form.slug}` : null;

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
        back={{ label: "Événements", href: "/admin/evenements" }}
        name={name}
        status={sheet.status}
        isNew={!sheet.id}
        dirty={dirty}
        busy={busy}
        updated={sheet.updated}
        onSave={(intent) => void save(intent)}
        deleteTitle={sheet.id ? `Supprimer « ${sheet.form.title} » ?` : undefined}
        deleteNote="L'événement, ses liens aux artistes et sa galerie seront supprimés, avec ses images si elles ne servent nulle part ailleurs."
        onDelete={remove}
        view={page ? { label: "Voir la page sur le site", href: page } : undefined}
      />
      <div className="admin-sheet-body">
        <FormError message={errors.form} />
        <div className="admin-sheet-grid">
          <div className="admin-sheet-main">
            <TitleInput id="title" label="Titre de l'événement" value={form.title} onChange={(value) => set("title", value)} placeholder="Titre de l'événement" error={errors.title} />
            <div className="admin-props">
              {sheet.facets.map((facet, index) => (
                <Property key={facet.id} label={facet.name} icon={<BookmarkIcon />} hint={index === 0 ? "Montrée sous le nom de l'événement. Il en faut une pour publier." : undefined} error={index === 0 ? errors.tags : undefined}>
                  <div id={index === 0 ? "event-category" : undefined} tabIndex={-1}>
                    <FacetPicker
                      facet={facet}
                      names={tags.names}
                      elsewhere={(tagId, groupId) => tags.elsewhere(tagId, facet.id, groupId)}
                      value={form.tags}
                      onToggle={toggleTag}
                    />
                  </div>
                </Property>
              ))}
              <Property label="Début" icon={<CalendarIcon />} htmlFor="startsAt" hint="Heure de Paris." error={errors.startsAt}>
                <TextField.Root id="startsAt" type="datetime-local" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} color={errors.startsAt ? "red" : undefined} className="admin-date-field" />
              </Property>
              <Property
                label="Fin"
                icon={<CalendarIcon />}
                htmlFor="endsAt"
                hint="Facultative. Sans fin, l'événement reste « à venir » jusqu'à minuit le jour où il commence ; sur 24 heures ou plus (une expo), le site montre les deux dates."
                error={errors.endsAt}
              >
                <TextField.Root id="endsAt" type="datetime-local" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} color={errors.endsAt ? "red" : undefined} className="admin-date-field" />
              </Property>
              <Property label="Lieu" icon={<HomeIcon />} htmlFor="venue" error={errors.venue}>
                <TextField.Root
                  id="venue"
                  value={form.venue}
                  onChange={(e) => set("venue", e.target.value)}
                  placeholder="La Goutte d'Or"
                  color={errors.venue ? "red" : undefined}
                  autoComplete="off"
                  className="admin-wide-field"
                />
              </Property>
              <Property label="Adresse" icon={<SewingPinIcon />} htmlFor="address" hint="Le site en fait un lien vers la carte." error={errors.address}>
                <TextField.Root
                  id="address"
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="42 rue Myrha, 75018 Paris"
                  color={errors.address ? "red" : undefined}
                  autoComplete="off"
                  className="admin-wide-field"
                />
              </Property>
              <Property
                label="Artistes"
                icon={<PersonIcon />}
                htmlFor="event-artists"
                hint="Dans l'ordre d'affichage : glisse une pastille pour la déplacer. Un nom inconnu crée un artiste, en brouillon."
                error={errors.artists}
              >
                <TokenPicker
                  id="event-artists"
                  label="Artistes"
                  values={form.artists}
                  options={sheet.artists}
                  onChange={(values) => set("artists", values)}
                  placeholder="Ajouter un artiste…"
                  error={errors.artists}
                  ordered
                />
              </Property>
              <Property
                label="Inscription"
                icon={<Link2Icon />}
                htmlFor="ticketUrl"
                hint="Le lien d'inscription ou de la billetterie : la touche S'INSCRIRE de la page, tant que l'événement n'est pas passé."
                error={errors.ticketUrl}
              >
                <TextField.Root
                  id="ticketUrl"
                  value={form.ticketUrl}
                  onChange={(e) => set("ticketUrl", e.target.value)}
                  placeholder="https://…"
                  inputMode="url"
                  color={errors.ticketUrl ? "red" : undefined}
                  autoComplete="off"
                  className="admin-wide-field"
                >
                  {ticket && (
                    <TextField.Slot side="right">
                      <IconButton asChild size="1" variant="ghost" color="gray">
                        <a href={ticket} target="_blank" rel="noopener noreferrer" aria-label="Ouvrir le lien d'inscription">
                          <ExternalLinkIcon />
                        </a>
                      </IconButton>
                    </TextField.Slot>
                  )}
                </TextField.Root>
              </Property>
              <Property
                label="Autres"
                icon={<BookmarkIcon />}
                htmlFor={tags.loose.length || moreTags ? "event-other-tags" : undefined}
                hint={tags.loose.length || moreTags ? "Une étiquette qui n'est pas dans Catégorie : tape son nom. Elle sera à classer dans Étiquettes." : undefined}
              >
                {tags.loose.length || moreTags ? (
                  <TokenPicker
                    id="event-other-tags"
                    label="Autres étiquettes"
                    values={tags.loose}
                    options={tags.looseOptions}
                    onChange={(values) => set("tags", [...form.tags.filter((value) => !tags.loose.includes(value)), ...values])}
                    placeholder="Nom de l'étiquette…"
                    newLabel="nouvelle"
                    newNote="à classer"
                  />
                ) : (
                  <Button type="button" variant="ghost" size="2" onClick={() => setMoreTags(true)} className="admin-ghost-add">
                    <PlusIcon /> Une étiquette qui n'est pas dans Catégorie
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
                placeholder="L'événement en quelques lignes : ce qu'on y fait, pour qui, comment venir…"
              />
            </Section>
            <Section title="Photos" count={sheet.photos.length || undefined}>
              <GalleryField
                photos={sheet.photos}
                uploads={sheet.uploads}
                blocked={sheet.id ? undefined : "Enregistre d'abord la fiche : ses photos s'ajoutent ensuite."}
                title={form.title}
                url={url}
                onChange={(photos) => {
                  setSheet((current) => ({ ...current, photos }));
                  router.invalidate();
                }}
              />
            </Section>
          </div>

          <aside className="admin-sheet-side" aria-label="Visuel et informations">
            <SidePanel title="Visuel">
              <ImageField
                image={sheet.visual}
                kind="visuel"
                shape="free"
                suggestion={form.title.trim() ? `Affiche de « ${form.title.trim()} »` : ""}
                uploads={sheet.uploads}
                blocked={sheet.id ? undefined : "Enregistre d'abord la fiche : son visuel s'ajoute ensuite."}
                onPlace={placeVisual}
                onDescribed={(visual) => setSheet((current) => ({ ...current, visual }))}
              />
              <Text as="p" size="1" color="gray">
                Le fond de la page de l'événement, et son carré dans la liste. Une affiche en hauteur défile avec la page.
              </Text>
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
              {sheet.created && (
                <DataList.Root size="1" className="admin-facts">
                  <DataList.Item>
                    <DataList.Label minWidth="80px">Créé</DataList.Label>
                    <DataList.Value>{sheet.created}</DataList.Value>
                  </DataList.Item>
                  {sheet.updated && (
                    <DataList.Item>
                      <DataList.Label minWidth="80px">Modifié</DataList.Label>
                      <DataList.Value>{sheet.updated}</DataList.Value>
                    </DataList.Item>
                  )}
                  {page && (
                    <DataList.Item>
                      <DataList.Label minWidth="80px">Sur le site</DataList.Label>
                      <DataList.Value>
                        <Link href={page} target="_blank" rel="noopener" className="admin-break">
                          {page}
                        </Link>
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
