/**
 * Les étiquettes et les filtres du site (cms/README.md, « Les étiquettes et les filtres »). Un onglet par filtre
 * (Thème, Genre, Géographie, Activité, Catégorie…), dans l'ordre du site, et « À classer » pour les étiquettes sans
 * place. Dans un filtre, ses groupes dans l'ordre, chacun avec ses étiquettes en pastilles (et le nombre de contenus
 * qui les portent) et un champ pour en ajouter : un nom, ou une liste collée depuis le document des filtres
 * (« AFRO HOUSE, AFROBEATS, AMAPIANO »). Une pastille ouvre la fiche de l'étiquette : nom et adresse, places (en
 * ajouter, en retirer), contenus, fusion avec une autre, suppression. La recherche trouve une étiquette dans tous les
 * filtres. Chaque action répond par le classement à jour, que le routeur affiche ; changer d'onglet ne recharge rien.
 */
import { ENERGY, LABELS } from "@parabole/cms/labels";
import type { DocumentChanges, FieldErrors, KeptTag } from "@parabole/cms";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  Cross2Icon,
  DotsHorizontalIcon,
  ExclamationTriangleIcon,
  ExternalLinkIcon,
  FileTextIcon,
  InfoCircledIcon,
  MagnifyingGlassIcon,
  MixIcon,
  Pencil1Icon,
  PlusIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import {
  AlertDialog,
  Button,
  Callout,
  CheckboxGroup,
  Dialog,
  DropdownMenu,
  Flex,
  Heading,
  IconButton,
  RadioGroup,
  Select,
  Spinner,
  TabNav,
  Text,
  TextArea,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import { useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import { PageHeader } from "./AdminShell";
import { useRouter } from "./router";
import { Field, postForm } from "./sheet";
import { counted, normalize } from "./text";
import { useNotify } from "./toast";
import { TokenPicker } from "./TokenPicker";
import { isRubrique, MOOD_TAB, RUBRIQUES, facetsOf, rubriqueOf, SCOPE_OF_RUBRIQUE, showFacetGroups } from "./rubriques";
import { UNPLACED, type DocumentResponse, type FacetScope, type FacetView, type TagRow, type TagsData, type TagsResponse } from "./types";

const HREF = "/admin/etiquettes";
const TITLE = "Filtres";
const hrefOf = (current: string) => `${HREF}?filtre=${encodeURIComponent(current)}`;

/** Une place d'une étiquette : un filtre, et le groupe où elle est rangée (null : c'est un groupe du filtre). */
type Place = { facet: FacetView; group: TagRow | null };
type Act = (values: Record<string, string | string[]>, options?: { quiet?: boolean }) => Promise<TagsResponse>;

const firstError = (errors: FieldErrors) => errors.names ?? errors.name ?? errors.slug ?? errors.into ?? errors.form ?? Object.values(errors)[0] ?? "Le serveur a refusé.";

/** Ce que porte une étiquette dans un filtre de ce contenu : « 3 émissions », « 1 artiste ». */
const uses = (tag: TagRow, scope: FacetScope) => (scope === "show" ? tag.shows : scope === "artist" ? tag.artists : tag.events);
const USE_WORDS: Record<FacetScope, [string, string]> = { show: ["émission", "émissions"], artist: ["artiste", "artistes"], event: ["événement", "événements"] };
const usesText = (count: number, scope: FacetScope) => counted(count, ...USE_WORDS[scope]);
/** Tout ce que porte une étiquette, quel que soit le filtre. */
const allUses = (tag: TagRow) => tag.shows + tag.artists + tag.events;
function usesSummary(tag: TagRow): string {
  const parts = [tag.shows && usesText(tag.shows, "show"), tag.artists && usesText(tag.artists, "artist"), tag.events && usesText(tag.events, "event")].filter(Boolean);
  return parts.length ? `Sur ${parts.join(", ")}` : "Sur aucun contenu pour l'instant";
}

const PLURALS = { dj_set: "DJ sets", playlist: "playlists", podcast: "podcasts" } satisfies Record<FacetView["showTypes"][number], string>;

/** « Émissions · DJ sets et playlists », « Résidents », « Événements ». */
function scopeText(facet: FacetView): string {
  const types = facet.showTypes.map((type) => PLURALS[type]);
  if (facet.scope !== "show" || !types.length) return LABELS.facetScope[facet.scope];
  return `${LABELS.facetScope.show} · ${types.length > 1 ? `${types.slice(0, -1).join(", ")} et ${types.at(-1)}` : types[0]}`;
}

/** La place d'une étiquette, en mots : « Genre › Club », ou « Genre » pour un groupe. */
const placeText = (place: Place) => (place.group ? `${place.facet.name} › ${place.group.name}` : `${place.facet.name} (groupe)`);

// ---------------------------------------------------------------------------------------------------------------
// L'écran
// ---------------------------------------------------------------------------------------------------------------

export function TagsScreen({ facets, tags, current }: TagsData) {
  const router = useRouter();
  const notify = useNotify();
  const [query, setQuery] = useState("");
  const [openTag, setOpenTag] = useState<string | null>(null);
  const [facetForm, setFacetForm] = useState<FacetView | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; text: ReactNode; action: string; run(): Promise<unknown> } | null>(null);

  const byId = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const places = useMemo(() => {
    const found = new Map<string, Place[]>();
    const add = (tagId: string, place: Place) => found.set(tagId, [...(found.get(tagId) ?? []), place]);
    for (const facet of facets)
      for (const group of facet.groups) {
        add(group.tagId, { facet, group: null });
        for (const member of group.members) add(member, { facet, group: byId.get(group.tagId) ?? null });
      }
    return found;
  }, [facets, byId]);
  const unplaced = useMemo(() => tags.filter((tag) => !places.has(tag.id)), [tags, places]);
  const facet = facets.find((one) => one.slug === current) ?? null;
  const data: TagsData = { facets, tags, current };

  /** Le classement à jour : affiché tel quel, et oublié des écrans gardés en mémoire. */
  const show = (next: TagsData) => {
    router.invalidate();
    router.replace(hrefOf(next.current), { name: "tags", title: TITLE, data: next });
  };

  /** Une action : le classement à jour et son message, ou le refus. */
  const act: Act = async (values, { quiet = false } = {}) => {
    const body = new FormData();
    body.set("filtre", current);
    body.set("rubrique", rubriqueOf(data));
    for (const [name, value] of Object.entries(values)) for (const one of Array.isArray(value) ? value : [value]) body.append(name, one);
    const result = await postForm<TagsResponse>(HREF, body);
    if (result.ok) {
      show(result.data);
      if (result.message && !quiet) notify({ kind: "success", title: result.message, description: result.description });
    } else notify({ kind: "error", title: "Rien n'a changé", description: firstError(result.errors) });
    return result;
  };

  /** Changer d'onglet : tout est déjà là, l'adresse suit. */
  const select = (slug: string) => {
    router.replace(hrefOf(slug), { name: "tags", title: TITLE, data: { ...data, current: slug } });
    scrollTo({ top: 0 });
  };

  const searching = query.trim().length > 0;
  const context = { byId, places, act, open: setOpenTag, ask: setConfirm };
  const rubrique = rubriqueOf(data);
  const heading = RUBRIQUES.find((one) => one.slug === rubrique)!;
  const own = facetsOf(facets, rubrique);
  const placedIn = new Set(own.flatMap((one) => one.groups.flatMap((group) => [group.tagId, ...group.members])));
  const description =
    rubrique === UNPLACED
      ? unplaced.length
        ? `${counted(unplaced.length, "étiquette")} sans place dans les filtres`
        : "Tout est rangé"
      : `${counted(placedIn.size, "étiquette rangée", "étiquettes rangées")} dans ${counted(own.length, "filtre")}${unplaced.length ? ` · ${unplaced.length} à classer` : ""}`;
  const tab = (slug: string, label: ReactNode, count?: number) => (
    <TabNav.Link
      key={slug}
      href={hrefOf(slug)}
      active={slug === current}
      onClick={(event) => {
        event.preventDefault();
        select(slug);
      }}
    >
      {label}
      {count !== undefined && <span className="admin-tab-count">{count}</span>}
    </TabNav.Link>
  );
  const sizeOf = (one: FacetView) => one.groups.reduce((total, group) => total + 1 + group.members.length, 0);

  return (
    <div className="admin-page">
      <PageHeader
        title={heading.title}
        description={description}
        actions={
          <>
            <Button variant="soft" color="gray" onClick={() => setImporting(true)}>
              <FileTextIcon /> Importer le document
            </Button>
            {rubrique !== UNPLACED && (
              <Button variant="soft" onClick={() => setFacetForm("new")}>
                <PlusIcon /> Nouveau filtre
              </Button>
            )}
          </>
        }
      />

      <div className="admin-toolbar">
        <TextField.Root
          size="3"
          className="admin-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              setQuery("");
            }
          }}
          placeholder="Chercher une étiquette dans tous les filtres…"
          aria-label="Chercher une étiquette"
          autoComplete="off"
        >
          <TextField.Slot>
            <MagnifyingGlassIcon width="16" height="16" />
          </TextField.Slot>
          {query && (
            <TextField.Slot side="right">
              <IconButton size="1" variant="ghost" color="gray" onClick={() => setQuery("")} aria-label="Effacer la recherche">
                <Cross2Icon />
              </IconButton>
            </TextField.Slot>
          )}
        </TextField.Root>
      </div>

      {searching ? (
        <SearchResults query={query} tags={tags} {...context} />
      ) : (
        <>
          {rubrique === "emissions" ? (
            // Le schéma : « Podcast » (son thème), puis « Playlist + DJ sets » (genre, géographie, mood).
            <nav className="admin-subnav" aria-label="Filtres des émissions">
              {showFacetGroups(own).map((group) => (
                <div key={group.label} className="admin-subnav-group">
                  <Text as="div" size="1" weight="medium" color="gray" className="admin-subnav-label">
                    {group.label}
                  </Text>
                  <TabNav.Root className="admin-tabs">
                    {group.facets.map((one) => tab(one.slug, one.name, sizeOf(one)))}
                    {group.mood && tab(MOOD_TAB, "Mood")}
                  </TabNav.Root>
                </div>
              ))}
            </nav>
          ) : (
            own.length > 1 && <TabNav.Root className="admin-tabs" aria-label={heading.title}>{own.map((one) => tab(one.slug, one.name, sizeOf(one)))}</TabNav.Root>
          )}

          {facet ? (
            <FacetPanel
              key={facet.id}
              facet={facet}
              first={own[0]?.id === facet.id}
              last={own.at(-1)?.id === facet.id}
              onEdit={() => setFacetForm(facet)}
              {...context}
            />
          ) : current === MOOD_TAB ? (
            <MoodPanel />
          ) : current === UNPLACED ? (
            <UnplacedPanel tags={unplaced} {...context} />
          ) : (
            <Empty>Pas encore de filtre ici : crée le premier avec « Nouveau filtre ».</Empty>
          )}
        </>
      )}

      <TagDialog key={openTag ?? ""} tag={openTag ? (byId.get(openTag) ?? null) : null} facets={facets} tags={tags} onClose={() => setOpenTag(null)} {...context} />
      <FacetDialog
        key={facetForm === "new" ? `new-${rubrique}` : (facetForm?.id ?? "none")}
        facet={facetForm}
        scope={isRubrique(rubrique) ? SCOPE_OF_RUBRIQUE[rubrique] : "show"}
        onClose={() => setFacetForm(null)}
        act={act}
      />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
      {importing && <DocumentDialog onClose={() => setImporting(false)} act={act} />}
    </div>
  );
}

