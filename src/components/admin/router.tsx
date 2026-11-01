/**
 * Le routeur de l'application d'admin : on passe d'un écran à l'autre sans recharger la page. Un clic sur un lien de
 * l'admin, ou sur une ligne de tableau qui mène à une fiche (data-href), demande l'écran au serveur, en JSON, à la même
 * adresse que la page : chaque page Astro sert les deux. L'en-tête et les notifications restent en place.
 *
 * Pour que ce soit rapide :
 *   - un lien survolé (ou touché, sur téléphone) est chargé d'avance ;
 *   - une liste déjà vue s'affiche tout de suite de mémoire, puis se met à jour.
 * Une fiche modifiée retient la navigation (useBlocker) le temps d'une confirmation. Précédent et Suivant retrouvent la
 * position dans la page. Une session expirée, une panne ou une page hors de l'application (connexion…) se charge
 * normalement, comme avec un lien ordinaire.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNotify } from "./toast";
import type { Screen } from "./types";

/** Les adresses que l'application affiche elle-même ; les autres (connexion, déconnexion…) se chargent normalement. */
const APP_PATHS = [/^\/admin\/?$/, /^\/admin\/shows\/?$/, /^\/admin\/shows\/[^/]+\/?$/, /^\/admin\/artistes\/?$/, /^\/admin\/artistes\/[^/]+\/?$/, /^\/admin\/mot-de-passe\/?$/];
export const isAppPath = (pathname: string) => APP_PATHS.some((pattern) => pattern.test(pathname));

/** Les écrans qu'on peut montrer de mémoire en attendant la version à jour : les listes, pas les fiches. */
const CACHEABLE = new Set<Screen["name"]>(["dashboard", "shows", "artists"]);
/** Combien de temps un écran chargé d'avance reste bon à afficher. */
const AHEAD_MS = 10_000;

type Loaded = { href: string; screen: Screen } | { leave: string } | { offline: true };
type Mode = "push" | "replace" | "pop";
export type NavigateOptions = {
  /** Remplace l'entrée de l'historique au lieu d'en ajouter une : la recherche, mise à jour à chaque pause. */
  replace?: boolean;
  /** Garde la position dans la page : un filtre qui change. */
  keepScroll?: boolean;
};
/** Ce qui retient la navigation : une fiche modifiée, et de quoi l'enregistrer avant de partir. */
export type Blocker = { save?(): Promise<boolean> };

type Router = {
  href: string;
  screen: Screen;
  /** Change à chaque écran affiché : une fiche rouverte repart de ce que dit le serveur. */
  visit: number;
  /** Un écran est demandé au serveur et pas encore affiché. */
  loading: boolean;
  navigate(href: string, options?: NavigateOptions): void;
  /** Remplace l'écran affiché sans aller le chercher : une fiche que le serveur vient de renvoyer. */
  replace(href: string, screen: Screen): void;
  /** Oublie les écrans gardés en mémoire : après un enregistrement, les listes ont changé. */
  invalidate(): void;
  setBlocker(blocker: Blocker | null): void;
};

const RouterContext = createContext<Router | null>(null);

export function useRouter(): Router {
  const router = useContext(RouterContext);
  if (!router) throw new Error("useRouter hors du routeur de l'admin");
  return router;
}

/** Retient la navigation tant que `blocked` est vrai : la fiche a des modifications non enregistrées. */
export function useBlocker(blocked: boolean, save?: () => Promise<boolean>) {
  const { setBlocker } = useRouter();
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => {
    if (!blocked) return;
    setBlocker({ save: latest.current && (() => latest.current!()) });
    return () => setBlocker(null);
  }, [blocked, setBlocker]);
}

const here = () => location.pathname + location.search;

function appHref(raw: string) {
  const url = new URL(raw, location.href);
  return url.origin === location.origin && isAppPath(url.pathname) && !url.hash ? url.pathname + url.search : null;
}

