/**
 * La tracklist d'un show, comme une feuille de calcul : un morceau par ligne (minutage, artiste, titre), des cases
 * qui ne se montrent qu'au survol ou quand on y écrit, le lien Hopper derrière une petite icône. Au clavier : Entrée
 * passe à la ligne suivante (et en crée une au bout), Alt+↑ ↓ déplace le morceau. À la souris ou au doigt, on glisse
 * la poignée ; le menu « … » de chaque ligne fait le reste. « Coller une tracklist » lit un texte collé et montre ce
 * qui sera ajouté, avant de l'ajouter.
 *
 * Radix Themes n'a pas de tableau éditable : les cases sont des champs simples, aux couleurs du thème.
 */
import { parseTracklist, type TrackLine } from "@parabole/cms/tracklist";
import { ArrowDownIcon, ArrowUpIcon, ClipboardIcon, DotsHorizontalIcon, DragHandleDots2Icon, ExclamationTriangleIcon, ExternalLinkIcon, Link2Icon, PlusIcon, TrashIcon } from "@radix-ui/react-icons";
import { Badge, Button, Callout, Dialog, DropdownMenu, Flex, IconButton, Popover, Table, Text, TextArea, TextField } from "@radix-ui/themes";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { FieldErrors } from "@parabole/cms";
import { Section } from "./sheet";
import { useSortable } from "./sortable";
import { counted } from "./text";

export type TrackRow = TrackLine & { key: string };

let counter = 0;
/** Une ligne de tableau, avec sa clé pour React. */
export const trackRow = (line: Partial<TrackLine> = {}): TrackRow => ({ artist: "", title: "", start: "", hopperUrl: "", ...line, key: `t${++counter}` });

/** Les cases écrites en ligne ; le lien Hopper a la sienne, derrière une icône. */
const CELLS = ["start", "artist", "title"] as const;
type Cell = (typeof CELLS)[number];
const FIELDS = [...CELLS, "hopperUrl"] as const;
const PLACEHOLDERS: Record<Cell, string> = { start: "0:00", artist: "Artiste", title: "Titre" };
const LABELS: Record<(typeof FIELDS)[number], string> = { start: "Minutage", artist: "Artiste", title: "Titre", hopperUrl: "Lien Hopper" };

const morceaux = (n: number) => counted(n, "morceau", "morceaux");