type Context = {
  byId: Map<string, TagRow>;
  places: Map<string, Place[]>;
  act: Act;
  open(id: string): void;
  ask(confirm: { title: string; text: ReactNode; action: string; run(): Promise<unknown> }): void;
};

// ---------------------------------------------------------------------------------------------------------------
// Un filtre
// ---------------------------------------------------------------------------------------------------------------

function FacetPanel({ facet, first, last, onEdit, ...context }: { facet: FacetView; first: boolean; last: boolean; onEdit(): void } & Context) {
  const { act, ask } = context;
  const tagsIn = facet.groups.reduce((total, group) => total + group.members.length, 0);
  return (
    <section className="admin-facet" aria-label={`Filtre ${facet.name}`}>
      <div className="admin-facet-head">
        <Flex direction="column" gap="1" minWidth="0">
          <Text size="2" weight="medium">
            {scopeText(facet)}
          </Text>
          {facet.description && (
            <Text as="p" size="2" color="gray">
              {facet.description}
            </Text>
          )}
          <Text as="p" size="1" color="gray">
            {counted(facet.groups.length, "groupe")}, {counted(tagsIn, "étiquette")} dans les groupes · adresse : <span className="admin-mono">{facet.slug}</span>
          </Text>
        </Flex>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <IconButton variant="soft" color="gray" aria-label={`Plus d'actions pour le filtre « ${facet.name} »`}>
              <DotsHorizontalIcon />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" size="2" className="admin-menu">
            <DropdownMenu.Item onSelect={onEdit}>
              <Pencil1Icon /> Modifier le filtre…
            </DropdownMenu.Item>
            <DropdownMenu.Item disabled={first} onSelect={() => void act({ intent: "facet-move", id: facet.id, direction: "up" })}>
              <ArrowLeftIcon /> Passer avant
            </DropdownMenu.Item>
            <DropdownMenu.Item disabled={last} onSelect={() => void act({ intent: "facet-move", id: facet.id, direction: "down" })}>
              <ArrowRightIcon /> Passer après
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              color="red"
              onSelect={() =>
                ask({
                  title: `Supprimer le filtre « ${facet.name} » ?`,
                  text: `Ses ${counted(facet.groups.length, "groupe")} et leurs places disparaissent. Les étiquettes restent sur leurs contenus ; celles qui n'ont pas d'autre place passent à classer.`,
                  action: "Supprimer le filtre",
                  run: () => act({ intent: "facet-delete", id: facet.id }),
                })
              }
            >
              <TrashIcon /> Supprimer le filtre…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>

      {facet.groups.length ? (
        <ol className="admin-groups">
          {facet.groups.map((group, index) => (
            <GroupCard key={group.tagId} facet={facet} group={group} first={index === 0} last={index === facet.groups.length - 1} {...context} />
          ))}
        </ol>
      ) : (
        <Empty>Ce filtre n'a pas encore de groupe. Ajoute le premier ci-dessous.</Empty>
      )}

      <div className="admin-new-group">
        <AddField
          label={`Nouveau groupe dans « ${facet.name} »`}
          placeholder={facet.groups.length ? "Nouveau groupe…" : "Premier groupe…"}
          hint="Un groupe se choisit lui-même sur une fiche, et vaut sur le site pour toutes ses étiquettes. Plusieurs d'un coup : sépare-les par des virgules."
          onAdd={(names) => act({ intent: "add", facetId: facet.id, groupId: "", names })}
        />
      </div>
    </section>
  );
}

