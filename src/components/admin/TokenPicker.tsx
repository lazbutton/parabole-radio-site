/**
 * Choisir des artistes ou des étiquettes, en pastilles dans un seul champ : on tape, la liste propose les noms connus,
 * les flèches et Entrée choisissent ; un nom inconnu se crée à l'enregistrement (« nouveau:… » : un artiste naît en
 * brouillon). Les artistes d'un show gardent leur ordre (« A b2b B ») : on les glisse, ou Alt+← → sur une pastille.
 * Retour arrière dans le champ vide va à la dernière pastille ; un second la retire.
 *
 * La liste est un Popover de Radix ancré au champ. Celui de Radix Themes ne convient pas : son Popover.Anchor
 * (3.3.0) n'affiche pas ce qu'on met dedans. On prend donc celui de radix-ui, sans portail, pour garder les couleurs
 * du thème.
 */
import { Cross2Icon, PlusIcon } from "@radix-ui/react-icons";
import { Popover } from "radix-ui";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSortable } from "./sortable";
import { normalize } from "./text";
import type { Choice } from "./types";

const NEW_PICK = "nouveau:";

type Props = {
  /** L'identifiant du champ, pour le libellé de la propriété (<label for>). */
  id: string;
  label: string;
  values: string[];
  options: Choice[];
  onChange(values: string[]): void;
  placeholder: string;
  /** Le type d'étiquette : il accompagne un nom nouveau (« nouveau:genre:… »). */
  kind?: string;
  /** L'ordre compte : les pastilles se réordonnent. */
  ordered?: boolean;
  /** Le badge d'un nom nouveau : « nouveau » (un artiste), « nouvelle » (une étiquette). */
  newLabel?: string;
  error?: string;
};

export function TokenPicker({ id, label, values, options, onChange, placeholder, kind, ordered = false, newLabel = "nouveau", error }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const prefix = `${NEW_PICK}${kind ? `${kind}:` : ""}`;
  const byId = useMemo(() => new Map(options.map((option) => [option.id, option])), [options]);
  const tokens = values.map((value) => {
    if (value.startsWith(prefix)) return { value, label: value.slice(prefix.length), badge: newLabel, fresh: true };
    const option = byId.get(value);
    return { value, label: option?.name ?? "?", badge: option?.status === "draft" ? "brouillon" : undefined, fresh: false };
  });
  const sortable = useSortable(values, onChange, { axis: "x" });

  const typed = query.replace(/\s+/g, " ").trim();
  const chosen = new Set(values);
  const matches = typed ? options.filter((option) => !chosen.has(option.id) && normalize(option.name).includes(normalize(typed))).slice(0, 8) : [];
  const exact = options.some((option) => normalize(option.name) === normalize(typed));
  const takenNew = values.some((value) => value.startsWith(prefix) && normalize(value.slice(prefix.length)) === normalize(typed));
  const suggestions: { key: string; label: string; value: string; create?: boolean }[] = [
    ...matches.map((option) => ({ key: option.id, label: option.name, value: option.id })),
    ...(typed && !exact && !takenNew ? [{ key: "create", label: typed, value: `${prefix}${typed}`, create: true }] : []),
  ];
  const listId = `${id}-suggestions`;
  const showing = open && suggestions.length > 0;

  function pick(value: string) {
    if (!chosen.has(value)) onChange([...values, value]);
    setQuery("");
    setOpen(false);
    setActive(0);
    input.current?.focus();
  }

  const remove = (value: string) => onChange(values.filter((other) => other !== value));
  const focusToken = (index: number) => requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-sort-index="${index}"]`)?.focus());

  function onInputKey(event: KeyboardEvent<HTMLInputElement>) {
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
      if (showing) {
        event.preventDefault();
        setOpen(false);
      }
    } else if ((event.key === "Backspace" || event.key === "ArrowLeft") && !query && values.length) {
      event.preventDefault();
      focusToken(values.length - 1);
    }
  }

  function onTokenKey(event: KeyboardEvent<HTMLElement>, index: number, value: string) {
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      remove(value);
      if (index < values.length - 1) focusToken(index);
      else input.current?.focus();
    } else if (ordered && event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      const target = index + (event.key === "ArrowLeft" ? -1 : 1);
      sortable.move(index, target);
      focusToken(Math.max(0, Math.min(values.length - 1, target)));
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusToken(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (index < values.length - 1) focusToken(index + 1);
      else input.current?.focus();
    }
  }

  return (
    <Popover.Root open={showing} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div
          ref={(element) => {
            box.current = element;
            sortable.container.current = element;
          }}
          className="admin-tokens"
          data-invalid={error ? true : undefined}
          // Un clic dans le vide du champ y met le curseur.
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            input.current?.focus();
          }}
        >
          {tokens.map((token, index) => (
            <span
              key={token.value}
              className="admin-token"
              data-sort-index={index}
              data-dragging={sortable.dragging === index || undefined}
              data-fresh={token.fresh || undefined}
              data-ordered={ordered || undefined}
              tabIndex={-1}
              aria-label={`${token.label}${token.badge ? ` (${token.badge})` : ""}${ordered ? `, ${index + 1} sur ${tokens.length}` : ""}`}
              aria-keyshortcuts={ordered ? "Alt+ArrowLeft Alt+ArrowRight Delete" : "Delete"}
              onKeyDown={(event) => onTokenKey(event, index, token.value)}
              onPointerDown={(event) => {
                // La croix garde son clic ; le reste de la pastille se glisse (artistes d'un show).
                if (!ordered || (event.target as Element).closest("button")) return;
                sortable.handle(index).onPointerDown(event);
              }}
            >
              <span className="admin-token-label">{token.label}</span>
              {token.badge && <span className="admin-token-badge">{token.badge}</span>}
              <button type="button" className="admin-token-remove" tabIndex={-1} onClick={() => remove(token.value)} aria-label={`Retirer ${token.label}`}>
                <Cross2Icon />
              </button>
            </span>
          ))}
          <input
            ref={input}
            id={id}
            className="admin-tokens-input"
            value={query}
            placeholder={tokens.length ? "Ajouter…" : placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded={showing}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showing && suggestions[active] ? `${listId}-${active}` : undefined}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onInputKey}
          />
        </div>
      </Popover.Anchor>
      <Popover.Content
        className="admin-suggestions"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        // Un clic dans le champ ne ferme pas la liste : c'est le champ qui décide.
        onInteractOutside={(event) => {
          if (box.current?.contains(event.target as Node)) event.preventDefault();
        }}
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
                  <PlusIcon aria-hidden /> Créer « {suggestion.label} »<span className="admin-suggestion-note">{newLabel === "nouvelle" ? "nouvelle étiquette" : "en brouillon"}</span>
                </>
              ) : (
                suggestion.label
              )}
            </div>
          ))}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
