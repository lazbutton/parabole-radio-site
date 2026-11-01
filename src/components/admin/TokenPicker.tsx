/**
 * Choisir des artistes ou des étiquettes : on tape, la liste propose les noms connus (Radix Popover), les flèches et
 * Entrée choisissent ; un nom inconnu se crée à l'enregistrement (« nouveau:… » : un artiste naît en brouillon). Les
 * artistes d'un show s'affichent dans l'ordre, à réordonner ; les étiquettes, en pastilles.
 */
import { ArrowDownIcon, ArrowUpIcon, Cross2Icon, DragHandleDots2Icon, PlusIcon } from "@radix-ui/react-icons";
import { Badge, Flex, IconButton, Popover, Text, TextField, Tooltip } from "@radix-ui/themes";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSortable } from "./sortable";
import type { Choice } from "./types";

const NEW_PICK = "nouveau:";
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

type Props = {
  label: string;
  values: string[];
  options: Choice[];
  onChange(values: string[]): void;
  placeholder: string;
  /** Le type d'étiquette : il accompagne un nom nouveau (« nouveau:genre:… »). */
  kind?: string;
  /** L'ordre compte : une liste à réordonner ; sinon, des pastilles. */
  ordered?: boolean;
  /** Le badge d'un nom nouveau : « nouveau » (un artiste), « nouvelle » (une étiquette). */
  newLabel?: string;
  hint?: string;
  error?: string;
};

export function TokenPicker({ label, values, options, onChange, placeholder, kind, ordered = false, newLabel = "nouveau", hint, error }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const prefix = `${NEW_PICK}${kind ? `${kind}:` : ""}`;
  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const tokens = values.map((value) => {
    if (value.startsWith(prefix)) return { value, label: value.slice(prefix.length), badge: newLabel };
    const option = byId.get(value);
    return { value, label: option?.name ?? "?", badge: option?.status === "draft" ? "brouillon" : undefined };
  });
  const sortable = useSortable(values, onChange);

  const typed = query.replace(/\s+/g, " ").trim();
  const chosen = new Set(values);
  const matches = typed ? options.filter((option) => !chosen.has(option.id) && normalize(option.name).includes(normalize(typed))).slice(0, 8) : [];
  const exact = options.some((option) => normalize(option.name) === normalize(typed));
  const takenNew = values.some((value) => value.startsWith(prefix) && normalize(value.slice(prefix.length)) === normalize(typed));
  const suggestions: { key: string; label: string; value: string; create?: boolean }[] = [
    ...matches.map((option) => ({ key: option.id, label: option.name, value: option.id })),
    ...(typed && !exact && !takenNew ? [{ key: "create", label: typed, value: `${prefix}${typed}`, create: true }] : []),
  ];

  function pick(value: string) {
    if (!chosen.has(value)) onChange([...values, value]);
    setQuery("");
    setOpen(false);
    setActive(0);
    input.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (suggestions.length ? (index + step + suggestions.length) % suggestions.length : 0));
    } else if (event.key === "Enter") {
      // Entrée choisit, et n'envoie jamais la fiche depuis ce champ.
      event.preventDefault();
      const suggestion = suggestions[Math.min(active, suggestions.length - 1)];
      if (suggestion) pick(suggestion.value);
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    } else if (event.key === "Backspace" && !query && values.length && !ordered) {
      onChange(values.slice(0, -1));
    }
  }

  const remove = (value: string) => onChange(values.filter((other) => other !== value));
  const listId = `${id}-suggestions`;

  return (
    <Flex direction="column" gap="2">
      <Text as="label" size="2" weight="medium" htmlFor={`${id}-input`}>
        {label}
      </Text>
      {tokens.length > 0 &&
        (ordered ? (
          <Flex direction="column" gap="1" ref={(element) => void (sortable.container.current = element)}>
            {tokens.map((token, index) => (
              <Flex
                key={token.value}
                align="center"
                gap="2"
                className={sortable.dragging === index ? "admin-token-row admin-dragging" : "admin-token-row"}
                data-sort-index={index}
              >
                <span className="admin-grip" aria-hidden {...sortable.handle(index)}>
                  <DragHandleDots2Icon />
                </span>
                <Text size="2" weight="medium" className="admin-token-name">
                  {token.label}
                </Text>
                {token.badge && (
                  <Badge size="1" color={token.badge === "brouillon" ? "gray" : "indigo"} variant="soft">
                    {token.badge}
                  </Badge>
                )}
                <Flex gap="1" ml="auto">
                  <Tooltip content="Monter">
                    <IconButton type="button" size="1" variant="ghost" color="gray" disabled={index === 0} onClick={() => sortable.move(index, index - 1)} aria-label={`Monter ${token.label}`}>
                      <ArrowUpIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip content="Descendre">
                    <IconButton
                      type="button"
                      size="1"
                      variant="ghost"
                      color="gray"
                      disabled={index === tokens.length - 1}
                      onClick={() => sortable.move(index, index + 1)}
                      aria-label={`Descendre ${token.label}`}
                    >
                      <ArrowDownIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip content="Retirer">
                    <IconButton type="button" size="1" variant="ghost" color="red" onClick={() => remove(token.value)} aria-label={`Retirer ${token.label}`}>
                      <Cross2Icon />
                    </IconButton>
                  </Tooltip>
                </Flex>
              </Flex>
            ))}
          </Flex>
        ) : (
          <Flex gap="2" wrap="wrap">
            {tokens.map((token) => (
              <Badge key={token.value} size="2" variant="surface" color={token.badge ? "indigo" : "gray"} radius="full" className="admin-chip">
                {token.label}
                <button type="button" className="admin-chip-remove" onClick={() => remove(token.value)} aria-label={`Retirer ${token.label}`}>
                  <Cross2Icon />
                </button>
              </Badge>
            ))}
          </Flex>
        ))}
      <Popover.Root open={open && suggestions.length > 0} onOpenChange={setOpen}>
        <Popover.Anchor>
          <TextField.Root
            ref={input}
            id={`${id}-input`}
            value={query}
            placeholder={placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-controls={listId}
            aria-activedescendant={open && suggestions[active] ? `${listId}-${active}` : undefined}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
          >
            <TextField.Slot>
              <PlusIcon />
            </TextField.Slot>
          </TextField.Root>
        </Popover.Anchor>
        <Popover.Content
          className="admin-suggestions"
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div role="listbox" id={listId} aria-label={label}>
            {suggestions.map((suggestion, index) => (
              <div
                key={suggestion.key}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className="admin-suggestion"
                data-active={index === active || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(suggestion.value)}
              >
                {suggestion.create ? (
                  <>
                    <PlusIcon /> Créer « {suggestion.label} »
                  </>
                ) : (
                  suggestion.label
                )}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Root>
      {hint && (
        <Text size="1" color="gray">
          {hint}
        </Text>
      )}
      {error && (
        <Text size="1" color="red">
          {error}
        </Text>
      )}
    </Flex>
  );
}