function GroupCard({ facet, group, first, last, ...context }: { facet: FacetView; group: FacetView["groups"][number]; first: boolean; last: boolean } & Context) {
  const { byId, places, act, open, ask } = context;
  const head = byId.get(group.tagId);
  const [moving, setMoving] = useState(false);
  if (!head) return null;
  const titleId = `groupe-${facet.id}-${group.tagId}`;
  const move = async (direction: "up" | "down") => {
    setMoving(true);
    await act({ intent: "move-group", facetId: facet.id, id: group.tagId, direction }, { quiet: true });
    setMoving(false);
  };
  return (
    <li className="admin-group-card" aria-labelledby={titleId}>
      <div className="admin-group-head">
        <Heading as="h3" size="3" id={titleId} className="admin-group-title">
          <button
            type="button"
            className="admin-group-name"
            onClick={() => open(head.id)}
            aria-label={`${head.name}${uses(head, facet.scope) ? `, posé tel quel sur ${usesText(uses(head, facet.scope), facet.scope)}` : ""}`}
          >
            {head.name}
            {uses(head, facet.scope) > 0 && <span className="admin-chip-count">{uses(head, facet.scope)}</span>}
          </button>
        </Heading>
        <Text size="1" color="gray" className="admin-nowrap">
          {group.members.length ? counted(group.members.length, "étiquette") : "sans étiquette"}
        </Text>
        <Flex gap="1" align="center" ml="auto">
          {moving && <Spinner size="1" />}
          <Tooltip content="Monter">
            <IconButton size="1" variant="ghost" color="gray" disabled={first || moving} aria-label={`Monter « ${head.name} »`} onClick={() => void move("up")}>
              <ArrowUpIcon />
            </IconButton>
          </Tooltip>
          <Tooltip content="Descendre">
            <IconButton size="1" variant="ghost" color="gray" disabled={last || moving} aria-label={`Descendre « ${head.name} »`} onClick={() => void move("down")}>
              <ArrowDownIcon />
            </IconButton>
          </Tooltip>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton size="1" variant="ghost" color="gray" aria-label={`Plus d'actions pour « ${head.name} »`}>
                <DotsHorizontalIcon />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" size="2" className="admin-menu">
              <DropdownMenu.Item onSelect={() => open(head.id)}>
                <Pencil1Icon /> Modifier le groupe…
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                color="red"
                onSelect={() =>
                  ask({
                    title: `Retirer « ${head.name} » de « ${facet.name} » ?`,
                    text: group.members.length
                      ? `Ses ${counted(group.members.length, "étiquette")} quittent ce groupe ; celles qui n'ont pas d'autre place passent à classer. Toutes restent sur leurs contenus.`
                      : "Le groupe quitte ce filtre et reste sur ses contenus.",
                    action: "Retirer du filtre",
                    run: () => act({ intent: "unplace", id: head.id, facetId: facet.id, groupId: "" }),
                  })
                }
              >
                <Cross2Icon /> Retirer du filtre…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Flex>
      </div>
      <div className="admin-chips">
        {group.members.map((id) => {
          const tag = byId.get(id);
          if (!tag) return null;
          const elsewhere = (places.get(id) ?? []).filter((place) => !(place.facet.id === facet.id && place.group?.id === group.tagId));
          return <TagChip key={id} tag={tag} count={uses(tag, facet.scope)} scope={facet.scope} elsewhere={elsewhere} onOpen={() => open(id)} />;
        })}
        <AddField
          compact
          label={`Ajouter à « ${head.name} »`}
          placeholder={group.members.length ? "Ajouter…" : "Ajouter des étiquettes…"}
          wide={!group.members.length}
          onAdd={(names) => act({ intent: "add", facetId: facet.id, groupId: group.tagId, names })}
        />
      </div>
    </li>
  );
}

