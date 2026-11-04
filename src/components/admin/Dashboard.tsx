/**
 * L'accueil : de quoi savoir quoi faire en arrivant. Les prochaines diffusions, les envois des résidents pour la
 * prochaine deadline (qui a envoyé, qui relancer), ce qui reste à compléter (chaque ligne mène à la liste filtrée, avec
 * le même nombre), les brouillons à reprendre, les chiffres des rubriques, et l'import de la programmation Radio Cult :
 * son dernier passage, ce qu'il reste à relire, et « Importer maintenant ».
 */
import { LABELS } from "@parabole/cms/labels";
import {
  ArrowRightIcon,
  BookmarkIcon,
  CalendarIcon,
  CheckCircledIcon,
  CopyIcon,
  DiscIcon,
  DownloadIcon,
  ExclamationTriangleIcon,
  FileTextIcon,
  ImageIcon,
  InfoCircledIcon,
  LayersIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  PersonIcon,
  PlayIcon,
  PlusIcon,
  SpeakerLoudIcon,
  UpdateIcon,
} from "@radix-ui/react-icons";
import { Badge, Button, Callout, Card, Dialog, Flex, Heading, IconButton, Kbd, Select, Text, TextField } from "@radix-ui/themes";
import { useState, type ReactNode } from "react";
import { PageHeader } from "./AdminShell";
import { useCommand } from "./CommandPalette";
import { StatusBadge, useModKey } from "./marks";
import { useRouter } from "./router";
import { Field, postForm } from "./sheet";
import { counted } from "./text";
import { useNotify } from "./toast";
import type { CycleResponse, DashboardData, DeadlineView, ImportLine, ImportResponse, RadioCultPanel, Viewer } from "./types";

export function Dashboard({ viewer, today, stats, upcoming, missing, envois, deadlines, cycle, drafts, radiocult }: DashboardData & { viewer: Viewer }) {
  const firstName = viewer.name.split(" ")[0];
  const openCommand = useCommand();
  const mod = useModKey();
  const todo: { count: number; label: string; href: string; icon: ReactNode }[] = [
    { count: envois.review, label: `${envois.review > 1 ? "Sons envoyés" : "Son envoyé"} à écouter`, href: "/admin/shows?missing=review", icon: <PlayIcon /> },
    { count: envois.failed, label: `${envois.failed > 1 ? "Publications" : "Publication"} SoundCloud en échec`, href: "/admin/shows?missing=failed", icon: <ExclamationTriangleIcon /> },
    { count: envois.assemble, label: `${envois.assemble > 1 ? "Playlists" : "Playlist"} à assembler`, href: "/admin/shows?missing=assemble", icon: <LayersIcon /> },
    { count: envois.slot, label: `${envois.slot > 1 ? "Envois" : "Envoi"} sans créneau`, href: "/admin/shows?missing=slot", icon: <CalendarIcon /> },
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
              <Empty icon={<DiscIcon />}>Aucun show daté à venir. Les créneaux de Radio Cult arrivent ici chaque nuit, ou avec « Importer maintenant ».</Empty>
            )}
          </Panel>

          <Deadlines deadlines={deadlines} cycle={cycle} admin={viewer.role === "admin"} />

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
          <RadioCult panel={radiocult} />

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

/**
 * Les envois des résidents (cms/README.md, 9.12) : pour la deadline qui vient de passer (tant que son bloc n'a pas
 * commencé) puis pour la prochaine, qui a envoyé, et qui relancer, avec son lien d'envoi à copier. Un admin y règle le
 * calendrier des groupes.
 */
