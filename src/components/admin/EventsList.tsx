/**
 * Les événements : tous, brouillons compris, en deux parties titrées (retours du 4 novembre 2026) : « À venir » (du
 * plus proche au plus lointain), puis « Passés », rangés par mois. La recherche et les filtres de cms/README.md (9.2)
 * en pastilles — période, catégorie, statut — s'appliquent sans recharger la page, et vivent dans l'adresse, comme pour
 * les émissions. Chaque ligne dit d'un coup d'œil ce qu'a l'événement (son visuel, ses photos), et finit par son menu :
 * Modifier, Supprimer.
 */
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, DotsHorizontalIcon, ImageIcon, Pencil1Icon, PlusIcon, StackIcon, TrashIcon } from "@radix-ui/react-icons";
import { AlertDialog, Button, Card, DropdownMenu, Flex, Heading, IconButton, Link, Select, Table, Text, Tooltip } from "@radix-ui/themes";
import { Fragment, useState, type ReactNode } from "react";
import { PageHeader } from "./AdminShell";
import { FilterPill, listHref, SearchField, TagFilterPill, useListFilters } from "./filters";
import { StatusBadge } from "./marks";
import { forgetRecent } from "./recents";
import { useRouter } from "./router";
import { postForm } from "./sheet";
import { counted } from "./text";
import { useNotify } from "./toast";
import type { EventFilters, EventRow, EventsListData } from "./types";

const hrefOf = (filters: EventFilters, page?: number) => listHref("/admin/evenements", filters, { page });

const PERIODS: Record<string, string> = { upcoming: "À venir", past: "Passés" };