/** Une étiquette en pastille : son nom, le nombre de contenus qui la portent, et un signe si elle a d'autres places. */
function TagChip({ tag, count, scope, elsewhere = [], onOpen }: { tag: TagRow; count: number; scope: FacetScope; elsewhere?: Place[]; onOpen(): void }) {
  const also = elsewhere.length ? `Aussi dans ${elsewhere.map(placeText).join(", ")}` : "";
  return (
    <button
      type="button"
      className="admin-chip"
      data-unused={count === 0 || undefined}
      onClick={onOpen}
      title={also || undefined}
      aria-label={`${tag.name}, ${usesText(count, scope)}${also ? `. ${also}` : ""}`}
    >
      {tag.name}
      {count > 0 && <span className="admin-chip-count">{count}</span>}
      {elsewhere.length > 0 && <span className="admin-chip-more">+{elsewhere.length}</span>}
    </button>
  );
}

/**
 * Un champ pour ajouter une étiquette, ou une liste collée : Entrée ajoute. Une liste copiée sur plusieurs lignes
 * garde ses séparations (chaque ligne devient une étiquette).
 */
function AddField({
  label,
  placeholder,
  hint,
  compact = false,
  wide = false,
  onAdd,
}: {
  label: string;
  placeholder: string;
  hint?: string;
  compact?: boolean;
  /** Le champ seul dans un groupe vide : plus large, pour lire son invite. */
  wide?: boolean;
  onAdd(names: string): Promise<TagsResponse>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    const result = await onAdd(value);
    setBusy(false);
    if (result.ok) setValue("");
    requestAnimationFrame(() => field.current?.focus());
  };
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (!/[\r\n]/.test(text)) return;
    event.preventDefault();
    const joined = text
      .split(/[\r\n]+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(", ");
    setValue((before) => (before.trim() ? `${before.trim().replace(/,$/, "")}, ${joined}` : joined));
  };
  const input = (
    <input
      ref={field}
      className={compact ? "admin-chip-input" : "admin-add-input"}
      data-wide={wide || undefined}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      autoComplete="off"
      readOnly={busy}
      onChange={(event) => setValue(event.target.value)}
      onPaste={paste}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          void submit();
        } else if (event.key === "Escape" && value) {
          event.preventDefault();
          setValue("");
        }
      }}
    />
  );
  if (compact)
    return (
      <span className="admin-chip-add" data-busy={busy || undefined}>
        {busy ? <Spinner size="1" /> : <PlusIcon aria-hidden />}
        {input}
      </span>
    );
  return (
    <Flex direction="column" gap="1">
      <Flex gap="2" align="center" className="admin-add">
        <span className="admin-add-field">
          <PlusIcon aria-hidden />
          {input}
        </span>
        <Button variant="soft" loading={busy} disabled={!value.trim()} onClick={() => void submit()}>
          Ajouter
        </Button>
      </Flex>
      {hint && (
        <Text size="1" color="gray">
          {hint}
        </Text>
      )}
    </Flex>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// À classer, et la recherche
// ---------------------------------------------------------------------------------------------------------------

/**
 * Le mood, rangé avec les filtres des playlists et des DJ sets comme dans le document des filtres : ce n'est pas une
 * liste d'étiquettes, mais une échelle que chaque fiche règle, et que le site propose dans TRIER PAR.
 */
function MoodPanel() {
  const steps = Array.from({ length: ENERGY.max - ENERGY.min + 1 }, (_, index) => ENERGY.min + index);
  return (
    <section className="admin-facet" aria-label="Mood">
      <div className="admin-facet-head">
        <Flex direction="column" gap="1" minWidth="0">
          <Text size="2" weight="medium">
            {LABELS.facetScope.show} · Playlists et DJ sets
          </Text>
          <Text as="p" size="2" color="gray">
            Le mood n'est pas une liste d'étiquettes : chaque playlist et chaque DJ set le règle sur sa fiche, de {LABELS.energy.low.toLowerCase()} à{" "}
            {LABELS.energy.high.toLowerCase()}, en {steps.length} crans. Sur le site, il se choisit dans « Trier par › Mood ». Les podcasts n'en ont pas.
          </Text>
        </Flex>
      </div>
      <Flex align="center" gap="3" wrap="wrap" className="admin-mood-scale" aria-hidden>
        <Text size="2" color="gray">
          {LABELS.energy.low}
        </Text>
        {steps.map((step) => (
          <span key={step} className="admin-mood-step">
            {step}
          </span>
        ))}
        <Text size="2" color="gray">
          {LABELS.energy.high}
        </Text>
      </Flex>
    </section>
  );
}

function UnplacedPanel({ tags, ...context }: { tags: TagRow[] } & Context) {
  const { act, open, ask } = context;
  const unused = tags.filter((tag) => allUses(tag) === 0).length;
  return (
    <section className="admin-facet" aria-label="Étiquettes à classer">
      <Callout.Root color="gray" variant="surface" size="1" mb="4">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Callout.Text>
          Une étiquette à classer n'a de place dans aucun filtre : créée depuis la fiche d'une émission, ou retirée de ses groupes. Elle reste sur ses contenus, mais le
          site ne la propose dans aucun menu. Clique dessus pour la ranger dans un groupe, la fusionner avec une autre ou la supprimer.
        </Callout.Text>
      </Callout.Root>
      {tags.length ? (
        <>
          <div className="admin-chips admin-chips-loose">
            {tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="admin-chip"
                data-unused={allUses(tag) === 0 || undefined}
                onClick={() => open(tag.id)}
                aria-label={`${tag.name}, ${usesSummary(tag).toLowerCase()}`}
              >
                {tag.name}
                {allUses(tag) > 0 && <span className="admin-chip-count">{allUses(tag)}</span>}
              </button>
            ))}
          </div>
          {unused > 0 && (
            <Button
              mt="5"
              variant="soft"
              color="red"
              onClick={() =>
                ask({
                  title: unused > 1 ? `Supprimer les ${unused} étiquettes qui ne servent à rien ?` : "Supprimer l'étiquette qui ne sert à rien ?",
                  text: "Seulement celles à classer qui ne sont posées sur aucune émission, aucun artiste, aucun événement.",
                  action: "Supprimer",
                  run: () => act({ intent: "delete-unused" }),
                })
              }
            >
              <TrashIcon /> Supprimer {unused > 1 ? `les ${unused} qui ne servent à rien` : "celle qui ne sert à rien"}…
            </Button>
          )}
        </>
      ) : (
        <Empty>Tout est rangé : chaque étiquette a sa place dans un filtre.</Empty>
      )}
    </section>
  );
}

const SEARCH_LIMIT = 60;

