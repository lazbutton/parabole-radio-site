/**
 * La tracklist d'un show : un tableau à remplir (minutage, artiste, titre, lien Hopper), un morceau par ligne, dans
 * l'ordre. Entrée passe à la ligne suivante (et en crée une au bout) ; on réordonne au glisser ou avec ↑ ↓. « Coller
 * une tracklist » ouvre un dialogue qui lit le texte collé et montre ce qui sera ajouté, avant de l'ajouter.
 */
import { parseTracklist, type TrackLine } from "@parabole/cms/tracklist";
import { ArrowDownIcon, ArrowUpIcon, ClipboardIcon, Cross2Icon, DragHandleDots2Icon, ExclamationTriangleIcon, PlusIcon } from "@radix-ui/react-icons";
import { Badge, Button, Callout, Card, Dialog, Flex, Heading, IconButton, Table, Text, TextArea, TextField, Tooltip } from "@radix-ui/themes";
import { useState, type KeyboardEvent } from "react";
import type { FieldErrors } from "@parabole/cms";
import { useSortable } from "./sortable";

export type TrackRow = TrackLine & { key: string };

let counter = 0;
/** Une ligne de tableau, avec sa clé pour React. */
export const trackRow = (line: Partial<TrackLine> = {}): TrackRow => ({ artist: "", title: "", start: "", hopperUrl: "", ...line, key: `t${++counter}` });

const FIELDS = ["start", "artist", "title", "hopperUrl"] as const;
type Field = (typeof FIELDS)[number];
const PLACEHOLDERS: Record<Field, string> = { start: "0:00", artist: "Artiste", title: "Titre", hopperUrl: "https://hppr.fr/…" };
const LABELS: Record<Field, string> = { start: "Minutage", artist: "Artiste", title: "Titre", hopperUrl: "Lien Hopper" };

const counted = (n: number) => `${n} ${n > 1 ? "morceaux" : "morceau"}`;

export function TracklistEditor({ rows, onChange, errors }: { rows: TrackRow[]; onChange(rows: TrackRow[]): void; errors: FieldErrors }) {
  const sortable = useSortable(rows, onChange);
  const [pasting, setPasting] = useState(false);

  const update = (index: number, field: Field, value: string) => onChange(rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const focusCell = (index: number, field: Field) =>
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-track="${index}"][data-field="${field}"]`)?.focus());
  const add = () => {
    onChange([...rows, trackRow()]);
    focusCell(rows.length, "start");
  };

  // Entrée : la même case, une ligne plus bas ; au bout du tableau, une ligne neuve.
  const onKeyDown = (index: number, field: Field) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (index === rows.length - 1) onChange([...rows, trackRow()]);
    focusCell(index + 1, field);
  };

  return (
    <Card size="2" className="admin-card">
      <Flex justify="between" align="center" gap="3" wrap="wrap" mb="3">
        <Flex align="center" gap="2">
          <Heading as="h2" size="3">
            Tracklist
          </Heading>
          {rows.length > 0 && (
            <Badge color="gray" radius="full">
              {counted(rows.length)}
            </Badge>
          )}
        </Flex>
        <Flex gap="2">
          <Button type="button" variant="soft" color="gray" onClick={() => setPasting(true)}>
            <ClipboardIcon /> Coller une tracklist
          </Button>
          <Button type="button" variant="soft" onClick={add}>
            <PlusIcon /> Ajouter un morceau
          </Button>
        </Flex>
      </Flex>
      {errors.tracks && (
        <Text as="p" size="2" color="red" mb="2">
          {errors.tracks}
        </Text>
      )}
      {rows.length === 0 ? (
        <Flex direction="column" align="center" gap="2" py="6" className="admin-empty">
          <Text size="2" color="gray">
            Pas encore de morceau.
          </Text>
          <Text size="2" color="gray">
            Ajoute-les un par un, ou colle toute la tracklist d'un coup.
          </Text>
        </Flex>
      ) : (
        <div className="admin-tracks" ref={(element) => void (sortable.container.current = element)}>
          <div className="admin-track admin-track-head" aria-hidden>
            <span />
            <span />
            {FIELDS.map((field) => (
              <Text key={field} size="1" color="gray" weight="medium">
                {LABELS[field]}
              </Text>
            ))}
            <span />
          </div>
          {rows.map((row, index) => {
            const problems = FIELDS.map((field) => errors[`tracks.${index}.${field}`]).filter(Boolean);
            return (
              <div key={row.key} className={sortable.dragging === index ? "admin-track admin-dragging" : "admin-track"} data-sort-index={index}>
                <span className="admin-grip" aria-hidden {...sortable.handle(index)}>
                  <DragHandleDots2Icon />
                </span>
                <Text size="1" color="gray" className="admin-track-number">
                  {index + 1}
                </Text>
                {FIELDS.map((field) => (
                  <TextField.Root
                    key={field}
                    className={`admin-track-${field}`}
                    size="2"
                    value={row[field]}
                    placeholder={PLACEHOLDERS[field]}
                    aria-label={`${LABELS[field]}, morceau ${index + 1}`}
                    aria-invalid={errors[`tracks.${index}.${field}`] ? true : undefined}
                    color={errors[`tracks.${index}.${field}`] ? "red" : undefined}
                    inputMode={field === "hopperUrl" ? "url" : undefined}
                    autoComplete="off"
                    data-track={index}
                    data-field={field}
                    onChange={(event) => update(index, field, event.target.value)}
                    onKeyDown={onKeyDown(index, field)}
                  />
                ))}
                <Flex gap="1" justify="end" className="admin-track-actions">
                  <Tooltip content="Monter">
                    <IconButton type="button" size="1" variant="ghost" color="gray" disabled={index === 0} onClick={() => sortable.move(index, index - 1)} aria-label={`Monter le morceau ${index + 1}`}>
                      <ArrowUpIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip content="Descendre">
                    <IconButton
                      type="button"
                      size="1"
                      variant="ghost"
                      color="gray"
                      disabled={index === rows.length - 1}
                      onClick={() => sortable.move(index, index + 1)}
                      aria-label={`Descendre le morceau ${index + 1}`}
                    >
                      <ArrowDownIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip content="Retirer">
                    <IconButton type="button" size="1" variant="ghost" color="red" onClick={() => remove(index)} aria-label={`Retirer le morceau ${index + 1}`}>
                      <Cross2Icon />
                    </IconButton>
                  </Tooltip>
                </Flex>
                {problems.length > 0 && (
                  <Text size="1" color="red" className="admin-track-error">
                    {problems.join(" ")}
                  </Text>
                )}
              </div>
            );
          })}
        </div>
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
    </Card>
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
          Une ligne par morceau : le minutage (m:ss ou h:mm:ss, facultatif), l'artiste, un tiret, le titre. Les numéros, les crochets,
          les liens Hopper et les colonnes copiées d'un tableur sont reconnus.
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
              {counted(lines.length)} reconnu{lines.length > 1 ? "s" : ""}
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
                      <Table.Cell>{line.start || "—"}</Table.Cell>
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
            {lines.length ? `Ajouter ${counted(lines.length)}` : "Ajouter"}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