/** Les passés, rangés par mois de début, dans l'ordre de la liste. */
function byMonth(rows: EventRow[]) {
  const groups: { label: string; rows: EventRow[] }[] = [];
  for (const row of rows) {
    const label = row.month;
    const last = groups.at(-1);
    if (last?.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

export function EventsList({ rows, total, page, pages, filters, tags }: EventsListData) {
  const router = useRouter();
  const { loading } = router;
  const notify = useNotify();
  const { shown, set, goToPage, query } = useListFilters(filters, hrefOf);
  const filtered = Boolean(filters.q || filters.status || filters.period || filters.tag);
  const [removing, setRemoving] = useState<EventRow | null>(null);
  const [busy, setBusy] = useState(false);
  const upcoming = rows.filter((row) => row.upcoming);
  const past = rows.filter((row) => !row.upcoming);

  /** Supprime l'événement choisi dans le menu d'une ligne, puis recharge la liste là où l'on était. */
  async function remove(row: EventRow) {
    setBusy(true);
    const body = new FormData();
    body.set("intent", "delete");
    const href = `/admin/evenements/${row.id}`;
    const result = await postForm<{ ok: true; redirect: string; message?: string }>(href, body);
    setBusy(false);
    setRemoving(null);
    if (!result.ok) return notify({ kind: "error", title: "Suppression impossible", description: result.errors.form });
    forgetRecent(href);
    router.invalidate();
    notify({ kind: "success", title: result.message ?? "Événement supprimé" });
    router.navigate(location.pathname + location.search, { replace: true, keepScroll: true });
  }

  return (
    <div className="admin-page">
      <PageHeader
        title="Événements"
        description={`${counted(total, "événement")}${filtered ? " pour ces filtres" : ""}`}
        actions={
          <Button asChild>
            <a href="/admin/evenements/nouveau" data-astro-prefetch="false">
              <PlusIcon /> Nouvel événement
            </a>
          </Button>
        }
      />
      <div className="admin-toolbar">
        <SearchField query={query} placeholder="Rechercher un titre, un lieu, un artiste…" />
        <div className="admin-pills">
          <FilterPill label="Période" allLabel="À venir et passés" value={shown.period} valueLabel={PERIODS[shown.period]} onChange={(period) => set({ period })}>
            <Select.Item value="upcoming">À venir</Select.Item>
            <Select.Item value="past">Passés</Select.Item>
          </FilterPill>
          {tags.length > 0 && <TagFilterPill label="Catégorie" allLabel="Toutes les catégories" menu={tags} value={shown.tag} onChange={(tag) => set({ tag })} />}
          <FilterPill label="Statut" allLabel="Tous les statuts" value={shown.status} valueLabel={shown.status === "draft" ? "Brouillons" : "Publiés"} onChange={(status) => set({ status })}>
            <Select.Item value="published">Publiés</Select.Item>
            <Select.Item value="draft">Brouillons</Select.Item>
          </FilterPill>
          {filtered && (
            <Button variant="ghost" color="gray" size="2" asChild>
              <a href="/admin/evenements" data-astro-prefetch="false">
                Effacer les filtres
              </a>
            </Button>
          )}
        </div>
      </div>

      <div className="admin-results" data-loading={loading || undefined}>
        {rows.length ? (
          <Flex direction="column" gap="6">
            {upcoming.length > 0 && (
              <EventSection title="À venir" count={pages === 1 ? upcoming.length : undefined}>
                {upcoming.map((row) => (
                  <EventLine key={row.id} row={row} onRemove={() => setRemoving(row)} />
                ))}
              </EventSection>
            )}
            {past.length > 0 && (
              <EventSection title="Passés" count={pages === 1 ? past.length : undefined}>
                {byMonth(past).map((group) => (
                  <Fragment key={group.label}>
                    <Table.Row className="admin-group">
                      <Table.Cell colSpan={5}>
                        <Flex align="center" gap="2">
                          <Text size="2" weight="bold" highContrast>
                            {group.label}
                          </Text>
                          <Text size="1" color="gray">
                            {group.rows.length}
                          </Text>
                        </Flex>
                      </Table.Cell>
                    </Table.Row>
                    {group.rows.map((row) => (
                      <EventLine key={row.id} row={row} onRemove={() => setRemoving(row)} />
                    ))}
                  </Fragment>
                ))}
              </EventSection>
            )}
          </Flex>
        ) : (
          <Card size="3" className="admin-empty-card">
            <Flex direction="column" align="center" gap="3" py="6">
              <span className="admin-empty-icon" aria-hidden>
                <CalendarIcon width="22" height="22" />
              </span>
              <Text size="3" weight="medium">
                {filtered ? "Aucun événement pour ces filtres" : "Pas encore d'événement"}
              </Text>
              <Text size="2" color="gray" align="center">
                {filtered ? "Essaie une autre recherche, ou retire un filtre." : "Une soirée, un atelier, une rencontre : son titre, sa date, son lieu, son visuel, et ses photos une fois passé."}
              </Text>
              {filtered ? (
                <Button variant="soft" asChild>
                  <a href="/admin/evenements" data-astro-prefetch="false">
                    Effacer les filtres
                  </a>
                </Button>
              ) : (
                <Button asChild>
                  <a href="/admin/evenements/nouveau" data-astro-prefetch="false">
                    <PlusIcon /> Créer le premier
                  </a>
                </Button>
              )}
            </Flex>
          </Card>
        )}

        {pages > 1 && (
          <Flex justify="between" align="center" mt="4" gap="3">
            <Text size="2" color="gray">
              Page {page} sur {pages}
            </Text>
            <Flex gap="2">
              <Button variant="soft" color="gray" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
                <ChevronLeftIcon /> Précédente
              </Button>
              <Button variant="soft" color="gray" disabled={page >= pages} onClick={() => goToPage(page + 1)}>
                Suivante <ChevronRightIcon />
              </Button>
            </Flex>
          </Flex>
        )}
      </div>

      <AlertDialog.Root open={removing !== null} onOpenChange={(open) => !open && !busy && setRemoving(null)}>
        <AlertDialog.Content maxWidth="460px">
          <AlertDialog.Title>Supprimer « {removing?.title} » ?</AlertDialog.Title>
          <AlertDialog.Description size="2">L'événement, son visuel, ses photos et ses liens aux artistes et aux catégories seront supprimés. C'est définitif.</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" disabled={busy}>
                Annuler
              </Button>
            </AlertDialog.Cancel>
            <Button color="red" loading={busy} onClick={() => removing && void remove(removing)}>
              <TrashIcon /> Supprimer
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  );
}

/** Une partie de la liste, sous son titre : « À venir », « Passés ». */
function EventSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <Flex align="baseline" gap="2" mb="2">
        <Heading as="h2" size="4">
          {title}
        </Heading>
        {count !== undefined && (
          <Text size="2" color="gray">
            {count}
          </Text>
        )}
      </Flex>
      <Table.Root variant="ghost" size="2" className="admin-table admin-events-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Événement</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell className="admin-hide-mobile admin-col-date">Date</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell className="admin-hide-tablet admin-col-images">Images</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell justify="end" className="admin-col-status">
              Statut
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell className="admin-row-actions">
              <span className="admin-sr-only">Actions</span>
            </Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>{children}</Table.Body>
      </Table.Root>
    </section>
  );
}

/** Une ligne : la vignette d'un événement, le titre et ce qu'on en sait (catégorie, lieu, artistes), la date, les images, le statut. */
function EventLine({ row, onRemove }: { row: EventRow; onRemove(): void }) {
  const href = `/admin/evenements/${row.id}`;
  const about = [row.categories, row.venue, row.artists].filter(Boolean).join(" · ");
  return (
    <Table.Row className="admin-row" data-href={href}>
      <Table.RowHeaderCell>
        <Flex align="center" gap="3">
          <span className="admin-type-tile admin-event-tile" aria-hidden>
            <CalendarIcon />
          </span>
          <Flex direction="column" minWidth="0">
            <Link href={href} weight="medium" highContrast underline="hover" data-astro-prefetch="false" className="admin-break">
              {row.title}
            </Link>
            <Text size="1" color="gray" className="admin-break">
              {about || "Sans catégorie"}
              <span className="admin-show-mobile">
                {" · "}
                {row.day}
              </span>
            </Text>
          </Flex>
        </Flex>
      </Table.RowHeaderCell>
      <Table.Cell className="admin-hide-mobile">
        <Text as="div" size="2" className="admin-nowrap">
          {row.day}
        </Text>
        {row.time && (
          <Text as="div" size="1" color="gray" className="admin-nowrap">
            {row.time}
          </Text>
        )}
      </Table.Cell>
      <Table.Cell className="admin-hide-tablet">
        <Flex align="center" gap="3">
          <Tooltip content={row.hasVisual ? "Visuel en place" : "Pas de visuel"}>
            <span className="admin-fact" data-off={!row.hasVisual || undefined}>
              <ImageIcon aria-hidden />
              <span className="admin-sr-only">{row.hasVisual ? "visuel en place" : "pas de visuel"}</span>
            </span>
          </Tooltip>
          <Tooltip content={row.photos ? counted(row.photos, "photo") : "Pas de photo"}>
            <span className="admin-fact" data-off={!row.photos || undefined}>
              <StackIcon aria-hidden /> {row.photos || "—"}
              <span className="admin-sr-only">{row.photos ? counted(row.photos, "photo") : "pas de photo"}</span>
            </span>
          </Tooltip>
        </Flex>
      </Table.Cell>
      <Table.Cell justify="end">
        <StatusBadge status={row.status} />
      </Table.Cell>
      <Table.Cell justify="end" className="admin-row-actions">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <IconButton size="1" variant="ghost" color="gray" aria-label={`Modifier ou supprimer « ${row.title} »`}>
              <DotsHorizontalIcon />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" size="2" className="admin-menu">
            <DropdownMenu.Item asChild>
              <a href={href} data-astro-prefetch="false">
                <Pencil1Icon /> Modifier
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item color="red" onSelect={onRemove}>
              <TrashIcon /> Supprimer…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Table.Cell>
    </Table.Row>
  );
}
