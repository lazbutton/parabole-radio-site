/**
 * La coque de l'application d'admin, en Radix Themes : l'en-tête (Parabole Radio, le compte), les onglets des
 * rubriques, l'indicateur de chargement, et la place de l'écran affiché. Elle reste en place quand on change d'écran
 * (router.tsx). La connexion, elle, garde le design du site (src/layouts/AdminGate.astro).
 */
import { ChevronDownIcon, ExitIcon, LockClosedIcon } from "@radix-ui/react-icons";
import { Avatar, Badge, Box, Button, Container, DropdownMenu, Flex, Heading, TabNav, Text } from "@radix-ui/themes";
import { useEffect, useRef, useState, type ReactNode } from "react";
import logo from "../../assets/logo-barre.png";
import { useRouter } from "./router";
import type { Screen, Viewer } from "./types";

const SECTIONS: { href: string; label: string; screens: Screen["name"][] }[] = [
  { href: "/admin", label: "Tableau de bord", screens: ["dashboard"] },
  { href: "/admin/shows", label: "Shows", screens: ["shows", "show"] },
  { href: "/admin/artistes", label: "Artistes", screens: ["artists", "artist"] },
];

export function AdminShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  const { screen, loading } = useRouter();
  const logout = useRef<HTMLFormElement>(null);
  const initial = viewer.name.trim().charAt(0).toUpperCase() || "?";
  // Le titre du nouvel écran, pour les lecteurs d'écran : la page, elle, ne se recharge pas.
  const [announced, setAnnounced] = useState("");
  const firstTitle = useRef(screen.title);
  useEffect(() => {
    if (screen.title !== firstTitle.current) setAnnounced(screen.title);
    firstTitle.current = "";
  }, [screen.title]);
  return (
    <>
      <header className="admin-header">
        <Flex align="center" justify="between" gap="3" className="admin-bar">
          <a className="admin-brand" href="/admin" data-astro-prefetch="false">
            <span className="admin-logo">
              <img src={logo.src} width={22} height={22} alt="" />
            </span>
            <Text size="3" weight="bold">
              Parabole Radio
            </Text>
            <Text size="2" color="gray" className="admin-hide-mobile">
              Administration
            </Text>
          </a>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button variant="ghost" color="gray" size="2" aria-label={`Mon compte : ${viewer.name}`}>
                <Avatar size="1" radius="full" fallback={initial} color="indigo" />
                <span className="admin-hide-mobile">{viewer.name}</span>
                <ChevronDownIcon />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" sideOffset={6}>
              <DropdownMenu.Label>
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
              <DropdownMenu.Item color="red" onSelect={() => logout.current?.requestSubmit()}>
                <ExitIcon /> Se déconnecter
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Flex>
        <TabNav.Root className="admin-tabs" aria-label="Rubriques de l'admin">
          {SECTIONS.map((item) => (
            <TabNav.Link key={item.href} href={item.href} active={item.screens.includes(screen.name)} data-astro-prefetch="false">
              {item.label}
            </TabNav.Link>
          ))}
        </TabNav.Root>
        <div className="admin-progress" data-active={loading || undefined} aria-hidden />
      </header>
      <form ref={logout} method="post" action="/admin/deconnexion" hidden />
      <Container size="4" px={{ initial: "4", sm: "5", md: "6" }} py={{ initial: "4", sm: "5" }} className="admin-main">
        {children}
      </Container>
      <p className="admin-sr-only" aria-live="polite" aria-atomic="true">
        {announced}
      </p>
    </>
  );
}

/** Le haut d'un écran : le fil d'Ariane, le titre, une précision, et les actions principales à droite. */
export function PageHeader({
  title,
  description,
  crumbs,
  badge,
  actions,
}: {
  title: string;
  description?: ReactNode;
  crumbs?: { label: string; href: string }[];
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Flex className="admin-page-header" justify="between" align={{ initial: "start", sm: "end" }} gap="3" wrap="wrap" mb="5">
      <Box minWidth="0">
        {crumbs && (
          <Flex gap="2" align="center" mb="1" asChild>
            <nav aria-label="Fil d'Ariane">
              {crumbs.map((crumb) => (
                <Text key={crumb.href} size="2" color="gray" asChild>
                  <a className="admin-crumb" href={crumb.href} data-astro-prefetch="false">
                    {crumb.label}
                  </a>
                </Text>
              ))}
              <Text size="2" color="gray" aria-hidden>
                /
              </Text>
            </nav>
          </Flex>
        )}
        <Flex align="center" gap="3" wrap="wrap">
          <Heading as="h1" size={{ initial: "6", sm: "7" }} weight="bold" className="admin-title">
            {title}
          </Heading>
          {badge}
        </Flex>
        {description && (
          <Text as="p" size="2" color="gray" mt="1">
            {description}
          </Text>
        )}
      </Box>
      {actions && (
        <Flex gap="2" wrap="wrap" className="admin-page-actions">
          {actions}
        </Flex>
      )}
    </Flex>
  );
}

/** Brouillon ou publié. */
export function StatusBadge({ status, size = "2" }: { status: "draft" | "published"; size?: "1" | "2" | "3" }) {
  return status === "published" ? (
    <Badge color="green" size={size} radius="full">
      Publié
    </Badge>
  ) : (
    <Badge color="gray" size={size} radius="full">
      Brouillon
    </Badge>
  );
}
