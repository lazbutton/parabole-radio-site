/**
 * La fiche d'un artiste (cms/README.md, 9.2) : à gauche nom, adresse, bio et liens (dans l'ordre) ; à droite la
 * publication, le rôle, la photo, ses shows. Même enregistrement que la fiche d'un show, sans quitter l'écran.
 */
import { LABELS } from "@parabole/cms/labels";
import type { ArtistForm, FieldErrors } from "@parabole/cms";
import { ArrowDownIcon, ArrowUpIcon, Cross2Icon, DragHandleDots2Icon, PlusIcon } from "@radix-ui/react-icons";
import { Button, Flex, Grid, IconButton, SegmentedControl, Text, TextField, Tooltip } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { PageHeader, StatusBadge } from "./AdminShell";
import { MarkdownEditor } from "./MarkdownEditor";
import { useBlocker, useRouter } from "./router";
import { Field, filledPlaces, FormError, MediaSlot, mergeSaved, placeErrors, postForm, PublishCard, SaveBar, Section, useSheetKeys, type Intent, type SaveIntent } from "./sheet";
import { useSortable } from "./sortable";
import { useNotify } from "./toast";
import type { ArtistEditorData, ArtistSheet, SaveResponse } from "./types";

type LinkRow = { label: string; url: string; key: string };
type EditorForm = Omit<ArtistForm, "links"> & { links: LinkRow[] };

let counter = 0;
const linkRow = (link: Partial<LinkRow> = {}): LinkRow => ({ label: "", url: "", ...link, key: `l${++counter}` });
const toEditor = (form: ArtistForm): EditorForm => ({ ...form, links: form.links.map((link) => linkRow(link)) });
/** Un lien rempli ; les vides ne partent pas au serveur. */
const filled = (link: LinkRow) => Boolean(link.label.trim() || link.url.trim());
const fingerprint = (form: EditorForm) => JSON.stringify({ ...form, links: form.links.filter(filled).map(({ key: _key, ...link }) => link) });