/** Où mène un clic : un lien de l'application, ou une ligne de tableau qui mène à une fiche. Null pour le reste. */
function destination(target: EventTarget | null): { href: string; row: boolean } | null {
  if (!(target instanceof Element)) return null;
  const link = target.closest("a[href]");
  if (link) {
    if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute("download")) return null;
    const href = appHref(link.href);
    return href ? { href, row: false } : null;
  }
  const row = target.closest("[data-href]");
  // Les boutons et les champs d'une ligne gardent leur rôle.
  if (!row || target.closest("button, input, select, textarea, label")) return null;
  const href = appHref(row.getAttribute("data-href") ?? "");
  return href ? { href, row: true } : null;
}

/** Demande un écran au serveur. Ce qui n'en est pas un (la connexion, une erreur) se charge pour de bon. */
async function fetchScreen(href: string): Promise<Loaded> {
  let response: Response;
  try {
    response = await fetch(href, { headers: { Accept: "application/json" } });
  } catch {
    return { offline: true };
  }
  const url = new URL(response.url || href, location.href);
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  if (response.ok && isJson && url.origin === location.origin && isAppPath(url.pathname)) {
    try {
      const screen = (await response.json()) as Screen;
      if (typeof screen?.name === "string") return { href: url.pathname + url.search, screen };
    } catch {
      // Une réponse illisible : on charge la page.
    }
  }
  return { leave: url.href };
}

