/**
 * Choisir les étiquettes d'une fiche dans un filtre du site (Genre, Géographie, Thème, Activité…), à la souris, sans
 * rien savoir par cœur. Trois façons de montrer un filtre, selon sa taille :
 *   - sans sous-groupes (Activité, Catégorie) : ses étiquettes en pastilles, à cocher d'un clic ;
 *   - petit (Thème) : chaque groupe sur sa ligne, suivi de ses étiquettes ;
 *   - grand (Genre, Géographie) : ses groupes en pastilles ; un clic sur un groupe ouvre ses étiquettes en dessous, avec
 *     « Tout le groupe » pour le choisir lui-même. Ce qui est choisi reste visible en haut, et une recherche trouve une
 *     étiquette dans tout le filtre.
 * Une pastille choisie se colore et porte une coche ; un groupe montre combien de ses étiquettes sont choisies.
 */
import { CheckIcon, ChevronDownIcon, Cross2Icon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { IconButton, Text, TextField } from "@radix-ui/themes";
import { useId, useState, type ReactNode } from "react";
import { counted, normalize } from "./text";
import type { FacetChoice } from "./types";

/** Au-delà de ce nombre d'étiquettes dans ses groupes, un filtre montre ses groupes fermés, à ouvrir un à un. */
const SHOW_ALL = 40;
/** Les résultats de la recherche montrés d'un coup. */
const RESULTS = 40;

type Props = {
  facet: FacetChoice;
  /** Le nom de chaque étiquette. */
  names: Map<string, string>;
  /** Les autres places d'une étiquette, en mots (« Géographie › Afrique / Moyen-Orient ») : l'aide au survol. */
  elsewhere(tagId: string, groupId: string | null): string[];
  /** Les étiquettes choisies sur la fiche, tous filtres confondus. */
  value: string[];
  onToggle(tagId: string): void;
};

export function FacetPicker({ facet, names, elsewhere, value, onToggle }: Props) {
  const chosen = new Set(value);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const panelId = useId();
  const name = (id: string) => names.get(id) ?? "?";
  const total = facet.groups.reduce((sum, group) => sum + group.members.length, 0);
  const flat = total === 0;
  const browse = total > SHOW_ALL;

  /** Une étiquette à cocher. `label` : un autre texte que son nom (« Tout « Club » »). */
  const choice = (id: string, groupId: string | null, { label, group = false, note }: { label?: ReactNode; group?: boolean; note?: string } = {}) => {
    const picked = chosen.has(id);
    const also = elsewhere(id, groupId);
    return (
      <button
        key={`${groupId ?? "groupe"}-${id}`}
        type="button"
        className="admin-choice"
        data-group={group || undefined}
        aria-pressed={picked}
        title={also.length ? `Compte aussi pour ${also.join(", ")}` : undefined}
        onClick={() => onToggle(id)}
      >
        {picked && <CheckIcon aria-hidden />}
        {label ?? name(id)}
        {note && <span className="admin-choice-note">{note}</span>}
      </button>
    );
  };

  if (flat) return <div className="admin-choices">{facet.groups.map((group) => choice(group.tagId, null))}</div>;

  if (!browse)
    return (
      <div className="admin-choice-lines">
        {facet.groups.map((group) => (
          <div key={group.tagId} className="admin-choices">
            {choice(group.tagId, null, { group: true })}
            {group.members.map((id) => choice(id, group.tagId))}
          </div>
        ))}
      </div>
    );

  // Un grand filtre : ce qui est choisi, la recherche, puis les groupes à ouvrir.
  const picked = [...new Set(facet.groups.flatMap((group) => [group.tagId, ...group.members]).filter((id) => chosen.has(id)))];
  const opened = facet.groups.find((group) => group.tagId === open && group.members.length);
  const typed = normalize(query);
  const found = typed
    ? facet.groups.flatMap((group) => [
        ...(normalize(name(group.tagId)).includes(typed) ? [{ id: group.tagId, groupId: null as string | null, note: undefined as string | undefined }] : []),
        ...group.members.filter((id) => normalize(name(id)).includes(typed)).map((id) => ({ id, groupId: group.tagId as string | null, note: name(group.tagId) })),
      ])
    : [];
  // Les noms qui commencent par la recherche d'abord ; une étiquette à deux places n'apparaît qu'une fois.
  const results = [...new Map(found.map((one) => [one.id, one])).values()].sort(
    (a, b) => Number(!normalize(name(a.id)).startsWith(typed)) - Number(!normalize(name(b.id)).startsWith(typed)),
  );

  return (
    <div className="admin-picker">
      {picked.length > 0 && (
        <div className="admin-picked" aria-label={`Choisi dans ${facet.name}`}>
          {picked.map((id) => (
            <span key={id} className="admin-picked-chip">
              {name(id)}
              <button type="button" className="admin-picked-remove" onClick={() => onToggle(id)} aria-label={`Retirer ${name(id)}`}>
                <Cross2Icon />
              </button>
            </span>
          ))}
        </div>
      )}

      <TextField.Root
        size="2"
        className="admin-picker-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query) {
            event.preventDefault();
            setQuery("");
          } else if (event.key === "Enter") {
            // Entrée coche le premier résultat, et n'envoie jamais la fiche depuis ce champ.
            event.preventDefault();
            if (results[0]) {
              onToggle(results[0].id);
              setQuery("");
            }
          }
        }}
        placeholder={`Chercher dans ${facet.name.toLowerCase()}…`}
        aria-label={`Chercher dans ${facet.name}`}
        autoComplete="off"
      >
        <TextField.Slot>
          <MagnifyingGlassIcon />
        </TextField.Slot>
        {query && (
          <TextField.Slot side="right">
            <IconButton type="button" size="1" variant="ghost" color="gray" onClick={() => setQuery("")} aria-label="Effacer la recherche">
              <Cross2Icon />
            </IconButton>
          </TextField.Slot>
        )}
      </TextField.Root>

      {typed ? (
        results.length ? (
          <div className="admin-choices">{results.slice(0, RESULTS).map((one) => choice(one.id, one.groupId, { note: one.note }))}</div>
        ) : (
          <Text as="p" size="2" color="gray">
            Rien ne correspond dans {facet.name.toLowerCase()}. Une étiquette absente s'ajoute dans Étiquettes, ou plus bas dans « Autres ».
          </Text>
        )
      ) : (
        <>
          <div className="admin-choices">
            {facet.groups.map((group) => {
              if (!group.members.length) return choice(group.tagId, null, { group: true });
              const count = group.members.filter((id) => chosen.has(id)).length;
              const isOpen = opened?.tagId === group.tagId;
              return (
                <button
                  key={group.tagId}
                  type="button"
                  className="admin-choice"
                  data-group
                  data-picked={chosen.has(group.tagId) || undefined}
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? panelId : undefined}
                  aria-label={`${name(group.tagId)}${chosen.has(group.tagId) ? ", choisi" : ""}${count ? `, ${counted(count, "étiquette choisie", "étiquettes choisies")}` : ""} : ${isOpen ? "fermer" : "ouvrir"}`}
                  onClick={() => setOpen(isOpen ? null : group.tagId)}
                >
                  {chosen.has(group.tagId) && <CheckIcon aria-hidden />}
                  {name(group.tagId)}
                  {count > 0 && <span className="admin-choice-count">{count}</span>}
                  <ChevronDownIcon aria-hidden className="admin-choice-chevron" />
                </button>
              );
            })}
          </div>
          {opened && (
            <div className="admin-choice-panel" id={panelId} role="group" aria-label={name(opened.tagId)}>
              <div className="admin-choice-panel-head">
                <Text size="2" weight="bold">
                  {name(opened.tagId)}
                </Text>
                <Text size="1" color="gray">
                  {counted(opened.members.length, "étiquette")}
                </Text>
                {choice(opened.tagId, null, { label: `Tout « ${name(opened.tagId)} »`, group: true })}
                <IconButton type="button" size="1" variant="ghost" color="gray" ml="auto" onClick={() => setOpen(null)} aria-label={`Fermer ${name(opened.tagId)}`}>
                  <Cross2Icon />
                </IconButton>
              </div>
              <div className="admin-choices">{opened.members.map((id) => choice(id, opened.tagId))}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
