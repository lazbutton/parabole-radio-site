/**
 * Les événements : tous, brouillons compris, « À venir » en tête (du plus proche au plus lointain), puis les passés,
 * rangés par mois, avec la recherche et les filtres de cms/README.md (9.2) en pastilles — période, catégorie, statut.
 * Tout s'applique sans recharger la page, et vit dans l'adresse, comme pour les shows. Chaque ligne dit d'un coup d'œil
 * ce qu'a l'événement : son visuel, ses photos.
 */
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, ImageIcon, PlusIcon, StackIcon } from "@radix-ui/react-icons";
import { Button, Card, Flex, Link, Select, Table, Text, Tooltip } from "@radix-ui/themes";
import { Fragment } from "react";
import { PageHeader } from "./AdminShell";
import { FilterPill, listHref, SearchField, TagFilterPill, useListFilters } from "./filters";
import { StatusBadge } from "./marks";
import { useRouter } from "./router";
import { counted } from "./text";
import type { EventFilters, EventRow, EventsListData } from "./types";

const hrefOf = (filters: EventFilters, page?: number) => listHref("/admin/evenements", filters, { page });

const PERIODS: Record<string, string> = { upcoming: "À venir", past: "Passés" };

/** Le groupe d'une ligne : « À venir », ou le mois où l'événement a commencé. */
const groupOf = (row: EventRow) => (row.upcoming ? "À venir" : row.month);

/** Les lignes rangées par groupe, dans l'ordre de la liste. */
function grouped(rows: EventRow[]) {
  const groups: { label: string; rows: EventRow[] }[] = [];
  for (const row of rows) {
    const label = groupOf(row);
    const last = groups.at(-1);
    if (last?.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

export function EventsList({ rows, total, page, pages, filters, tags }: EventsListData) {
  const { loading } = useRouter();
  const { shown, set, goToPage, query } = useListFilters(filters, hrefOf);
  const filtered = Boolean(filters.q || filters.status || filters.period || filters.tag);

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
          <Table.Root variant="ghost" size="2" className="admin-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Événement</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="admin-hide-mobile">Date</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="admin-hide-tablet">Images</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Statut</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {grouped(rows).map((group) => (
                <Fragment key={group.label}>
                  <Table.Row className="admin-group">
                    <Table.Cell colSpan={4}>
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
                    <EventLine key={row.id} row={row} />
                  ))}
                </Fragment>
              ))}
            </Table.Body>
          </Table.Root>
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
    </div>
  );
}

/** Une ligne : la vignette d'un événement, le titre et ce qu'on en sait (catégorie, lieu, artistes), la date, les images, le statut. */
function EventLine({ row }: { row: EventRow }) {
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
    </Table.Row>
  );
}