export function RouterProvider({
  href: firstHref,
  screen: firstScreen,
  onBlocked,
  children,
}: {
  href: string;
  screen: Screen;
  /** Une fiche modifiée retient la navigation : `proceed` part quand même, `save` enregistre d'abord. */
  onBlocked(proceed: () => void, save?: () => Promise<boolean>): void;
  children: ReactNode;
}) {
  const notify = useNotify();
  const [state, setState] = useState({ href: firstHref, screen: firstScreen, visit: 0 });
  const [loading, setLoading] = useState(false);
  const shown = useRef(state);
  shown.current = state;
  const cache = useRef(new Map<string, Screen>());
  const ahead = useRef(new Map<string, { at: number; loaded: Promise<Loaded> }>());
  const blocker = useRef<Blocker | null>(null);
  const blockedHandler = useRef(onBlocked);
  blockedHandler.current = onBlocked;
  const ticket = useRef(0);
  const scrollTarget = useRef<number | null>(null);

  const show = useCallback(
    async (href: string, mode: Mode, { keepScroll = false, scroll = 0 }: { keepScroll?: boolean; scroll?: number } = {}) => {
      const mine = ++ticket.current;
      const commit = (target: string, screen: Screen) => {
        if (mode === "push") {
          history.replaceState({ ...history.state, scroll: scrollY }, "");
          history.pushState({ scroll: keepScroll ? scrollY : 0 }, "", target);
        } else if (target !== here()) history.replaceState(history.state, "", target);
        document.title = `${screen.title} — Admin Parabole`;
        scrollTarget.current = mode === "pop" ? scroll : keepScroll ? null : 0;
        setState((current) => ({ href: target, screen, visit: current.visit + 1 }));
      };
      const cached = cache.current.get(href);
      if (cached) commit(href, cached);
      setLoading(!cached);
      const early = ahead.current.get(href);
      ahead.current.delete(href);
      const loaded = await (early && Date.now() - early.at < AHEAD_MS ? early.loaded : fetchScreen(href));
      if (mine !== ticket.current) return;
      setLoading(false);
      if ("leave" in loaded) return void location.assign(loaded.leave);
      if ("offline" in loaded) return void notify({ kind: "error", title: "Pas de connexion au serveur", description: "Vérifie le réseau, puis réessaie." });
      if (CACHEABLE.has(loaded.screen.name)) cache.current.set(loaded.href, loaded.screen);
      if (!cached) return commit(loaded.href, loaded.screen);
      // Affiché de mémoire : la version à jour prend sa place, sans toucher à l'historique ni à la position.
      const fresh = JSON.stringify(loaded.screen);
      setState((current) => (JSON.stringify(current.screen) === fresh ? current : { ...current, screen: loaded.screen }));
    },
    [notify],
  );

  const navigate = useCallback(
    (to: string, { replace = false, keepScroll = false }: NavigateOptions = {}) => {
      const url = new URL(to, location.href);
      if (url.origin !== location.origin || !isAppPath(url.pathname)) return void location.assign(url.href);
      const href = url.pathname + url.search;
      const go = () => void show(href, replace || href === here() ? "replace" : "push", { keepScroll });
      if (blocker.current) blockedHandler.current(go, blocker.current.save);
      else go();
    },
    [show],
  );

  const replace = useCallback((href: string, screen: Screen) => {
    history.replaceState(history.state, "", href);
    document.title = `${screen.title} — Admin Parabole`;
    setState((current) => ({ ...current, href, screen }));
  }, []);

  const invalidate = useCallback(() => {
    cache.current.clear();
    ahead.current.clear();
  }, []);

  const setBlocker = useCallback((value: Blocker | null) => {
    blocker.current = value;
  }, []);

  // Le premier écran sert aussi de mémoire. La position dans la page, c'est l'application qui la gère, y compris
  // quand on recharge la page.
  useEffect(() => {
    const first = shown.current;
    if (CACHEABLE.has(first.screen.name)) cache.current.set(first.href, first.screen);
    history.scrollRestoration = "manual";
    if (typeof history.state?.scroll === "number") scrollTo(0, history.state.scroll);
  }, []);

  // La position dans la page suit l'entrée de l'historique, pour Précédent, Suivant et le rechargement.
  useEffect(() => {
    let timer = 0;
    const remember = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          history.replaceState({ ...history.state, scroll: scrollY }, "");
        } catch {
          // Safari limite le nombre de changements de l'historique : la position sera un peu moins juste.
        }
      }, 250);
    };
    addEventListener("scroll", remember, { passive: true });
    return () => {
      clearTimeout(timer);
      removeEventListener("scroll", remember);
    };
  }, []);

  // Le nouvel écran est dans la page : on va à la position voulue (le haut, ou celle d'avant pour Précédent).
  useLayoutEffect(() => {
    const target = scrollTarget.current;
    if (target === null) return;
    scrollTarget.current = null;
    scrollTo(0, target);
  }, [state]);

  // Tous les liens de l'admin, même dans les menus de Radix (rendus hors de l'application), passent par le routeur.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const found = destination(event.target);
      if (!found) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        // Un lien s'ouvre seul dans un nouvel onglet ; une ligne de tableau, on l'y aide.
        if (found.row) open(found.href, "_blank");
        return;
      }
      event.preventDefault();
      navigate(found.href);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [navigate]);

  // Un lien survolé un instant, ou touché, est chargé d'avance : le clic qui suit affiche l'écran sans attendre.
  useEffect(() => {
    let timer = 0;
    const prefetch = (href: string) => {
      if (href === here() || cache.current.has(href)) return;
      const early = ahead.current.get(href);
      if (early && Date.now() - early.at < AHEAD_MS) return;
      ahead.current.set(href, { at: Date.now(), loaded: fetchScreen(href) });
    };
    const onOver = (event: PointerEvent) => {
      clearTimeout(timer);
      const found = event.pointerType === "mouse" ? destination(event.target) : null;
      if (found) timer = window.setTimeout(() => prefetch(found.href), 80);
    };
    const onDown = (event: PointerEvent) => {
      // Le clic arrive : le chargement prévu au survol ferait doublon.
      clearTimeout(timer);
      const found = destination(event.target);
      if (found) prefetch(found.href);
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", onDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", onDown);
    };
  }, []);

  // Précédent et Suivant du navigateur.
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const href = here();
      // Un saut vers une ancre de la même page : rien à charger.
      if (href === shown.current.href) return;
      const scroll = typeof event.state?.scroll === "number" ? event.state.scroll : 0;
      const guard = blocker.current;
      if (!guard) return void show(href, "pop", { scroll });
      // Une fiche modifiée : on y revient d'abord, puis on demande.
      history.pushState({ scroll: scrollY }, "", shown.current.href);
      blockedHandler.current(() => {
        blocker.current = null;
        history.back();
      }, guard.save);
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [show]);

  const router = useMemo<Router>(
    () => ({ ...state, loading, navigate, replace, invalidate, setBlocker }),
    [state, loading, navigate, replace, invalidate, setBlocker],
  );
  return <RouterContext.Provider value={router}>{children}</RouterContext.Provider>;
}
