/**
 * Ce que partagent les listes (shows, artistes) : des filtres qui vivent dans l'adresse (une liste filtrée se garde ou
 * se partage), appliqués sans recharger la page, et une recherche qui part dès qu'on s'arrête de taper.
 */
import { Cross2Icon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { IconButton, TextField } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, type NavigateOptions } from "./router";

/** La valeur « tous » d'un filtre (Radix Select n'accepte pas de valeur vide). */
export const ALL = "tous";
/** Le temps sans taper après lequel la recherche part. */
const PAUSE_MS = 300;

type Filters = { q: string } & Record<string, string>;

/** L'adresse d'une liste filtrée : seuls les filtres choisis, sans les valeurs par défaut. */
export function listHref(path: string, filters: Record<string, string>, { page = 1, defaults = {} }: { page?: number; defaults?: Record<string, string> } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value && value !== ALL && value !== defaults[key]) params.set(key, value);
  if (page > 1) params.set("page", String(page));
  return `${path}${params.size ? `?${params}` : ""}`;
}

/**
 * Les filtres d'une liste. Un choix s'affiche tout de suite, le temps que le serveur renvoie la liste filtrée ; quand
 * l'écran change par ailleurs (Précédent, « Effacer les filtres »), les filtres affichés le suivent.
 */
export function useListFilters<F extends Filters>(filters: F, hrefOf: (filters: F, page?: number) => string) {
  const { navigate } = useRouter();
  const [pending, setPending] = useState<{ on: F; changes: Partial<F> }>({ on: filters, changes: {} });
  const shown: F = pending.on === filters ? { ...filters, ...pending.changes } : filters;
  const latest = useRef({ filters, shown });
  latest.current = { filters, shown };

  const set = useCallback(
    (changes: Partial<F>, options: NavigateOptions = {}) => {
      const { filters: on, shown: current } = latest.current;
      setPending((before) => ({ on, changes: { ...(before.on === on ? before.changes : {}), ...changes } }));
      navigate(hrefOf({ ...current, ...changes }), { keepScroll: true, ...options });
    },
    [navigate, hrefOf],
  );
  const goToPage = (page: number) => navigate(hrefOf(latest.current.shown, page));

  // La recherche : le champ suit ce qu'on tape ; la liste, ce que le serveur a cherché.
  const [query, setQuery] = useState(filters.q);
  const sent = useRef(filters.q);
  useEffect(() => {
    if (filters.q === sent.current) return;
    sent.current = filters.q;
    setQuery(filters.q);
  }, [filters.q]);
  const search = useCallback(
    (value: string) => {
      const q = value.trim();
      if (q === sent.current) return;
      sent.current = q;
      // Chaque pause remplace la précédente dans l'historique : Précédent ne repasse pas par chaque mot tapé.
      set({ q } as Partial<F>, { replace: true });
    },
    [set],
  );
  useEffect(() => {
    const timer = setTimeout(() => search(query), PAUSE_MS);
    return () => clearTimeout(timer);
  }, [query, search]);

  return { shown, set, goToPage, query: { value: query, change: setQuery, now: search } };
}

export type ListQuery = ReturnType<typeof useListFilters>["query"];

/** Le champ de recherche d'une liste : la liste suit la saisie ; Entrée cherche tout de suite, Échap efface. */
export function SearchField({ query, placeholder }: { query: ListQuery; placeholder: string }) {
  const clear = () => {
    query.change("");
    query.now("");
  };
  return (
    <form
      className="admin-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        query.now(query.value);
      }}
    >
      <TextField.Root
        value={query.value}
        onChange={(event) => query.change(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && query.value) {
            event.preventDefault();
            clear();
          }
        }}
        placeholder={placeholder}
        aria-label="Rechercher"
        enterKeyHint="search"
        autoComplete="off"
      >
        <TextField.Slot>
          <MagnifyingGlassIcon />
        </TextField.Slot>
        {query.value && (
          <TextField.Slot side="right">
            <IconButton type="button" size="1" variant="ghost" color="gray" onClick={clear} aria-label="Effacer la recherche">
              <Cross2Icon />
            </IconButton>
          </TextField.Slot>
        )}
      </TextField.Root>
    </form>
  );
}