function SearchResults({ query, tags, ...context }: { query: string; tags: TagRow[] } & Context) {
  const { places, open } = context;
  const wanted = normalize(query);
  const found = tags.filter((tag) => normalize(tag.name).includes(wanted) || tag.slug.includes(wanted.replace(/\s+/g, "-")));
  // Les noms qui commencent par la recherche d'abord.
  found.sort((a, b) => Number(!normalize(a.name).startsWith(wanted)) - Number(!normalize(b.name).startsWith(wanted)));
  if (!found.length) return <Empty>Aucune étiquette ne correspond à « {query.trim()} ».</Empty>;
  return (
    <>
      <Text as="p" size="2" color="gray" mb="2">
        {counted(found.length, "étiquette")}
        {found.length > SEARCH_LIMIT ? ` : les ${SEARCH_LIMIT} premières` : ""}
      </Text>
      <ul className="admin-rows admin-tag-results">
        {found.slice(0, SEARCH_LIMIT).map((tag) => (
          <li key={tag.id}>
            <button type="button" className="admin-row-link admin-tag-result" onClick={() => open(tag.id)}>
              <span className="admin-row-main">
                <Text size="2" weight="medium">
                  {tag.name}
                </Text>
                <Text size="1" color="gray">
                  {(places.get(tag.id) ?? []).map(placeText).join(" · ") || "À classer"}
                </Text>
              </span>
              <Text size="1" color="gray" className="admin-nowrap">
                {usesSummary(tag).replace(/^Sur /, "")}
              </Text>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <Text as="p" size="2" color="gray" className="admin-tags-empty">
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// La fiche d'une étiquette
// ---------------------------------------------------------------------------------------------------------------

function TagDialog({ tag, facets, tags, onClose, ...context }: { tag: TagRow | null; facets: FacetView[]; tags: TagRow[]; onClose(): void } & Context) {
  const { places, act, ask, open } = context;
  const [name, setName] = useState(tag?.name ?? "");
  const [slug, setSlug] = useState(tag?.slug ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [target, setTarget] = useState<string[]>([]);
  // L'étiquette a disparu (fusionnée, supprimée) : la fiche n'a plus rien à montrer.
  if (!tag) return null;
  const mine = places.get(tag.id) ?? [];
  const changed = name.trim() !== tag.name || slug.trim() !== tag.slug;
  const others = tags.filter((other) => other.id !== tag.id).map((other) => ({ id: other.id, name: other.name, note: (places.get(other.id) ?? []).map(placeText).join(" · ") || "à classer" }));

  const run = async (key: string, values: Record<string, string>, after?: (ok: boolean) => void) => {
    setBusy(key);
    const result = await act(values);
    setBusy(null);
    if (!result.ok) setErrors(result.errors);
    else setErrors({});
    after?.(result.ok);
    return result.ok;
  };

  // Les places où la ranger encore : au premier niveau d'un filtre, ou dans un groupe (pas le sien, ni où elle est).
  const options = facets.flatMap((facet) => [
    ...(mine.some((place) => place.facet.id === facet.id && !place.group) ? [] : [{ value: `${facet.id}|`, label: `${facet.name} — nouveau groupe`, facet: facet.name }]),
    ...facet.groups
      .filter((group) => group.tagId !== tag.id && !mine.some((place) => place.facet.id === facet.id && place.group?.id === group.tagId))
      .map((group) => ({ value: `${facet.id}|${group.tagId}`, label: context.byId.get(group.tagId)?.name ?? "", facet: facet.name })),
  ]);
  const byFacet = [...new Set(options.map((option) => option.facet))].map((facetName) => ({ facetName, options: options.filter((option) => option.facet === facetName) }));
  const groupOf = (place: Place) => facets.find((facet) => facet.id === place.facet.id)?.groups.find((group) => group.tagId === tag.id);

  return (
    <Dialog.Root
      open
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onClose();
      }}
    >
      <Dialog.Content maxWidth="600px" className="admin-tag-dialog">
        <Dialog.Title size="5" mb="1">
          {tag.name}
        </Dialog.Title>
        <Dialog.Description size="2" color="gray">
          {usesSummary(tag)}
          {tag.shows > 0 && (
            <>
              {" · "}
              {/* Dans un nouvel onglet : on garde la fenêtre de l'étiquette (et « À classer ») ouverte ici. */}
              <a href={`/admin/shows?tag=${tag.id}`} target="_blank" rel="noopener" data-astro-prefetch="false">
                voir les émissions <ExternalLinkIcon aria-label="(nouvel onglet)" className="admin-inline-icon" />
              </a>
            </>
          )}
          {tag.artists > 0 && (
            <>
              {" · "}
              <a href={`/admin/artistes?tag=${tag.id}`} target="_blank" rel="noopener" data-astro-prefetch="false">
                voir les artistes <ExternalLinkIcon aria-label="(nouvel onglet)" className="admin-inline-icon" />
              </a>
            </>
          )}
        </Dialog.Description>

        <form
          className="admin-dialog-section"
          onSubmit={(event) => {
            event.preventDefault();
            if (changed) void run("rename", { intent: "rename", id: tag.id, name, slug });
          }}
        >
          <Flex gap="3" direction={{ initial: "column", sm: "row" }}>
            <Flex direction="column" flexGrow="1">
              <Field label="Nom" htmlFor="tag-name" error={errors.name}>
                <TextField.Root id="tag-name" value={name} onChange={(event) => setName(event.target.value)} color={errors.name ? "red" : undefined} autoComplete="off" />
              </Field>
            </Flex>
            <Flex direction="column" flexGrow="1">
              <Field label="Adresse" htmlFor="tag-slug" error={errors.slug}>
                <TextField.Root
                  id="tag-slug"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  className="admin-mono"
                  color={errors.slug ? "red" : undefined}
                  autoComplete="off"
                  autoCapitalize="off"
                />
              </Field>
            </Flex>
          </Flex>
          <Flex justify="between" align="center" gap="3" mt="2" wrap="wrap">
            <Text size="1" color="gray">
              L'adresse sert aux liens des filtres du site (« ?{mine[0]?.facet.slug ?? "genre"}={tag.slug} ») : la changer casse ceux déjà partagés.
            </Text>
            <Button type="submit" size="2" disabled={!changed} loading={busy === "rename"}>
              Enregistrer
            </Button>
          </Flex>
        </form>

        <section className="admin-dialog-section" aria-labelledby="tag-places">
          <Heading as="h3" size="2" id="tag-places" mb="2">
            Ses places
          </Heading>
          {mine.length ? (
            <ul className="admin-places">
              {mine.map((place) => {
                const members = place.group ? 0 : (groupOf(place)?.members.length ?? 0);
                const key = `${place.facet.id}|${place.group?.id ?? ""}`;
                const remove = () =>
                  void run(`unplace ${key}`, { intent: "unplace", id: tag.id, facetId: place.facet.id, groupId: place.group?.id ?? "" });
                return (
                  <li key={key} className="admin-place">
                    <span className="admin-place-name">
                      <Text size="2">{placeText(place)}</Text>
                      {members > 0 && (
                        <Text size="1" color="gray">
                          {counted(members, "étiquette")}
                        </Text>
                      )}
                    </span>
                    <Button
                      size="1"
                      variant="ghost"
                      color="gray"
                      loading={busy === `unplace ${key}`}
                      onClick={() =>
                        members
                          ? ask({
                              title: `Retirer « ${tag.name} » de « ${place.facet.name} » ?`,
                              text: `Ses ${counted(members, "étiquette")} quittent ce groupe ; celles qui n'ont pas d'autre place passent à classer.`,
                              action: "Retirer",
                              run: () => act({ intent: "unplace", id: tag.id, facetId: place.facet.id, groupId: "" }),
                            })
                          : remove()
                      }
                    >
                      Retirer
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Text as="p" size="2" color="gray">
              À classer : aucune place dans les filtres.
            </Text>
          )}
          {options.length > 0 && (
            <Flex mt="3" gap="2" align="center" wrap="wrap">
              <Select.Root
                value=""
                onValueChange={(value) => {
                  const [facetId = "", groupId = ""] = value.split("|");
                  void run("place", { intent: "place", id: tag.id, facetId, groupId });
                }}
                disabled={busy !== null}
              >
                <Select.Trigger variant="soft" placeholder="Ranger aussi dans…" aria-label="Ranger aussi dans un groupe" />
                <Select.Content position="popper" sideOffset={6}>
                  {byFacet.map((group, index) => (
                    <Select.Group key={group.facetName}>
                      {index > 0 && <Select.Separator />}
                      <Select.Label>{group.facetName}</Select.Label>
                      {group.options.map((option) => (
                        <Select.Item key={option.value} value={option.value}>
                          {option.label}
                        </Select.Item>
                      ))}
                    </Select.Group>
                  ))}
                </Select.Content>
              </Select.Root>
              {busy === "place" && <Spinner size="1" />}
            </Flex>
          )}
        </section>

        <section className="admin-dialog-section" aria-labelledby="tag-merge">
          <Heading as="h3" size="2" id="tag-merge" mb="1">
            Fusionner avec une autre
          </Heading>
          <Text as="p" size="1" color="gray" mb="2">
            Pour un doublon (« Wassalou » et « Wassoulou ») : ses contenus et ses places passent à l'autre, puis elle disparaît.
          </Text>
          <Flex gap="2" align="start" direction={{ initial: "column", sm: "row" }}>
            <Flex flexGrow="1" width="100%">
              <TokenPicker
                id="tag-merge-into"
                label="Fusionner dans"
                values={target}
                options={others}
                onChange={(values) => setTarget(values.slice(-1))}
                placeholder="Garder plutôt…"
                allowNew={false}
                error={errors.into}
              />
            </Flex>
            <Button
              variant="soft"
              disabled={!target.length || busy !== null}
              onClick={() => {
                const into = context.byId.get(target[0]!);
                if (!into) return;
                ask({
                  title: `Fusionner « ${tag.name} » dans « ${into.name} » ?`,
                  text: `« ${into.name} » reprend ${allUses(tag) ? `ses contenus (${usesSummary(tag).replace(/^Sur /, "")}) et ` : ""}ses places. « ${tag.name} » disparaît.`,
                  action: "Fusionner",
                  run: async () => {
                    const result = await act({ intent: "merge", id: tag.id, into: into.id });
                    if (result.ok) open(into.id);
                  },
                });
              }}
            >
              <MixIcon /> Fusionner
            </Button>
          </Flex>
          {errors.into && (
            <Text as="p" size="1" color="red" mt="1">
              {errors.into}
            </Text>
          )}
        </section>

        {errors.form && (
          <Callout.Root color="red" size="1" mt="3">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>{errors.form}</Callout.Text>
          </Callout.Root>
        )}

        <Flex justify="between" gap="3" mt="5" wrap="wrap">
          <Button
            variant="soft"
            color="red"
            disabled={busy !== null}
            onClick={() =>
              ask({
                title: `Supprimer « ${tag.name} » ?`,
                text: `Elle quitte ${mine.length ? counted(mine.length, "place") : "la base"}${allUses(tag) ? ` et ses contenus (${usesSummary(tag).replace(/^Sur /, "").toLowerCase()})` : ""}. Pour la garder sans la proposer, retire-la plutôt de ses places.`,
                action: "Supprimer",
                run: async () => {
                  const result = await act({ intent: "delete", id: tag.id });
                  if (result.ok) onClose();
                },
              })
            }
          >
            <TrashIcon /> Supprimer…
          </Button>
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={busy !== null}>
              Fermer
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Un filtre : le créer ou le modifier
// ---------------------------------------------------------------------------------------------------------------

const SHOW_TYPES = Object.entries(LABELS.showType) as [keyof typeof LABELS.showType, string][];

function FacetDialog({ facet, scope: newScope, onClose, act }: { facet: FacetView | "new" | null; scope: FacetScope; onClose(): void; act: Act }) {
  const editing = facet && facet !== "new" ? facet : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [slug, setSlug] = useState(editing?.slug ?? "");
  const [scope, setScope] = useState<FacetScope>(editing?.scope ?? newScope);
  const [showTypes, setShowTypes] = useState<string[]>(editing?.showTypes ?? []);
  const [description, setDescription] = useState(editing?.description ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  if (!facet) return null;

  const save = async () => {
    setBusy(true);
    const result = await act({ intent: "facet-save", id: editing?.id ?? "", name, slug, scope, showTypes, description });
    setBusy(false);
    if (result.ok) onClose();
    else setErrors(result.errors);
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onClose();
      }}
    >
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>{editing ? `Modifier « ${editing.name} »` : "Nouveau filtre"}</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          Un filtre du site range des étiquettes en groupes : le genre ou la géographie des DJ sets, l'activité des résidents…
        </Dialog.Description>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Flex direction="column" gap="4">
            <Field label="Nom" htmlFor="facet-name" error={errors.name}>
              <TextField.Root id="facet-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Langue" autoComplete="off" autoFocus />
            </Field>
            <Field label="Adresse" htmlFor="facet-slug" optional hint="Le nom du filtre dans les adresses du site (« ?genre=club »). Vide, elle est tirée du nom." error={errors.slug}>
              <TextField.Root id="facet-slug" value={slug} onChange={(event) => setSlug(event.target.value)} className="admin-mono" autoComplete="off" autoCapitalize="off" />
            </Field>
            <Field label="Ce qu'il range" hint={editing ? "Ne change plus après la création : ses étiquettes sont déjà posées sur ces contenus." : undefined} error={errors.scope}>
              <RadioGroup.Root value={scope} onValueChange={(value) => setScope(value as FacetScope)} disabled={Boolean(editing)} orientation="horizontal" className="admin-radios">
                {(Object.entries(LABELS.facetScope) as [FacetScope, string][]).map(([value, label]) => (
                  <RadioGroup.Item key={value} value={value}>
                    {label}
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            </Field>
            {scope === "show" && (
              <Field label="Pour quelles émissions" hint="Aucun coché : tous les types.">
                <CheckboxGroup.Root value={showTypes} onValueChange={setShowTypes} className="admin-radios">
                  {SHOW_TYPES.map(([value, label]) => (
                    <CheckboxGroup.Item key={value} value={value}>
                      {label}
                    </CheckboxGroup.Item>
                  ))}
                </CheckboxGroup.Root>
              </Field>
            )}
            <Field label="Description" htmlFor="facet-description" optional hint="Une aide pour l'équipe, montrée ici." error={errors.description}>
              <TextArea id="facet-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} />
            </Field>
          </Flex>
          {errors.form && (
            <Text as="p" size="2" color="red" mt="3" role="alert">
              {errors.form}
            </Text>
          )}
          <Flex gap="3" mt="5" justify="end">
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray" disabled={busy}>
                Annuler
              </Button>
            </Dialog.Close>
            <Button type="submit" loading={busy}>
              {editing ? "Enregistrer" : "Créer le filtre"}
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** Une confirmation avant ce qui ne se défait pas : supprimer, retirer, fusionner. */
function ConfirmDialog({ confirm, onClose }: { confirm: { title: string; text: ReactNode; action: string; run(): Promise<unknown> } | null; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog.Root
      open={confirm !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onClose();
      }}
    >
      <AlertDialog.Content maxWidth="480px">
        <AlertDialog.Title>{confirm?.title}</AlertDialog.Title>
        <AlertDialog.Description size="2">{confirm?.text}</AlertDialog.Description>
        <Flex gap="3" mt="5" justify="end" direction={{ initial: "column-reverse", sm: "row" }}>
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" disabled={busy}>
              Annuler
            </Button>
          </AlertDialog.Cancel>
          <Button
            color="red"
            loading={busy}
            onClick={async () => {
              if (!confirm) return;
              setBusy(true);
              await confirm.run();
              setBusy(false);
              onClose();
            }}
          >
            {confirm?.action}
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Importer le document des filtres
// ---------------------------------------------------------------------------------------------------------------

const KEEP = "garder";
const commaList = (names: string[]) => names.join(", ");

/**
 * Importer le document « Tags et filtres site web » (exporté de Google Docs en Markdown) : le choisir, voir tout ce
 * qui changera, puis l'appliquer. Rien ne change avant « Appliquer ». Une étiquette que le document ne nomme plus mais
 * qui est posée sur des contenus est gardée, à classer ; si le document lui donne un nouveau nom (« Detroit techno »
 * devient « Techno de Détroit »), on peut le lui donner, et elle garde ses contenus.
 */
function DocumentDialog({ onClose, act }: { onClose(): void; act: Act }) {
  const [markdown, setMarkdown] = useState("");
  const [fileName, setFileName] = useState("");
  const [changes, setChanges] = useState<DocumentChanges | null>(null);
  // Ce que dit le premier aperçu, sans renommage : les étiquettes qui sortent en servant, et les noms nouveaux.
  const [leaving, setLeaving] = useState<KeptTag[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState("");
  const picker = useRef<HTMLInputElement>(null);

  const renameList = (chosen: Record<string, string>) => JSON.stringify(Object.entries(chosen).filter(([, to]) => to).map(([id, to]) => ({ id, to })));

  const preview = async (text: string, chosen: Record<string, string>) => {
    const body = new FormData();
    body.set("intent", "document-preview");
    body.set("document", text);
    body.set("renames", renameList(chosen));
    const result = await postForm<DocumentResponse>(HREF, body);
    if (!result.ok) {
      setError(firstError(result.errors));
      return null;
    }
    setError("");
    return result.changes;
  };

  const start = async () => {
    setBusy("preview");
    const first = await preview(markdown, {});
    if (first) {
      // Le nom proposé pour chaque étiquette qui sort en servant, déjà choisi : il reste à le confirmer.
      const suggested = Object.fromEntries(first.kept.filter((one) => one.suggestion).map((one) => [one.id, one.suggestion!]));
      setLeaving(first.kept);
      setTargets(first.created);
      setRenames(suggested);
      setChanges(Object.keys(suggested).length ? ((await preview(markdown, suggested)) ?? first) : first);
    }
    setBusy(null);
  };

  const choose = async (id: string, to: string) => {
    const next = { ...renames, [id]: to };
    setRenames(next);
    setBusy("preview");
    const again = await preview(markdown, next);
    if (again) setChanges(again);
    setBusy(null);
  };

  const apply = async () => {
    setBusy("apply");
    const result = await act({ intent: "document-apply", document: markdown, renames: renameList(renames) });
    setBusy(null);
    if (result.ok) onClose();
    else setError(firstError(result.errors));
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setMarkdown(await file.text());
    setChanges(null);
    setError("");
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onClose();
      }}
    >
      <Dialog.Content maxWidth="720px" className="admin-document-dialog">
        <Dialog.Title>Importer le document des filtres</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          Le document « Tags et filtres site web », téléchargé depuis Google Docs au format Markdown (Fichier › Télécharger › Markdown). Tu verras tout ce qui
          change avant de l'appliquer.
        </Dialog.Description>

        {!changes ? (
          <Flex direction="column" gap="3" mt="4">
            <input ref={picker} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={(event) => void readFile(event.target.files?.[0])} />
            <div
              className="admin-drop"
              data-filled={markdown ? true : undefined}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void readFile(event.dataTransfer.files?.[0]);
              }}
            >
              <FileTextIcon width="22" height="22" aria-hidden />
              <Text size="2" weight="medium">
                {fileName || (markdown ? "Texte collé" : "Dépose le fichier ici")}
              </Text>
              <Button type="button" variant="soft" onClick={() => picker.current?.click()}>
                {fileName ? "Choisir un autre fichier" : "Choisir le fichier…"}
              </Button>
            </div>
            <Field label="Ou colle son texte" htmlFor="document-text">
              <TextArea
                id="document-text"
                rows={4}
                value={fileName ? "" : markdown}
                placeholder="# **TAGS ET FILTRES SITE WEB**…"
                onChange={(event) => {
                  setFileName("");
                  setMarkdown(event.target.value);
                }}
              />
            </Field>
          </Flex>
        ) : (
          <DocumentChangesView changes={changes} leaving={leaving} targets={targets} renames={renames} onRename={(id, to) => void choose(id, to)} disabled={busy !== null} />
        )}

        {error && (
          <Callout.Root color="red" size="1" mt="3">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}

        <Flex gap="3" mt="5" justify="end" align="center" wrap="wrap">
          {busy === "preview" && changes && <Spinner size="2" />}
          {changes ? (
            <>
              <Button type="button" variant="soft" color="gray" disabled={busy !== null} onClick={() => setChanges(null)}>
                Changer de document
              </Button>
              <Button type="button" loading={busy === "apply"} disabled={busy !== null || changes.unchanged} onClick={() => void apply()}>
                Appliquer
              </Button>
            </>
          ) : (
            <>
              <Dialog.Close>
                <Button type="button" variant="soft" color="gray" disabled={busy !== null}>
                  Annuler
                </Button>
              </Dialog.Close>
              <Button type="button" loading={busy === "preview"} disabled={!markdown.trim()} onClick={() => void start()}>
                Voir les changements
              </Button>
            </>
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** Tout ce que changera le document, filtre par filtre, puis les étiquettes créées, renommées, supprimées, gardées. */
function DocumentChangesView({
  changes,
  leaving,
  targets,
  renames,
  onRename,
  disabled,
}: {
  changes: DocumentChanges;
  leaving: KeptTag[];
  targets: string[];
  renames: Record<string, string>;
  onRename(id: string, to: string): void;
  disabled: boolean;
}) {
  const { described } = changes;
  return (
    <Flex direction="column" gap="4" mt="4" className="admin-document-changes">
      <Text size="2" color="gray">
        Le document décrit {commaList(described.facets)} : {counted(described.groups, "groupe")}, {counted(described.tags, "étiquette")}.
      </Text>
      {changes.unchanged && (
        <Callout.Root color="green" size="1">
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Callout.Text>Le classement suit déjà ce document : rien à changer.</Callout.Text>
        </Callout.Root>
      )}

      {changes.facets.map((facet) => (
        <section key={facet.name} className="admin-document-facet">
          <Heading as="h3" size="3" mb="2">
            {facet.name}
            {facet.created && " (nouveau filtre)"}
          </Heading>
          {facet.addedGroups.length > 0 && <Change sign="+" label="Groupes ajoutés" names={facet.addedGroups} />}
          {facet.removedGroups.length > 0 && <Change sign="−" label="Groupes retirés" names={facet.removedGroups} />}
          {facet.reordered && (
            <Text as="p" size="2" color="gray">
              L'ordre des groupes suit le document.
            </Text>
          )}
          {facet.groups.map((group) => (
            <div key={group.name} className="admin-document-group">
              <Text size="2" weight="medium">
                {group.name}
              </Text>
              {group.added.length > 0 && <Change sign="+" names={group.added} />}
              {group.removed.length > 0 && <Change sign="−" names={group.removed} />}
            </div>
          ))}
        </section>
      ))}

      {leaving.length > 0 && (
        <section className="admin-document-facet">
          <Heading as="h3" size="3" mb="1">
            Plus dans le document, mais posées sur des contenus
          </Heading>
          <Text as="p" size="2" color="gray" mb="2">
            Elles restent sur leurs contenus. Garde-les à classer, ou donne-leur un nom du document : elles le prennent et gardent leurs contenus.
          </Text>
          {leaving.map((one) => (
            <Flex key={one.id} align="center" gap="3" wrap="wrap" className="admin-document-kept">
              <Text size="2" weight="medium">
                {one.name}
              </Text>
              <Text size="1" color="gray">
                {[one.shows && counted(one.shows, "émission"), one.artists && counted(one.artists, "artiste"), one.events && counted(one.events, "événement")].filter(Boolean).join(", ")}
              </Text>
              <Select.Root value={renames[one.id] || KEEP} onValueChange={(value) => onRename(one.id, value === KEEP ? "" : value)} disabled={disabled}>
                <Select.Trigger variant="soft" aria-label={`Ce que devient « ${one.name} »`} />
                <Select.Content position="popper" sideOffset={6}>
                  <Select.Item value={KEEP}>La garder, à classer</Select.Item>
                  <Select.Separator />
                  {targets.map((name) => (
                    <Select.Item key={name} value={name}>
                      Devient « {name} »
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
          ))}
        </section>
      )}

      {changes.renamed.length > 0 && <Change sign="→" label={`Renommées (${changes.renamed.length})`} names={changes.renamed.map((one) => `${one.from} → ${one.to}`)} />}
      {changes.created.length > 0 && <Change sign="+" label={`Créées (${changes.created.length})`} names={changes.created} />}
      {changes.deleted.length > 0 && <Change sign="−" label={`Supprimées : elles ne servaient à rien (${changes.deleted.length})`} names={changes.deleted} />}
      {changes.problems.length > 0 && (
        <Callout.Root color="amber" size="1">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            Ce que l'import n'a pas su lire : {changes.problems.join(" ")}
          </Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  );
}

/**
 * Une ligne de l'aperçu : « + Groupes ajoutés : A · B ». Des points entre les noms, pas des virgules : d'anciens
 * groupes en portent (« Hip-hop, R'n'B »).
 */
function Change({ sign, label, names }: { sign: "+" | "−" | "→"; label?: string; names: string[] }) {
  return (
    <Text as="p" size="2" className="admin-document-change" data-sign={sign === "+" ? "add" : sign === "−" ? "remove" : "rename"}>
      <span className="admin-document-sign" aria-hidden>
        {sign}
      </span>
      <span>
        {label ? <strong>{label} : </strong> : <span className="admin-sr-only">{sign === "+" ? "Ajoutées : " : "Retirées : "}</span>}
        {names.join(" · ")}
      </span>
    </Text>
  );
}