export function TracklistEditor({ rows, onChange, errors }: { rows: TrackRow[]; onChange(rows: TrackRow[]): void; errors: FieldErrors }) {
  const sortable = useSortable(rows, onChange);
  const [pasting, setPasting] = useState(false);
  const list = useRef<HTMLDivElement | null>(null);
  // La case où aller une fois la ligne ajoutée ou déplacée : posée après le rendu, quand elle existe.
  const nextFocus = useRef<{ index: number; field: Cell } | null>(null);

  const update = (index: number, field: (typeof FIELDS)[number], value: string) => onChange(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const cell = (index: number, field: Cell) => list.current?.querySelector<HTMLInputElement>(`[data-track="${index}"][data-field="${field}"]`);
  /** La case d'une ligne qui change (ajoutée, déplacée) : après le rendu, quand elle est à sa place. */
  const focusAfter = (index: number, field: Cell) => void (nextFocus.current = { index, field });
  useEffect(() => {
    const target = nextFocus.current;
    if (!target) return;
    nextFocus.current = null;
    cell(target.index, target.field)?.focus();
  });
  const add = (at = rows.length) => {
    onChange([...rows.slice(0, at), trackRow(), ...rows.slice(at)]);
    focusAfter(at, "start");
  };
  const move = (from: number, to: number, field?: Cell) => {
    if (to < 0 || to >= rows.length) return;
    sortable.move(from, to);
    if (field) focusAfter(to, field);
  };

  // Entrée : la même case, une ligne plus bas ; au bout du tableau, une ligne neuve. Alt+↑ ↓ : le morceau monte ou descend.
  const onKeyDown = (index: number, field: Cell) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      move(index, index + (event.key === "ArrowUp" ? -1 : 1), field);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (index < rows.length - 1) return void cell(index + 1, field)?.focus();
    onChange([...rows, trackRow()]);
    focusAfter(index + 1, field);
  };

  return (
    <Section
      title="Tracklist"
      count={
        rows.length > 0 && (
          <Badge color="gray" radius="full">
            {morceaux(rows.length)}
          </Badge>
        )
      }
      aside={
        rows.length > 0 && (
          <Flex gap="2">
            <Button type="button" variant="soft" color="gray" onClick={() => setPasting(true)}>
              <ClipboardIcon /> Coller une tracklist
            </Button>
            <Button type="button" variant="soft" onClick={() => add()} className="admin-hide-mobile">
              <PlusIcon /> Ajouter
            </Button>
          </Flex>
        )
      }
    >
      {errors.tracks && (
        <Text as="p" size="2" color="red" mb="2">
          {errors.tracks}
        </Text>
      )}
      {rows.length === 0 ? (
        <div className="admin-tracks-empty">
          <Text as="p" size="2" color="gray">
            Pas encore de morceau. Colle toute la tracklist d'un coup, telle que l'artiste l'a envoyée, ou ajoute les morceaux un par un.
          </Text>
          <Flex gap="2" wrap="wrap" justify="center">
            <Button type="button" variant="soft" onClick={() => setPasting(true)}>
              <ClipboardIcon /> Coller une tracklist
            </Button>
            <Button type="button" variant="soft" color="gray" onClick={() => add()}>
              <PlusIcon /> Ajouter un morceau
            </Button>
          </Flex>
        </div>
      ) : (
        <div
          className="admin-tracks"
          ref={(element) => {
            list.current = element;
            sortable.container.current = element;
          }}
        >
          <div className="admin-track admin-track-head" aria-hidden>
            <span />
            <span>#</span>
            {CELLS.map((field) => (
              <span key={field} className={`admin-track-${field}`}>
                {LABELS[field]}
              </span>
            ))}
            <span className="admin-track-hopper" title="Lien Hopper">
              <Link2Icon />
            </span>
            <span />
          </div>
          {rows.map((row, index) => {
            const problems = FIELDS.map((field) => errors[`tracks.${index}.${field}`]).filter(Boolean);
            return (
              <div key={row.key} className="admin-track" data-sort-index={index} data-dragging={sortable.dragging === index || undefined} data-invalid={problems.length > 0 || undefined}>
                <span className="admin-grip" aria-hidden {...sortable.handle(index)}>
                  <DragHandleDots2Icon />
                </span>
                <span className="admin-track-number">{index + 1}</span>
                {CELLS.map((field) => (
                  <input
                    key={field}
                    className={`admin-cell admin-track-${field}`}
                    value={row[field]}
                    placeholder={PLACEHOLDERS[field]}
                    aria-label={`${LABELS[field]}, morceau ${index + 1}`}
                    aria-invalid={errors[`tracks.${index}.${field}`] ? true : undefined}
                    inputMode={field === "start" ? "numeric" : undefined}
                    autoComplete="off"
                    spellCheck={field === "start" ? false : undefined}
                    data-track={index}
                    data-field={field}
                    onChange={(event) => update(index, field, event.target.value)}
                    onKeyDown={onKeyDown(index, field)}
                  />
                ))}
                <HopperLink index={index} value={row.hopperUrl} error={errors[`tracks.${index}.hopperUrl`]} onChange={(value) => update(index, "hopperUrl", value)} />
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    <IconButton type="button" size="1" variant="ghost" color="gray" className="admin-track-menu" aria-label={`Actions du morceau ${index + 1}`}>
                      <DotsHorizontalIcon />
                    </IconButton>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end" size="1">
                    <DropdownMenu.Item disabled={index === 0} shortcut="⌥ ↑" onSelect={() => move(index, index - 1)}>
                      <ArrowUpIcon /> Monter
                    </DropdownMenu.Item>
                    <DropdownMenu.Item disabled={index === rows.length - 1} shortcut="⌥ ↓" onSelect={() => move(index, index + 1)}>
                      <ArrowDownIcon /> Descendre
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={() => add(index + 1)}>
                      <PlusIcon /> Insérer un morceau dessous
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item color="red" onSelect={() => remove(index)}>
                      <TrashIcon /> Retirer
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
                {problems.length > 0 && (
                  <Text size="1" color="red" className="admin-track-error">
                    {problems.join(" ")}
                  </Text>
                )}
              </div>
            );
          })}
          <button type="button" className="admin-track-add" onClick={() => add()}>
            <PlusIcon aria-hidden /> Ajouter un morceau
          </button>
        </div>
      )}
      {rows.length > 0 && (
        <Text as="p" size="1" color="gray" mt="2" className="admin-hide-mobile">
          Entrée : ligne suivante · Alt+↑ ↓ : déplacer le morceau · la poignée ⋮⋮ se glisse.
        </Text>
      )}
      <PasteDialog
        open={pasting}
        onOpenChange={setPasting}
        hasRows={rows.length > 0}
        onAdd={(lines, replace) => {
          const kept = replace ? [] : rows.filter((row) => FIELDS.some((field) => row[field].trim()));
          onChange([...kept, ...lines.map((line) => trackRow(line))]);
          setPasting(false);
        }}
      />
    </Section>
  );
}

