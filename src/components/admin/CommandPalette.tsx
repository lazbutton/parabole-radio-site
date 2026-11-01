/**
 * La recherche de partout : ⌘K (Ctrl+K), ou « / » hors d'un champ, ou le champ « Rechercher » de la barre latérale.
 * On tape quelques lettres : les shows et les artistes qui correspondent (brouillons compris, /admin/recherche), et
 * les actions (créer un show, aller aux artistes, passer en sombre…). Sans rien taper : les fiches ouvertes
 * récemment, puis les actions. Les flèches choisissent, Entrée ouvre, ⌘ Entrée ouvre dans un nouvel onglet.
 *
 * Radix Themes n'a pas de palette de commandes : c'est un Dialog avec un champ et une liste d'options (le motif
 * « combobox » d'ARIA, comme le choix des artistes d'un show).
 */
import { LABELS } from "@parabole/cms/labels";
import {
  DashboardIcon,
  DiscIcon,
  ExitIcon,
  FileTextIcon,
  HomeIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PersonIcon,
  PlusIcon,
  SunIcon,
  VideoIcon,
} from "@radix-ui/react-icons";
import { Dialog, Kbd, Spinner, VisuallyHidden } from "@radix-ui/themes";
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useAppearance } from "./appearance";
import { StatusBadge, TypeIcon, useModKey } from "./marks";
import { readRecents, type Recent } from "./recents";
import { useRouter } from "./router";
import { normalize } from "./text";
import type { SearchResults } from "./types";

type Item = {
  key: string;
  label: string;
  /** La précision sous le libellé : les artistes et la date d'un show, le rôle d'un artiste… */
  hint?: string;
  icon: ReactNode;
  href?: string;
  run?(): void;
  badge?: ReactNode;
  /** D'autres mots qui trouvent l'action : « tableau de bord » pour l'accueil. */
  words?: string;
};
type Group = { label: string; items: Item[] };

const CommandContext = createContext<() => void>(() => {});

/** Ouvre la recherche de partout. */
export const useCommand = () => useContext(CommandContext);

/** Un champ où l'on tape : « / » y reste un caractère. */
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function CommandProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      } else if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing(event.target)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <CommandContext.Provider value={() => setOpen(true)}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </CommandContext.Provider>
  );
}

/** Le temps sans taper après lequel la recherche part : court, la liste suit la frappe. */
const PAUSE_MS = 120;

