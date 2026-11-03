/**
 * Une liste de lignes à remplir dans l'ordre d'affichage, comme une tracklist : les liens d'un artiste (libellé et
 * adresse), et sur la page À propos les réseaux sociaux, l'équipe et les crédits (rôle, nom, lien). Une ligne se
 * déplace par sa poignée (ou par son menu : Monter, Descendre) et se retire par son menu ; une colonne d'adresse a son
 * bouton « Ouvrir ». Les lignes vides ne partent pas au serveur ; ses erreurs reviennent sur leurs lignes
 * (« links.0.url », placeErrors).
 */
import type { FieldErrors } from "@parabole/cms";
import { ArrowDownIcon, ArrowUpIcon, DotsHorizontalIcon, DragHandleDots2Icon, ExternalLinkIcon, PlusIcon, TrashIcon } from "@radix-ui/react-icons";
import { Badge, Button, DropdownMenu, IconButton, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { Section } from "./sheet";
import { useSortable } from "./sortable";

/** Une ligne : ses champs, et une clé qui la suit quand elle bouge (le champ où l'on tape reste en place). */
export type Row<K extends string> = Record<K, string> & { key: string };
/** Une colonne : son champ, son nom (dit aux lecteurs d'écran avec le numéro de la ligne), ce qu'elle montre vide. */
export type RowColumn<K extends string> = { field: K; label: string; placeholder: string; url?: boolean };

let counter = 0;
/** Une ligne, vide ou remplie de `values`, avec sa clé. */
export function newRow<K extends string>(fields: readonly K[], values: Partial<Record<K, string>> = {}): Row<K> {
  const row = { key: `r${++counter}` } as Row<K>;
  for (const field of fields) (row as Record<string, string>)[field] = values[field] ?? "";
  return row;
}

/** Une ligne remplie : les vides ne partent pas au serveur. */
export const filledRow = <K extends string>(row: Row<K>, fields: readonly K[]) => fields.some((field) => row[field].trim() !== "");

/** L'adresse à ouvrir pour une case d'adresse : une adresse web, ou une page du site (« /residents/… »). */
const openable = (text: string) => {
  const value = text.trim();
  return /^https?:\/\/\S+$/.test(value) || /^\/(?!\/)\S*$/.test(value) ? value : null;
};

/** Les classes des cases, pour les placer sur deux ou trois lignes sur téléphone (admin.css). */
const CELL_CLASSES = ["admin-link-label", "admin-link-middle"];

export function RowsEditor<K extends string>({
  title,
  name,
  hint,
  addLabel,
  rows,
  columns,
  errors,
  onChange,
}: {
  title: string;
  /** Le nom de la liste dans les erreurs du serveur : « links », « team »… */
  name: string;
  hint?: ReactNode;
  addLabel: string;
  rows: Row<K>[];
  columns: RowColumn<K>[];
  errors: FieldErrors;
  onChange(rows: Row<K>[]): void;
}) {
  const sortable = useSortable(rows, onChange);
  const fields = columns.map((column) => column.field);
  const update = (index: number, field: K, value: string) => onChange(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  const add = () => {
    onChange([...rows, newRow(fields)]);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-row="${name}-${rows.length}"]`)?.focus());
  };
  const urlColumn = columns.find((column) => column.url);
  return (
    <Section
      title={title}
      count={
        rows.length > 0 && (
          <Badge color="gray" radius="full">
            {rows.length}
          </Badge>
        )
      }
      aside={
        <Button type="button" variant="soft" onClick={add}>
          <PlusIcon /> {addLabel}
        </Button>
      }
    >
      {hint && (
        <Text as="p" size="2" color="gray" mb="2">
          {hint}
        </Text>
      )}
      {errors[name] && (
        <Text as="p" size="1" color="red" mb="2">
          {errors[name]}
        </Text>
      )}
      {rows.length > 0 && (
        <div className="admin-links" ref={(element) => void (sortable.container.current = element)}>
          {rows.map((row, index) => {
            const problems = fields.map((field) => errors[`${name}.${index}.${field}`]).filter(Boolean);
            const href = urlColumn ? openable(row[urlColumn.field]) : null;
            return (
              <div
                key={row.key}
                className="admin-link"
                data-columns={columns.length}
                data-sort-index={index}
                data-dragging={sortable.dragging === index || undefined}
                data-invalid={problems.length > 0 || undefined}
              >
                <span className="admin-grip" aria-hidden {...sortable.handle(index)}>
                  <DragHandleDots2Icon />
                </span>
                {columns.map((column, place) => (
                  <input
                    key={column.field}
                    className={`admin-cell ${column.url || place === columns.length - 1 ? "admin-link-url" : CELL_CLASSES[place]}`}
                    value={row[column.field]}
                    onChange={(e) => update(index, column.field, e.target.value)}
                    placeholder={column.placeholder}
                    aria-label={`${column.label} ${index + 1}`}
                    aria-invalid={errors[`${name}.${index}.${column.field}`] ? true : undefined}
                    data-row={place === 0 ? `${name}-${index}` : undefined}
                    autoComplete="off"
                    {...(column.url ? { inputMode: "url" as const, autoCapitalize: "off" } : {})}
                  />
                ))}
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
                    <IconButton type="button" size="1" variant="ghost" color="gray" aria-label={`Actions de la ligne ${index + 1}`}>
                      <DotsHorizontalIcon />
                    </IconButton>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end" size="1">
                    <DropdownMenu.Item disabled={index === 0} onSelect={() => sortable.move(index, index - 1)}>
                      <ArrowUpIcon /> Monter
                    </DropdownMenu.Item>
                    <DropdownMenu.Item disabled={index === rows.length - 1} onSelect={() => sortable.move(index, index + 1)}>
                      <ArrowDownIcon /> Descendre
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item color="red" onSelect={() => onChange(rows.filter((_, i) => i !== index))}>
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
