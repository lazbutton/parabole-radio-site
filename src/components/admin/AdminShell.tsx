/**
 * La coque de l'application d'admin, en Radix Themes. Sur ordinateur, une barre latérale : la marque, la recherche
 * de partout (⌘K), les rubriques, « Voir le site » et le compte. Sur téléphone et tablette, une barre en haut : le
 * menu des rubriques, la recherche et le compte. Elle reste en place quand on change d'écran (router.tsx), avec
 * l'indicateur de chargement. La connexion, elle, garde le design du site (src/layouts/AdminGate.astro).
 */
import {
  ChatBubbleIcon,
  CheckIcon,
  DesktopIcon,
  DiscIcon,
  ExitIcon,
  ExternalLinkIcon,
  HamburgerMenuIcon,
  HomeIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PersonIcon,
  SunIcon,
  VideoIcon,
} from "@radix-ui/react-icons";
import { Avatar, Box, DropdownMenu, Flex, Heading, IconButton, Kbd, Text } from "@radix-ui/themes";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import logo from "../../assets/logo-barre.png";
import { useAppearance, type Appearance } from "./appearance";
import { useCommand } from "./CommandPalette";
import { useModKey } from "./marks";
import { useRouter } from "./router";
import { initial } from "./text";
import type { Screen, Viewer } from "./types";

/**
 * Les rubriques, par groupe. Les suivantes (événements, pages, étiquettes, médiathèque) viendront dans « Contenus » ;
 * l'équipe, dans « Site ».
 */
type Section = { href: string; label: string; icon: typeof HomeIcon; screens: Screen["name"][] };
const HOME: Section = { href: "/admin", label: "Accueil", icon: HomeIcon, screens: ["dashboard"] };
const GROUPS: { label: string; sections: Section[] }[] = [
  {
    label: "Contenus",
    sections: [
      { href: "/admin/shows", label: "Shows", icon: DiscIcon, screens: ["shows", "show"] },
      { href: "/admin/artistes", label: "Artistes", icon: PersonIcon, screens: ["artists", "artist"] },
    ],
  },
  {
    label: "Site",
    sections: [
      { href: "/admin/videos", label: "Vidéos de fond", icon: VideoIcon, screens: ["clips"] },
      { href: "/admin/antenne", label: "Antenne libre", icon: ChatBubbleIcon, screens: ["antenne"] },
    ],
  },
];
const SECTIONS = [HOME, ...GROUPS.flatMap((group) => group.sections)];

/** Le site public, dans un autre onglet. */
const SITE = "/";

export function AdminShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  const { screen, loading } = useRouter();
  // Le titre du nouvel écran, pour les lecteurs d'écran : la page, elle, ne se recharge pas.
  const [announced, setAnnounced] = useState("");
  const firstTitle = useRef(screen.title);
  useEffect(() => {
    if (screen.title !== firstTitle.current) setAnnounced(screen.title);
    firstTitle.current = "";
  }, [screen.title]);

  return (
    <div className="admin-shell">
      <a className="admin-skip" href="#contenu">
        Aller au contenu
      </a>
      <Sidebar viewer={viewer} current={screen.name} />
      <div className="admin-body">
        <TopBar viewer={viewer} current={screen.name} />
        <main id="contenu" className="admin-main" tabIndex={-1}>
          {children}
        </main>
      </div>
      <div className="admin-progress" data-active={loading || undefined} aria-hidden />
      <form id="admin-logout" method="post" action="/admin/deconnexion" hidden />
      <p className="admin-sr-only" aria-live="polite" aria-atomic="true">
        {announced}
      </p>
    </div>
  );
}

/** Le logo et le nom, qui ramènent à l'accueil. */
function Brand() {
  return (
    <a className="admin-brand" href="/admin" data-astro-prefetch="false">
      <span className="admin-logo">
        <img src={logo.src} width={22} height={22} alt="" />
      </span>
      <span className="admin-brand-text">
        <Text as="span" size="2" weight="bold" highContrast>
          Parabole Radio
        </Text>
        <Text as="span" size="1" color="gray">
          Administration
        </Text>
      </span>
    </a>
  );
}

function Sidebar({ viewer, current }: { viewer: Viewer; current: Screen["name"] }) {
  const openCommand = useCommand();
  const mod = useModKey();
  return (
    <aside className="admin-sidebar" aria-label="Navigation de l'admin">
      <Brand />
      <button type="button" className="admin-search-trigger" onClick={openCommand}>
        <MagnifyingGlassIcon aria-hidden />
        <span>Rechercher…</span>
        <Kbd size="1" aria-hidden>
          {mod} K
        </Kbd>
      </button>
      <nav className="admin-nav" aria-label="Rubriques">
        <NavLink section={HOME} current={current} />
        {GROUPS.map((group) => (
          <Fragment key={group.label}>
            <Text as="div" size="1" weight="medium" color="gray" className="admin-nav-heading">
              {group.label}
            </Text>
            {group.sections.map((section) => (
              <NavLink key={section.href} section={section} current={current} />
            ))}
          </Fragment>
        ))}
      </nav>
      <div className="admin-sidebar-end">
        <a className="admin-nav-item" href={SITE} target="_blank" rel="noopener">
          <ExternalLinkIcon aria-hidden />
          Voir le site
        </a>
        <AccountMenu viewer={viewer} side="top">
          <button type="button" className="admin-account" aria-label={`Mon compte : ${viewer.name}`}>
            <Avatar size="2" radius="full" fallback={initial(viewer.name)} variant="solid" />
            <span className="admin-account-text">
              <Text as="span" size="2" weight="medium" truncate>
                {viewer.name}
              </Text>
              <Text as="span" size="1" color="gray" truncate>
                {viewer.role === "admin" ? "Admin" : "Éditeur"}
              </Text>
            </span>
          </button>
        </AccountMenu>
      </div>
    </aside>
  );
}