type Found = { q: string; results: SearchResults | null };

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const router = useRouter();
  const { dark, change } = useAppearance();
  const mod = useModKey();
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<Found | null>(null);
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState<Recent[]>([]);
  const typed = query.trim();

  // Chaque ouverture repart d'un champ vide, avec les récents du moment.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setFound(null);
    setRecents(readRecents());
  }, [open]);

  // La recherche suit la frappe ; une réponse dépassée par la suivante est oubliée.
  useEffect(() => {
    if (!open || !typed) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      let results: SearchResults | null = null;
      try {
        const response = await fetch(`/admin/recherche?q=${encodeURIComponent(typed)}`, { headers: { Accept: "application/json" }, signal: controller.signal });
        // Une session expirée renvoie la page de connexion, pas du JSON.
        if (response.ok && (response.headers.get("content-type") ?? "").includes("application/json")) results = (await response.json()) as SearchResults;
      } catch {
        if (controller.signal.aborted) return;
      }
      setFound({ q: typed, results });
      setLoading(false);
    }, PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, typed]);

  const actions = useMemo<Group[]>(
    () => [
      {
        label: "Créer",
        items: [
          { key: "new-show", label: "Nouveau show", icon: <PlusIcon />, href: "/admin/shows/nouveau", words: "créer ajouter" },
          { key: "new-artist", label: "Nouvel artiste", icon: <PlusIcon />, href: "/admin/artistes/nouveau", words: "créer ajouter résident invité" },
        ],
      },
      {
        label: "Aller à",
        items: [
          { key: "home", label: "Accueil", icon: <HomeIcon />, href: "/admin", words: "tableau de bord" },
          { key: "shows", label: "Shows", icon: <DiscIcon />, href: "/admin/shows", words: "émissions archives" },
          { key: "drafts", label: "Shows en brouillon", icon: <FileTextIcon />, href: "/admin/shows?status=draft", words: "brouillons" },
          { key: "artists", label: "Artistes", icon: <PersonIcon />, href: "/admin/artistes", words: "résidents invités" },
          { key: "clips", label: "Vidéos de fond", icon: <VideoIcon />, href: "/admin/videos", words: "clips accueil fond chaînes" },
          { key: "password", label: "Changer de mot de passe", icon: <LockClosedIcon />, href: "/admin/mot-de-passe", words: "compte" },
        ],
      },
      {
        label: "Préférences",
        items: [
          dark
            ? { key: "light", label: "Passer en mode clair", icon: <SunIcon />, run: () => change("light"), words: "apparence thème" }
            : { key: "dark", label: "Passer en mode sombre", icon: <MoonIcon />, run: () => change("dark"), words: "apparence thème nuit" },
          {
            key: "logout",
            label: "Se déconnecter",
            icon: <ExitIcon />,
            run: () => document.querySelector<HTMLFormElement>("#admin-logout")?.requestSubmit(),
            words: "déconnexion quitter",
          },
        ],
      },
    ],
    [dark, change],
  );

  const groups = useMemo<Group[]>(() => {
    if (!typed) {
      const recent: Group = {
        label: "Ouverts récemment",
        items: recents.map((item) => ({ key: item.href, label: item.title, icon: item.kind === "show" ? <DiscIcon /> : <PersonIcon />, href: item.href, hint: item.kind === "show" ? "Show" : "Artiste" })),
      };
      return [recent, ...actions].filter((group) => group.items.length);
    }
    const wanted = normalize(typed);
    const matchingActions = actions.flatMap((group) => group.items).filter((item) => normalize(`${item.label} ${item.words ?? ""}`).includes(wanted));
    // Les résultats de la frappe précédente restent affichés le temps que la nouvelle réponse arrive.
    const results = found?.results;
    const showItems: Item[] = (results?.shows ?? []).map((show) => ({
      key: `show-${show.id}`,
      label: show.title,
      hint: [show.artists, show.date || "sans date", LABELS.showType[show.type]].filter(Boolean).join(" · "),
      icon: <TypeIcon type={show.type} />,
      href: `/admin/shows/${show.id}`,
      badge: show.status === "draft" ? <StatusBadge status="draft" /> : undefined,
    }));
    const artistItems: Item[] = (results?.artists ?? []).map((artist) => ({
      key: `artist-${artist.id}`,
      label: artist.name,
      hint: `${LABELS.artistRole[artist.role]} · ${artist.shows ? `${artist.shows} show${artist.shows > 1 ? "s" : ""}` : "aucun show"}`,
      icon: <PersonIcon />,
      href: `/admin/artistes/${artist.id}`,
      badge: artist.status === "draft" ? <StatusBadge status="draft" /> : undefined,
    }));
    const q = encodeURIComponent(typed);
    if (showItems.length) showItems.push({ key: "all-shows", label: `Tous les shows pour « ${typed} »`, icon: <MagnifyingGlassIcon />, href: `/admin/shows?q=${q}` });
    if (artistItems.length) artistItems.push({ key: "all-artists", label: `Tous les artistes pour « ${typed} »`, icon: <MagnifyingGlassIcon />, href: `/admin/artistes?q=${q}` });
    return [
      { label: "Shows", items: showItems },
      { label: "Artistes", items: artistItems },
      { label: "Actions", items: matchingActions.slice(0, 5) },
    ].filter((group) => group.items.length);
  }, [typed, found, recents, actions]);

  const flat = groups.flatMap((group) => group.items);
  const current = Math.min(active, Math.max(0, flat.length - 1));

  // L'option active reste visible quand on la change au clavier.
  useEffect(() => {
    list.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function choose(item: Item, newTab = false) {
    if (item.href && newTab) return void window.open(item.href, "_blank");
    onOpenChange(false);
    if (item.href) router.navigate(item.href);
    else item.run?.();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!flat.length) return;
    const last = flat.length - 1;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + flat.length) % flat.length);
    } else if (event.key === "Home" && event.ctrlKey) {
      setActive(0);
    } else if (event.key === "End" && event.ctrlKey) {
      setActive(last);
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const item = flat[current];
      if (item) choose(item, event.metaKey || event.ctrlKey);
    }
  }

  const answered = found?.q === typed;
  const failed = answered && found?.results === null;
  const nothing = Boolean(typed) && answered && !failed && !flat.length;
  let index = -1;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className="admin-palette" align="start" maxWidth="620px" aria-describedby={undefined}>
        <VisuallyHidden>
          <Dialog.Title>Rechercher dans l'admin</Dialog.Title>
        </VisuallyHidden>
        <div className="admin-palette-search">
          <MagnifyingGlassIcon width="18" height="18" aria-hidden />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Rechercher un show, un artiste, une action…"
            aria-label="Rechercher"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={flat.length ? `${listId}-${current}` : undefined}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          {loading && <Spinner size="2" />}
          <Kbd size="1" className="admin-palette-esc">
            esc
          </Kbd>
        </div>
        <div className="admin-palette-results" ref={list} role="listbox" id={listId} aria-label="Résultats">
          {groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label} className="admin-palette-group">
              <div className="admin-palette-group-label" aria-hidden>
                {group.label}
              </div>
              {group.items.map((item) => {
                index += 1;
                const mine = index;
                return (
                  <div
                    key={item.key}
                    id={`${listId}-${mine}`}
                    role="option"
                    aria-selected={mine === current}
                    data-index={mine}
                    data-active={mine === current || undefined}
                    className="admin-palette-item"
                    onPointerMove={() => mine !== current && setActive(mine)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => choose(item, event.metaKey || event.ctrlKey)}
                  >
                    <span className="admin-palette-icon">{item.icon}</span>
                    <span className="admin-palette-text">
                      <span className="admin-palette-label">{item.label}</span>
                      {item.hint && <span className="admin-palette-hint">{item.hint}</span>}
                    </span>
                    {item.badge}
                    <span className="admin-palette-enter" aria-hidden>
                      ↵
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {nothing && <p className="admin-palette-note">Rien trouvé pour « {typed} ».</p>}
          {failed && <p className="admin-palette-note">La recherche ne répond pas : ta session a peut-être expiré. Recharge la page.</p>}
        </div>
        <div className="admin-palette-footer" aria-hidden>
          <span>
            <Kbd size="1">↑</Kbd> <Kbd size="1">↓</Kbd> choisir
          </span>
          <span>
            <Kbd size="1">↵</Kbd> ouvrir
          </span>
          <span>
            <Kbd size="1">{mod} ↵</Kbd> nouvel onglet
          </span>
          <span className="admin-palette-footer-end">
            <DashboardIcon /> Admin Parabole
          </span>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