/** Le lien Hopper d'un morceau : une icône, pleine quand le lien est là ; un clic ouvre son champ. */
function HopperLink({ index, value, error, onChange }: { index: number; value: string; error?: string; onChange(value: string): void }) {
  const filled = Boolean(value.trim());
  return (
    <Popover.Root>
      <Popover.Trigger>
        <IconButton
          type="button"
          size="1"
          variant={filled ? "soft" : "ghost"}
          color={error ? "red" : filled ? undefined : "gray"}
          className="admin-track-hopper"
          data-filled={filled || undefined}
          aria-label={`Lien Hopper du morceau ${index + 1} : ${filled ? value : "aucun"}`}
        >
          <Link2Icon />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content size="1" width="360px" maxWidth="calc(100vw - 32px)" align="end">
        <Flex direction="column" gap="2">
          <Text as="label" size="2" weight="medium" htmlFor={`hopper-${index}`}>
            Lien Hopper du morceau {index + 1}
          </Text>
          <TextField.Root
            id={`hopper-${index}`}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              // Entrée valide le lien sans envoyer la fiche.
              if (event.key === "Enter") event.preventDefault();
            }}
            placeholder="https://hppr.fr/…"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            color={error ? "red" : undefined}
          />
          {error ? (
            <Text size="1" color="red">
              {error}
            </Text>
          ) : (
            <Text size="1" color="gray">
              La page du morceau sur Hopper, pour l'écouter ou l'acheter.
            </Text>
          )}
          <Flex gap="2" justify="end">
            {filled && (
              <>
                <Button type="button" size="1" variant="ghost" color="red" onClick={() => onChange("")}>
                  Retirer
                </Button>
                <Button type="button" size="1" variant="soft" color="gray" asChild>
                  <a href={value} target="_blank" rel="noopener noreferrer">
                    Ouvrir <ExternalLinkIcon />
                  </a>
                </Button>
              </>
            )}
            <Popover.Close>
              <Button type="button" size="1">
                OK
              </Button>
            </Popover.Close>
          </Flex>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}

/** Le dialogue « Coller une tracklist » : le texte, ce qui en est lu, puis Ajouter (à la fin) ou Remplacer. */
function PasteDialog({ open, onOpenChange, hasRows, onAdd }: { open: boolean; onOpenChange(open: boolean): void; hasRows: boolean; onAdd(lines: TrackLine[], replace: boolean): void }) {
  const [text, setText] = useState("");
  const lines = parseTracklist(text);
  const incomplete = lines.filter((line) => !line.artist || !line.title).length;
  const finish = (replace: boolean) => {
    onAdd(lines, replace);
    setText("");
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="760px">
        <Dialog.Title>Coller une tracklist</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          Une ligne par morceau : le minutage (m:ss ou h:mm:ss, facultatif), l'artiste, un tiret, le titre. Les numéros, les crochets, les liens
          Hopper et les colonnes copiées d'un tableur sont reconnus.
        </Dialog.Description>
        <TextArea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          autoFocus
          placeholder={"0:00 Artiste – Titre\n12:30 Artiste – Titre\n1:02:15 Artiste – Titre"}
          className="admin-mono"
          aria-label="Tracklist en texte"
        />
        {lines.length > 0 && (
          <Flex direction="column" gap="2" mt="4">
            <Text size="2" weight="medium">
              {morceaux(lines.length)} reconnu{lines.length > 1 ? "s" : ""}
            </Text>
            {incomplete > 0 && (
              <Callout.Root color="amber" size="1">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  {incomplete} ligne{incomplete > 1 ? "s" : ""} sans artiste ou sans titre : à compléter après l'ajout.
                </Callout.Text>
              </Callout.Root>
            )}
            <div className="admin-paste-preview">
              <Table.Root size="1" variant="surface">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Minutage</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Artiste</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Titre</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>Hopper</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {lines.map((line, index) => (
                    <Table.Row key={index}>
                      <Table.Cell className="admin-mono">{line.start || "—"}</Table.Cell>
                      <Table.Cell>{line.artist || <Text color="amber">manque</Text>}</Table.Cell>
                      <Table.Cell>{line.title || <Text color="amber">manque</Text>}</Table.Cell>
                      <Table.Cell>{line.hopperUrl ? "✓" : ""}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </div>
          </Flex>
        )}
        <Flex gap="3" mt="4" justify="end" wrap="wrap">
          <Dialog.Close>
            <Button type="button" variant="soft" color="gray">
              Annuler
            </Button>
          </Dialog.Close>
          {hasRows && (
            <Button type="button" variant="soft" color="red" disabled={!lines.length} onClick={() => finish(true)}>
              Remplacer la tracklist
            </Button>
          )}
          <Button type="button" disabled={!lines.length} onClick={() => finish(false)}>
            {lines.length ? `Ajouter ${morceaux(lines.length)}` : "Ajouter"}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