function NavLink({ section, current }: { section: Section; current: Screen["name"] }) {
  const active = section.screens.includes(current);
  const Icon = section.icon;
  return (
    <a className="admin-nav-item" href={section.href} data-active={active || undefined} aria-current={active ? "page" : undefined} data-astro-prefetch="false">
      <Icon aria-hidden />
      {section.label}
    </a>
  );
}

/** Sur téléphone et tablette : le menu des rubriques, la marque, la recherche et le compte. */
function TopBar({ viewer, current }: { viewer: Viewer; current: Screen["name"] }) {
  const openCommand = useCommand();
  return (
    <header className="admin-topbar">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <IconButton variant="ghost" color="gray" size="3" aria-label="Rubriques">
            <HamburgerMenuIcon width="18" height="18" />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" sideOffset={8} size="2" className="admin-menu">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            const active = section.screens.includes(current);
            return (
              <DropdownMenu.Item key={section.href} asChild>
                <a href={section.href} data-astro-prefetch="false" aria-current={active ? "page" : undefined}>
                  <Icon /> {section.label}
                  {active && <CheckIcon className="admin-menu-check" />}
                </a>
              </DropdownMenu.Item>
            );
          })}
          <DropdownMenu.Separator />
          <DropdownMenu.Item asChild>
            <a href={SITE} target="_blank" rel="noopener">
              <ExternalLinkIcon /> Voir le site
            </a>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <Brand />
      <Flex gap="1" align="center" ml="auto">
        <IconButton variant="ghost" color="gray" size="3" onClick={openCommand} aria-label="Rechercher">
          <MagnifyingGlassIcon width="18" height="18" />
        </IconButton>
        <AccountMenu viewer={viewer} side="bottom">
          <IconButton variant="ghost" color="gray" size="3" radius="full" aria-label={`Mon compte : ${viewer.name}`}>
            <Avatar size="2" radius="full" fallback={initial(viewer.name)} variant="solid" />
          </IconButton>
        </AccountMenu>
      </Flex>
    </header>
  );
}

const APPEARANCES: { value: Appearance; label: string; icon: typeof SunIcon }[] = [
  { value: "system", label: "Comme le système", icon: DesktopIcon },
  { value: "light", label: "Clair", icon: SunIcon },
  { value: "dark", label: "Sombre", icon: MoonIcon },
];

/** Le menu du compte : qui est connecté, le mot de passe, l'apparence, la déconnexion. */
function AccountMenu({ viewer, side, children }: { viewer: Viewer; side: "top" | "bottom"; children: ReactNode }) {
  const { appearance, change } = useAppearance();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" side={side} sideOffset={8} size="2" className="admin-menu">
        <DropdownMenu.Label className="admin-menu-who">
          <Flex direction="column">
            <Text size="2" weight="medium" highContrast>
              {viewer.name}
            </Text>
            <Text size="1" color="gray">
              {viewer.email} · {viewer.role === "admin" ? "admin" : "éditeur"}
            </Text>
          </Flex>
        </DropdownMenu.Label>
        <DropdownMenu.Separator />
        <DropdownMenu.Item asChild>
          <a href="/admin/mot-de-passe" data-astro-prefetch="false">
            <LockClosedIcon /> Changer de mot de passe
          </a>
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Label>Apparence</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={appearance} onValueChange={(value) => change(value as Appearance)}>
          {APPEARANCES.map((option) => {
            const Icon = option.icon;
            return (
              <DropdownMenu.RadioItem key={option.value} value={option.value}>
                <Icon /> {option.label}
              </DropdownMenu.RadioItem>
            );
          })}
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Separator />
        <DropdownMenu.Item color="red" onSelect={() => document.querySelector<HTMLFormElement>("#admin-logout")?.requestSubmit()}>
          <ExitIcon /> Se déconnecter
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

/** Le haut d'un écran de liste : le titre, une précision, et les actions principales à droite. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="admin-page-header">
      <Box minWidth="0">
        <Heading as="h1" size={{ initial: "6", sm: "7" }} weight="bold" className="admin-title">
          {title}
        </Heading>
        {description && (
          <Text as="p" size="2" color="gray" mt="1">
            {description}
          </Text>
        )}
      </Box>
      {actions && <div className="admin-page-actions">{actions}</div>}
    </header>
  );
}