function Deadlines({ deadlines, cycle, admin }: { deadlines: DeadlineView[]; cycle: DashboardData["cycle"]; admin: boolean }) {
  const notify = useNotify();
  const [setting, setSetting] = useState(false);

  async function copy(name: string, link: string) {
    try {
      await navigator.clipboard.writeText(`${location.origin}${link}`);
      notify({ kind: "success", title: "Lien copié", description: `Le lien d'envoi de ${name}, à lui envoyer.` });
    } catch {
      notify({ kind: "error", title: "Copie impossible", description: "Ouvre sa fiche : le lien y est, à copier à la main." });
    }
  }

  return (
    <Panel
      title="Envois des résidents"
      action={
        admin ? (
          <Button size="1" variant="ghost" color="gray" onClick={() => setSetting(true)}>
            <CalendarIcon /> Calendrier
          </Button>
        ) : undefined
      }
    >
      {!cycle ? (
        <Empty icon={<CalendarIcon />}>
          Le calendrier des groupes n'est pas réglé : {admin ? "règle-le avec « Calendrier »" : "un admin le règle depuis l'accueil"}, puis mets chaque résident dans son
          groupe depuis sa fiche.
        </Empty>
      ) : (
        <Flex direction="column" gap="4">
          {deadlines.map((panel) => {
            const missing = panel.residents.filter((resident) => !resident.sent);
            return (
              <div key={`${panel.group}-${panel.block}`} className="admin-deadline">
                <Flex align="center" gap="2" wrap="wrap">
                  <Text size="2" weight="bold">
                    Groupe {panel.group}
                  </Text>
                  {panel.late && <Badge color="red">Deadline passée</Badge>}
                </Flex>
                <Text as="p" size="1" color="gray">
                  Bloc {panel.block}
                </Text>
                <Text as="p" size="1" color={panel.late ? "red" : "gray"}>
                  {panel.late ? `Deadline passée le ${panel.deadline} (${panel.when}) : les retardataires.` : `Deadline le ${panel.deadline}, ${panel.when}.`}
                </Text>
                {panel.residents.length ? (
                  <>
                    <Text as="p" size="2" mt="2">
                      {panel.sent} {panel.sent > 1 ? "envois" : "envoi"} sur {counted(panel.residents.length, "résident")}
                    </Text>
                    {missing.length > 0 ? (
                      <ul className="admin-rows admin-deadline-list">
                        {missing.map((resident) => (
                          <li key={resident.id} className="admin-deadline-row">
                            <a className="admin-row-link" href={`/admin/artistes/${resident.id}`} data-astro-prefetch="false">
                              <span className="admin-row-icon" aria-hidden>
                                <PersonIcon />
                              </span>
                              <Text as="span" size="2" className="admin-row-main">
                                {resident.name}
                              </Text>
                              {!resident.link && (
                                <Text as="span" size="1" color="gray">
                                  sans lien
                                </Text>
                              )}
                            </a>
                            {resident.link && (
                              <IconButton size="1" variant="ghost" color="gray" aria-label={`Copier le lien d'envoi de ${resident.name}`} title="Copier son lien d'envoi" onClick={() => void copy(resident.name, resident.link!)}>
                                <CopyIcon />
                              </IconButton>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Text as="p" size="2" color="green">
                        Tout le groupe a envoyé.
                      </Text>
                    )}
                  </>
                ) : (
                  <Text as="p" size="2" color="gray" mt="2">
                    Personne dans le groupe {panel.group} : mets chaque résident dans son groupe depuis sa fiche.
                  </Text>
                )}
              </div>
            );
          })}
        </Flex>
      )}
      {admin && <CycleDialog open={setting} cycle={cycle} onClose={() => setSetting(false)} />}
    </Panel>
  );
}

const BLOCK_WEEKS = [1, 2, 3, 4];

/** Le calendrier des groupes : un lundi où le groupe 1 commence un bloc, la durée d'un bloc, la deadline. Un admin seulement. */
function CycleDialog({ open, cycle, onClose }: { open: boolean; cycle: DashboardData["cycle"]; onClose(): void }) {
  const router = useRouter();
  const notify = useNotify();
  const [values, setValues] = useState({ group1Start: cycle?.group1Start ?? "", blockDays: String(cycle?.blockDays ?? 14), deadlineDays: String(cycle?.deadlineDays ?? 15) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const body = new FormData();
    body.set("intent", "cycle");
    for (const [name, value] of Object.entries(values)) body.set(name, value);
    const result = await postForm<CycleResponse>("/admin", body);
    setBusy(false);
    if (!result.ok) {
      setErrors(result.errors);
      return notify({ kind: "error", title: "Calendrier pas enregistré", description: result.errors.form ?? "Corrige les champs signalés." });
    }
    setErrors({});
    onClose();
    router.replace("/admin", { name: "dashboard", title: "Accueil", data: result.data });
    notify({ kind: "success", title: result.message });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Content maxWidth="460px">
        <Dialog.Title>Le calendrier des groupes</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          Les deux groupes alternent à l'antenne, bloc après bloc, du lundi au dimanche. Les deadlines des envois en découlent.
        </Dialog.Description>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Flex direction="column" gap="4">
            <Field label="Un bloc du groupe 1 commence le" htmlFor="cycle-start" hint="Un lundi, passé ou à venir : les blocs suivants s'enchaînent depuis lui." error={errors.group1Start}>
              <TextField.Root id="cycle-start" type="date" value={values.group1Start} onChange={(event) => setValues({ ...values, group1Start: event.target.value })} color={errors.group1Start ? "red" : undefined} />
            </Field>
            <Field label="Durée d'un bloc" htmlFor="cycle-days" error={errors.blockDays}>
              <Select.Root value={values.blockDays} onValueChange={(blockDays) => setValues({ ...values, blockDays })}>
                <Select.Trigger id="cycle-days" />
                <Select.Content position="popper">
                  {BLOCK_WEEKS.map((weeks) => (
                    <Select.Item key={weeks} value={String(weeks * 7)}>
                      {counted(weeks, "semaine")}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Field>
            <Field label="Deadline, en jours avant le début du bloc" htmlFor="cycle-deadline" hint="15 : le dimanche, deux semaines avant le lundi du bloc." error={errors.deadlineDays}>
              <TextField.Root id="cycle-deadline" type="number" min={1} max={60} value={values.deadlineDays} onChange={(event) => setValues({ ...values, deadlineDays: event.target.value })} color={errors.deadlineDays ? "red" : undefined} />
            </Field>
            {errors.form && (
              <Text size="2" color="red" role="alert">
                {errors.form}
              </Text>
            )}
            <Flex gap="3" justify="end">
              <Dialog.Close>
                <Button type="button" variant="soft" color="gray">
                  Annuler
                </Button>
              </Dialog.Close>
              <Button type="submit" loading={busy}>
                Enregistrer
              </Button>
            </Flex>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
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
          hint="L'import ne touche ni aux shows publiés ni aux créneaux disparus : corrige la fiche, ou le créneau chez Radio Cult."
          lines={fixes}
          icon={<ExclamationTriangleIcon />}
          alert
        />
      )}
      {panel.created.length > 0 && <ImportGroup label="Nouveaux brouillons" lines={panel.created} icon={<FileTextIcon />} />}
      {panel.updated.length > 0 && <ImportGroup label="Brouillons mis à jour" lines={panel.updated} icon={<UpdateIcon />} />}
      {panel.artists.length > 0 && <ImportGroup label="Artistes créés" lines={panel.artists} icon={<PersonIcon />} />}
      {last?.ok && quiet && <Empty icon={<CheckCircledIcon />}>Rien à relire : les shows suivent la programmation.</Empty>}

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
