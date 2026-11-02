/**
 * L'accueil : de quoi savoir quoi faire en arrivant. Les prochaines diffusions, ce qui reste à compléter (chaque
 * ligne mène à la liste filtrée, avec le même nombre), les brouillons à reprendre, et les chiffres des rubriques.
 */
import { LABELS } from "@parabole/cms/labels";
import {
  ArrowRightIcon,
  BookmarkIcon,
  CheckCircledIcon,
  DiscIcon,
  FileTextIcon,
  ImageIcon,
  InfoCircledIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  PersonIcon,
  PlusIcon,
  SpeakerLoudIcon,
} from "@radix-ui/react-icons";
import { Badge, Button, Card, Flex, Heading, Kbd, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { PageHeader } from "./AdminShell";
import { useCommand } from "./CommandPalette";
import { StatusBadge, useModKey } from "./marks";
import { counted } from "./text";
import type { DashboardData, Viewer } from "./types";

export function Dashboard({ viewer, today, stats, upcoming, missing, drafts }: DashboardData & { viewer: Viewer }) {
  const firstName = viewer.name.split(" ")[0];
  const openCommand = useCommand();
  const mod = useModKey();
  const todo: { count: number; label: string; href: string; icon: ReactNode }[] = [
    { count: stats.shows.draft, label: `${stats.shows.draft > 1 ? "Shows" : "Show"} en brouillon`, href: "/admin/shows?status=draft", icon: <FileTextIcon /> },
    { count: missing.tracklist, label: `${missing.tracklist > 1 ? "Shows diffusés" : "Show diffusé"} sans tracklist`, href: "/admin/shows?missing=tracklist", icon: <ListBulletIcon /> },
    { count: missing.sound, label: `${missing.sound > 1 ? "Shows diffusés" : "Show diffusé"} sans son`, href: "/admin/shows?missing=sound", icon: <SpeakerLoudIcon /> },
    { count: stats.artists.draft, label: `${stats.artists.draft > 1 ? "Artistes" : "Artiste"} en brouillon`, href: "/admin/artistes?status=draft", icon: <FileTextIcon /> },
    { count: missing.photo, label: `${missing.photo > 1 ? "Artistes" : "Artiste"} sans photo`, href: "/admin/artistes?missing=photo", icon: <ImageIcon /> },
    { count: missing.bio, label: `${missing.bio > 1 ? "Artistes" : "Artiste"} sans bio`, href: "/admin/artistes?missing=bio", icon: <PersonIcon /> },
    { count: missing.tags, label: `${missing.tags > 1 ? "Étiquettes" : "Étiquette"} à classer dans les filtres`, href: "/admin/etiquettes?filtre=a-classer", icon: <BookmarkIcon /> },
  ].filter((item) => item.count > 0);

  return (
    <div className="admin-page">
      <PageHeader
        title={`Bonjour ${firstName}`}
        description={today.charAt(0).toUpperCase() + today.slice(1)}
        actions={
          <>
            <Button variant="soft" color="gray" onClick={openCommand} className="admin-hide-mobile">
              <MagnifyingGlassIcon /> Rechercher <Kbd size="1">{mod} K</Kbd>
            </Button>
            <Button asChild variant="soft">
              <a href="/admin/artistes/nouveau" data-astro-prefetch="false">
                <PlusIcon /> Nouvel artiste
              </a>
            </Button>
            <Button asChild>
              <a href="/admin/shows/nouveau" data-astro-prefetch="false">
                <PlusIcon /> Nouveau show
              </a>
            </Button>
          </>
        }
      />

      <div className="admin-dashboard">
        <Flex direction="column" gap="5" minWidth="0">
          <Panel title="Prochaines diffusions" action={<PanelLink href="/admin/shows">Tous les shows</PanelLink>}>
            {upcoming.length ? (
              <ul className="admin-rows">
                {upcoming.map((show) => (
                  <li key={show.href}>
                    <a className="admin-row-link" href={show.href} data-astro-prefetch="false">
                      <span className="admin-date-block" aria-hidden>
                        <span>{show.weekday}</span>
                        <strong>{show.dayOfMonth}</strong>
                        <span>{show.month}</span>
                      </span>
                      <span className="admin-row-main">
                        <Text as="span" size="2" weight="medium" highContrast className="admin-break">
                          {show.title}
                        </Text>
                        <Text as="span" size="1" color="gray">
                          {[`${show.when.charAt(0).toUpperCase()}${show.when.slice(1)}, ${show.time}`, LABELS.showType[show.type], show.artists].filter(Boolean).join(" · ")}
                        </Text>
                      </span>
                      {show.status === "draft" && <StatusBadge status="draft" />}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={<DiscIcon />}>Aucun show daté à venir. Les créneaux de Radio Cult arriveront ici quand l'import sera branché.</Empty>
            )}
          </Panel>

          <Panel title="Brouillons à reprendre" action={drafts.length ? <PanelLink href="/admin/shows?status=draft">Shows en brouillon</PanelLink> : undefined}>
            {drafts.length ? (
              <ul className="admin-rows">
                {drafts.map((draft) => (
                  <li key={draft.href}>
                    <a className="admin-row-link" href={draft.href} data-astro-prefetch="false">
                      <span className="admin-row-icon" aria-hidden>
                        {draft.kind === "show" ? <DiscIcon /> : <PersonIcon />}
                      </span>
                      <span className="admin-row-main">
                        <Text as="span" size="2" weight="medium" highContrast className="admin-break">
                          {draft.title}
                        </Text>
                        <Text as="span" size="1" color="gray">
                          {draft.kind === "show" ? "Show" : "Artiste"} · modifié {draft.since}
                        </Text>
                      </span>
                      <ArrowRightIcon className="admin-row-arrow" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={<CheckCircledIcon />}>Aucun brouillon en cours.</Empty>
            )}
          </Panel>
        </Flex>

        <Flex direction="column" gap="5" minWidth="0">
          <Panel title="À compléter">
            {todo.length ? (
              <ul className="admin-rows">
                {todo.map((item) => (
                  <li key={item.href}>
                    <a className="admin-row-link admin-todo" href={item.href} data-astro-prefetch="false">
                      <span className="admin-row-icon" aria-hidden>
                        {item.icon}
                      </span>
                      <Text as="span" size="2" className="admin-row-main">
                        {item.label}
                      </Text>
                      <Badge color="amber" variant="soft" radius="full" size="2">
                        {item.count}
                      </Badge>
                      <ArrowRightIcon className="admin-row-arrow" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={<CheckCircledIcon />}>Tout est à jour : chaque show diffusé a sa tracklist et son son, chaque artiste sa photo et sa bio.</Empty>
            )}
          </Panel>

          <Panel title="En chiffres">
            <div className="admin-stats">
              <Stat label="Shows" icon={<DiscIcon />} published={stats.shows.published} draft={stats.shows.draft} href="/admin/shows" />
              <Stat label="Artistes" icon={<PersonIcon />} published={stats.artists.published} draft={stats.artists.draft} href="/admin/artistes" />
            </div>
          </Panel>

          <Card size="2" variant="ghost" className="admin-note">
            <Flex gap="2" align="start">
              <InfoCircledIcon className="admin-note-icon" aria-hidden />
              <Text as="p" size="1" color="gray">
                Les pages Show et Residents du site ne lisent pas encore le CMS : ce qui est publié ici y apparaîtra quand elles seront branchées. Les
                images, les événements, les pages et l'équipe arrivent aux prochaines étapes.
              </Text>
            </Flex>
          </Card>
        </Flex>
      </div>
    </div>
  );
}

/** Un bloc de l'accueil : son titre, un lien à droite, son contenu. */
function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card size="2" className="admin-panel">
      <Flex justify="between" align="center" gap="3" mb="2">
        <Heading as="h2" size="3">
          {title}
        </Heading>
        {action}
      </Flex>
      {children}
    </Card>
  );
}

function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Text asChild size="2">
      <a className="admin-panel-link" href={href} data-astro-prefetch="false">
        {children} <ArrowRightIcon aria-hidden />
      </a>
    </Text>
  );
}

function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Flex gap="3" align="center" py="3" className="admin-empty-line">
      <span className="admin-row-icon" aria-hidden>
        {icon}
      </span>
      <Text as="p" size="2" color="gray">
        {children}
      </Text>
    </Flex>
  );
}

function Stat({ label, icon, published, draft, href }: { label: string; icon: ReactNode; published: number; draft: number; href: string }) {
  return (
    <a className="admin-stat" href={href} data-astro-prefetch="false">
      <Flex align="center" gap="2">
        <span className="admin-row-icon" aria-hidden>
          {icon}
        </span>
        <Text size="2" weight="medium">
          {label}
        </Text>
      </Flex>
      <Text as="p" size="7" weight="bold" mt="2" className="admin-stat-value">
        {published + draft}
      </Text>
      <Text as="p" size="1" color="gray">
        {counted(published, "publié")} · {draft} en brouillon
      </Text>
    </a>
  );
}
