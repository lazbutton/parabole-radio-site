/**
 * L'accueil : de quoi savoir quoi faire en arrivant. Les prochaines diffusions, puis ce qui reste à compléter, en un
 * seul bloc depuis les retours du 4 novembre 2026 : ce qui manque (chaque ligne mène à la liste filtrée, avec le même
 * nombre) et les derniers brouillons à reprendre. À droite, l'import de la programmation Radio Cult (son dernier
 * passage, ce qu'il reste à relire, et « Importer maintenant ») et les chiffres des rubriques. Créer une fiche se
 * fait depuis sa rubrique, ou la recherche (⌘K).
 */
import { LABELS } from "@parabole/cms/labels";
import {
  ArrowRightIcon,
  BookmarkIcon,
  CheckCircledIcon,
  DiscIcon,
  DownloadIcon,
  ExclamationTriangleIcon,
  FileTextIcon,
  ImageIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  PersonIcon,
  SpeakerLoudIcon,
  TextAlignLeftIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import { Badge, Button, Callout, Card, Flex, Heading, Kbd, Text } from "@radix-ui/themes";
import { useState, type ReactNode } from "react";
import { PageHeader } from "./AdminShell";
import { useCommand } from "./CommandPalette";
import { StatusBadge, useModKey } from "./marks";
import { useRouter } from "./router";
import { postForm } from "./sheet";
import { counted } from "./text";
import { useNotify } from "./toast";
import type { DashboardData, ImportLine, ImportResponse, RadioCultPanel, Viewer } from "./types";

/** « Émission diffusée », « Émissions diffusées » : le début d'une ligne de « À compléter ». */
const aired = (count: number) => (count > 1 ? "Émissions diffusées" : "Émission diffusée");

export function Dashboard({ viewer, today, stats, upcoming, missing, drafts, radiocult }: DashboardData & { viewer: Viewer }) {
  const firstName = viewer.name.split(" ")[0];
  const openCommand = useCommand();
  const mod = useModKey();
  const todo: { count: number; label: string; href: string; icon: ReactNode }[] = [
    { count: stats.shows.draft, label: `${stats.shows.draft > 1 ? "Émissions" : "Émission"} en brouillon`, href: "/admin/shows?status=draft", icon: <FileTextIcon /> },
    { count: missing.tracklist, label: `${aired(missing.tracklist)} sans tracklist`, href: "/admin/shows?missing=tracklist", icon: <ListBulletIcon /> },
    { count: missing.sound, label: `${aired(missing.sound)} sans son`, href: "/admin/shows?missing=sound", icon: <SpeakerLoudIcon /> },
    { count: missing.cover, label: `${aired(missing.cover)} sans pochette`, href: "/admin/shows?missing=cover", icon: <ImageIcon /> },
    { count: missing.description, label: `${aired(missing.description)} sans description`, href: "/admin/shows?missing=description", icon: <TextAlignLeftIcon /> },
    { count: missing.untagged, label: `${aired(missing.untagged)} sans étiquette`, href: "/admin/shows?missing=tags", icon: <BookmarkIcon /> },
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
          <Button variant="soft" color="gray" onClick={openCommand} className="admin-hide-mobile">
            <MagnifyingGlassIcon /> Rechercher <Kbd size="1">{mod} K</Kbd>
          </Button>
        }
      />

      <div className="admin-dashboard">
        <Flex direction="column" gap="5" minWidth="0">
          <Panel title="Prochaines diffusions" action={<PanelLink href="/admin/shows">Toutes les émissions</PanelLink>}>
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
              <Empty icon={<DiscIcon />}>Aucune émission datée à venir. Les créneaux de Radio Cult arrivent ici chaque nuit, ou avec « Importer maintenant ».</Empty>
            )}
          </Panel>

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
              <Empty icon={<CheckCircledIcon />}>Tout est à jour : chaque émission diffusée est complète, chaque artiste a sa photo et sa bio.</Empty>
            )}
            {drafts.length > 0 && (
              <>
                <Text as="p" size="1" weight="medium" color="gray" mt="4" mb="1">
                  Derniers brouillons modifiés
                </Text>
                <ul className="admin-rows">
                  {drafts.slice(0, SHOWN).map((draft) => (
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
                            {draft.kind === "show" ? "Émission" : "Artiste"} · modifié{draft.kind === "show" ? "e" : ""} {draft.since}
                          </Text>
                        </span>
                        <ArrowRightIcon className="admin-row-arrow" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        </Flex>

        <Flex direction="column" gap="5" minWidth="0">
          <RadioCult panel={radiocult} />

          <Panel title="En chiffres">
            <div className="admin-stats">
              <Stat label="Émissions" icon={<DiscIcon />} published={counted(stats.shows.published, "publiée")} draft={stats.shows.draft} total={stats.shows.published + stats.shows.draft} href="/admin/shows" />
              <Stat label="Résidents" icon={<PersonIcon />} published={counted(stats.artists.published, "publié")} draft={stats.artists.draft} total={stats.artists.published + stats.artists.draft} href="/admin/artistes" />
            </div>
          </Panel>

        </Flex>
      </div>
    </div>
  );
}

/** Les lignes montrées par groupe : au-delà, le nombre des autres. */
const SHOWN = 5;

/**
 * L'import de la programmation Radio Cult (cms/README.md, 9.4) : le dernier passage, puis ce qu'il reste à relire,
 * d'abord ce qui demande une correction (un show publié dont le créneau a bougé, un créneau disparu), puis les
 * brouillons créés ou mis à jour et les artistes créés. « Importer maintenant » lance l'import tout de suite, au nom
 * de la personne connectée, et l'accueil se met à jour.
 */
function RadioCult({ panel }: { panel: RadioCultPanel }) {
  const router = useRouter();
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const { last, lastOk } = panel;
  const fixes = [...panel.moved, ...panel.gone];
  const quiet = !fixes.length && !panel.created.length && !panel.updated.length && !panel.artists.length;

  async function run() {
    setBusy(true);
    const body = new FormData();
    body.set("intent", "radiocult");
    const result = await postForm<ImportResponse>("/admin", body);
    setBusy(false);
    if ("data" in result) {
      // Les listes (shows, artistes) ont changé ; l'accueil prend ses nouvelles données.
      router.invalidate();
      router.replace("/admin", { name: "dashboard", title: "Accueil", data: result.data });
    }
    if (result.ok) notify({ kind: "success", title: "Programmation importée", description: result.message });
    else notify({ kind: "error", title: "Import impossible", description: "errors" in result ? result.errors.form : result.message });
  }

  if (panel.unavailable)
    return (
      <Panel title="Programmation Radio Cult">
        <Callout.Root color="amber" size="1" variant="surface">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{panel.unavailable}</Callout.Text>
        </Callout.Root>
      </Panel>
    );

  return (
    <Panel title="Programmation Radio Cult">
      {!last ? (
        <Text as="p" size="2" color="gray" mb="2">
          Pas encore d'import. Il passe chaque nuit vers 6 h et crée un brouillon pour chaque créneau des 14 jours à venir ; « Importer maintenant » le
          lance tout de suite.
        </Text>
      ) : last.ok ? (
        <Text as="p" size="2" color="gray" mb="2" title={last.date}>
          Dernier import {last.when}, par {last.by} : {last.summary.charAt(0).toLowerCase() + last.summary.slice(1)}
        </Text>
      ) : (
        <Callout.Root color="red" size="1" variant="surface" mb="3">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            Le dernier import, {last.when} ({last.by}), n'a rien changé : {last.summary}
            {lastOk ? ` Le précédent, ${lastOk.when}, avait réussi.` : ""}
          </Callout.Text>
        </Callout.Root>
      )}
      <Flex mb="1">
        <Button size="1" variant="soft" loading={busy} onClick={() => void run()}>
          <DownloadIcon /> Importer maintenant
        </Button>
      </Flex>

      {fixes.length > 0 && (
        <ImportGroup
          label="À corriger à la main"
          hint="L'import ne touche ni aux émissions publiées ni aux créneaux disparus : corrige la fiche, ou le créneau chez Radio Cult."
          lines={fixes}
          icon={<ExclamationTriangleIcon />}
          alert
        />
      )}
      {panel.created.length > 0 && <ImportGroup label="Nouveaux brouillons" lines={panel.created} icon={<FileTextIcon />} />}
      {panel.updated.length > 0 && <ImportGroup label="Brouillons mis à jour" lines={panel.updated} icon={<UpdateIcon />} />}
      {panel.artists.length > 0 && <ImportGroup label="Artistes créés" lines={panel.artists} icon={<PersonIcon />} />}
      {last?.ok && quiet && <Empty icon={<CheckCircledIcon />}>Rien à relire : les émissions suivent la programmation.</Empty>}

      {(panel.notes.length > 0 || !panel.key) && (
        <Flex direction="column" gap="1" mt="2">
          {[...new Set([...panel.notes, ...(panel.key ? [] : ["Sans la clé publishable de Radio Cult (PUBLIC_RADIOCULT_KEY), les artistes des créneaux ne sont pas lus."])])].map((note) => (
            <Text key={note} as="p" size="1" color="gray">
              {note}
            </Text>
          ))}
        </Flex>
      )}
    </Panel>
  );
}

/** Un groupe de fiches citées par l'import : son titre, une aide, et les premières lignes. */
function ImportGroup({ label, hint, lines, icon, alert }: { label: string; hint?: string; lines: ImportLine[]; icon: ReactNode; alert?: boolean }) {
  return (
    <Flex direction="column" gap="1" mt="2">
      <Text as="p" size="1" weight="medium" color={alert ? "amber" : "gray"}>
        {label} · {lines.length}
      </Text>
      {hint && (
        <Text as="p" size="1" color="gray">
          {hint}
        </Text>
      )}
      <ul className="admin-rows">
        {lines.slice(0, SHOWN).map((line) => (
          <li key={line.href + line.detail}>
            <a className={`admin-row-link${alert ? " admin-todo" : ""}`} href={line.href} data-astro-prefetch="false">
              <span className="admin-row-icon" aria-hidden>
                {icon}
              </span>
              <span className="admin-row-main">
                <Text as="span" size="2" weight="medium" highContrast className="admin-break">
                  {line.title}
                </Text>
                <Text as="span" size="1" color="gray">
                  {line.detail}
                </Text>
              </span>
              <ArrowRightIcon className="admin-row-arrow" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
      {lines.length > SHOWN && (
        <Text as="p" size="1" color="gray">
          Et {counted(lines.length - SHOWN, "autre")}.
        </Text>
      )}
    </Flex>
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

function Stat({ label, icon, published, draft, total, href }: { label: string; icon: ReactNode; published: string; draft: number; total: number; href: string }) {
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
        {total}
      </Text>
      <Text as="p" size="1" color="gray">
        {published} · {draft} en brouillon
      </Text>
    </a>
  );
}