function formData(form: EditorForm, intent: Intent, version: string): FormData {
  const data = new FormData();
  data.set("intent", intent);
  data.set("version", version);
  for (const field of ["name", "slug", "role", "bio"] as const) data.set(field, form[field]);
  for (const link of form.links.filter(filled)) {
    data.append("linkLabel", link.label);
    data.append("linkUrl", link.url);
  }
  return data;
}

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
  const url = sheet.id ? `/admin/artistes/${sheet.id}` : "/admin/artistes/nouveau";

  /** Envoie la fiche ; vrai si elle est enregistrée. */
  async function save(intent: SaveIntent): Promise<boolean> {
    if (busy) return false;
    setBusy(intent);
    const sent = form;
    const result = await postForm<SaveResponse<ArtistSheet>>(url, formData(form, intent, sheet.version));
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

  async function remove() {
    setBusy("delete");
    const result = await postForm<SaveResponse<ArtistSheet>>(url, formData(form, "delete", sheet.version));
    if (result.ok && "redirect" in result) {
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
  const title = form.name.trim() || (sheet.id ? "Sans nom" : "Nouvel artiste");
  const linked = [sheet.shows.length && `${sheet.shows.length} show${sheet.shows.length > 1 ? "s" : ""}`, sheet.events && `${sheet.events} événement${sheet.events > 1 ? "s" : ""}`]
    .filter(Boolean)
    .join(" et ");

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save("save");
      }}
    >
      <PageHeader title={title} crumbs={[{ label: "Artistes", href: "/admin/artistes" }]} badge={sheet.id ? <StatusBadge status={sheet.status} /> : undefined} />
      <FormError message={errors.form} />
      <Grid columns={{ initial: "1", md: "minmax(0, 1fr) 340px" }} gap="5" align="start">
        <Flex direction="column" gap="5" minWidth="0">
          <Section title="Informations">
            <Field label="Nom" htmlFor="name" error={errors.name}>
              <TextField.Root id="name" size="3" value={form.name} onChange={(e) => set("name", e.target.value)} color={errors.name ? "red" : undefined} autoComplete="off" />
            </Field>
            <Field label="Adresse" htmlFor="slug" optional hint="Le bout d'adresse de sa page : minuscules, chiffres et tirets. Vide, il est tiré du nom." error={errors.slug}>
              <TextField.Root id="slug" value={form.slug} onChange={(e) => set("slug", e.target.value)} color={errors.slug ? "red" : undefined} autoComplete="off" autoCapitalize="off" />
            </Field>
            <MarkdownEditor label="Bio" value={form.bio} onChange={(value) => set("bio", value)} error={errors.bio} rows={10} />
          </Section>
          <LinksEditor links={form.links} onChange={(links) => set("links", links)} errors={errors} />
        </Flex>

        <Flex direction="column" gap="5" minWidth="0">
          <PublishCard
            status={sheet.status}
            created={sheet.created}
            updated={sheet.updated}
            deleteTitle={sheet.id ? `Supprimer « ${sheet.form.name} » ?` : undefined}
            deleteNote={`La fiche sera supprimée${linked ? `, et l'artiste retiré de ${linked}` : ""}.`}
            onDelete={remove}
            deleting={busy === "delete"}
          />
          <Section title="Rôle">
            <SegmentedControl.Root value={form.role} onValueChange={(value) => set("role", value)} aria-label="Rôle">
              {Object.entries(LABELS.artistRole).map(([value, label]) => (
                <SegmentedControl.Item key={value} value={value}>
                  {label}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl.Root>
            {errors.role && (
              <Text size="1" color="red">
                {errors.role}
              </Text>
            )}
          </Section>
          <Section title="Photo">
            <MediaSlot media={sheet.photo} />
          </Section>
          {sheet.id && (
            <Section title="Ses shows" aside={<Text size="2" color="gray">{sheet.shows.length || ""}</Text>}>
              {sheet.shows.length ? (
                <Flex direction="column" gap="1" className="admin-list">
                  {sheet.shows.map((show) => (
                    <a key={show.id} className="admin-list-item" href={`/admin/shows/${show.id}`} data-astro-prefetch="false">
                      <Flex direction="column" minWidth="0">
                        <Text size="2" weight="medium" className="admin-break">
                          {show.title}
                        </Text>
                        <Text size="1" color="gray">
                          {LABELS.showType[show.type]} · {show.date}
                        </Text>
                      </Flex>
                      <StatusBadge status={show.status} size="1" />
                    </a>
                  ))}
                </Flex>
              ) : (
                <Text size="2" color="gray">
                  Aucun show pour l'instant. On relie un artiste à un show depuis la fiche du show.
                </Text>
              )}
            </Section>
          )}
          {sheet.radiocultArtistId && (
            <Section title="Radio Cult">
              <Text size="2" className="admin-break">
                Identifiant {sheet.radiocultArtistId}
              </Text>
              <Text size="1" color="gray">
                Rempli par l'import de la programmation : il relie les créneaux Radio Cult à cette fiche.
              </Text>
            </Section>
          )}
        </Flex>
      </Grid>
      <SaveBar status={sheet.status} dirty={dirty} busy={busy} isNew={!sheet.id} onSave={(intent) => void save(intent)} />
    </form>
  );
}

/** Les liens d'un artiste, dans l'ordre d'affichage : libellé et adresse. */
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
      aside={
        <Button type="button" variant="soft" onClick={add}>
          <PlusIcon /> Ajouter un lien
        </Button>
      }
    >
      <Text size="2" color="gray">
        Dans l'ordre d'affichage. Sans libellé, le nom du site est repris (Instagram, SoundCloud…).
      </Text>
      {errors.links && (
        <Text size="1" color="red">
          {errors.links}
        </Text>
      )}
      {links.length > 0 && (
        <Flex direction="column" gap="2" ref={(element) => void (sortable.container.current = element)}>
          {links.map((link, index) => {
            const problems = [errors[`links.${index}.label`], errors[`links.${index}.url`]].filter(Boolean);
            return (
              <div key={link.key} className={sortable.dragging === index ? "admin-link admin-dragging" : "admin-link"} data-sort-index={index}>
                <span className="admin-grip" aria-hidden {...sortable.handle(index)}>
                  <DragHandleDots2Icon />
                </span>
                <TextField.Root
                  className="admin-link-label"
                  value={link.label}
                  onChange={(e) => update(index, "label", e.target.value)}
                  placeholder="Libellé"
                  aria-label={`Libellé du lien ${index + 1}`}
                  data-link={index}
                  autoComplete="off"
                />
                <TextField.Root
                  className="admin-link-url"
                  value={link.url}
                  onChange={(e) => update(index, "url", e.target.value)}
                  placeholder="https://…"
                  inputMode="url"
                  aria-label={`Adresse du lien ${index + 1}`}
                  color={errors[`links.${index}.url`] ? "red" : undefined}
                  autoComplete="off"
                  autoCapitalize="off"
                />
                <Flex gap="1" className="admin-link-actions">
                  <Tooltip content="Monter">
                    <IconButton type="button" size="1" variant="ghost" color="gray" disabled={index === 0} onClick={() => sortable.move(index, index - 1)} aria-label={`Monter le lien ${index + 1}`}>
                      <ArrowUpIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip content="Descendre">
                    <IconButton
                      type="button"
                      size="1"
                      variant="ghost"
                      color="gray"
                      disabled={index === links.length - 1}
                      onClick={() => sortable.move(index, index + 1)}
                      aria-label={`Descendre le lien ${index + 1}`}
                    >
                      <ArrowDownIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip content="Retirer">
                    <IconButton type="button" size="1" variant="ghost" color="red" onClick={() => onChange(links.filter((_, i) => i !== index))} aria-label={`Retirer le lien ${index + 1}`}>
                      <Cross2Icon />
                    </IconButton>
                  </Tooltip>
                </Flex>
                {problems.length > 0 && (
                  <Text size="1" color="red" className="admin-link-error">
                    {problems.join(" ")}
                  </Text>
                )}
              </div>
            );
          })}
        </Flex>
      )}
    </Section>
  );
}
