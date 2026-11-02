/**
 * Les shows : tous, brouillons compris, rangés par mois (« À venir » en tête), avec la recherche et les filtres de
 * cms/README.md (9.2) en pastilles — statut, type, étiquette, artiste, ce qui manque — et l'ordre. Tout s'applique
 * sans recharger la page, et vit dans l'adresse : une liste filtrée se garde ou se partage. Chaque ligne dit d'un coup
 * d'œil ce qui manque à un show déjà diffusé : sa tracklist, son son.
 */
import { LABELS } from "@parabole/cms/labels";
import { ChevronLeftIcon, ChevronRightIcon, DiscIcon, ListBulletIcon, PlusIcon, SpeakerLoudIcon } from "@radix-ui/react-icons";
import { Badge, Button, Card, Flex, Link, Select, Table, Text, Tooltip } from "@radix-ui/themes";
import { Fragment } from "react";
import { PageHeader } from "./AdminShell";
import { FilterPill, listHref, SearchField, TagFilterPill, useListFilters } from "./filters";
import { StatusBadge, TypeTile } from "./marks";
import { useRouter } from "./router";
import { counted } from "./text";
import type { ShowFilters, ShowRow, ShowsListData } from "./types";

const hrefOf = (filters: ShowFilters, page?: number) => listHref("/admin/shows", filters, { page, defaults: { order: "recent" } });

/** Ce qui manque à un show déjà diffusé : les choix du filtre, et leurs libellés. */
const MISSING: Record<string, string> = { tracklist: "Sans tracklist", sound: "Sans son" };

/** Le groupe d'une ligne : « À venir », le mois de diffusion, ou « Sans date ». */
const groupOf = (row: ShowRow) => (row.upcoming ? "À venir" : row.month || "Sans date");

/** Les lignes rangées par groupe, dans l'ordre de la liste. */
function grouped(rows: ShowRow[]) {
  const groups: { label: string; rows: ShowRow[] }[] = [];
  for (const row of rows) {
    const label = groupOf(row);
    const last = groups.at(-1);
    if (last?.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

export function ShowsList({ rows, total, page, pages, filters, artists, tags }: ShowsListData) {
  const { loading } = useRouter();
  const { shown, set, goToPage, query } = useListFilters(filters, hrefOf);
  const filtered = Boolean(filters.q || filters.status || filters.type || filters.tag || filters.artist || filters.missing);

  return (
    <div className="admin-page">
      <PageHeader
        title="Shows"
        description={`${counted(total, "show")}${filtered ? " pour ces filtres" : ""}`}
        actions={
          <Button asChild>
            <a href="/admin/shows/nouveau" data-astro-prefetch="false">
              <PlusIcon /> Nouveau show
            </a>
          </Button>
        }
      />
      <div className="admin-toolbar">
        <SearchField query={query} placeholder="Rechercher un titre, un artiste, un morceau…" />
        <div className="admin-pills">
          <FilterPill label="Statut" allLabel="Tous les statuts" value={shown.status} valueLabel={shown.status === "draft" ? "Brouillons" : "Publiés"} onChange={(status) => set({ status })}>
            <Select.Item value="published">Publiés</Select.Item>
            <Select.Item value="draft">Brouillons</Select.Item>
          </FilterPill>
          <FilterPill label="Type" allLabel="Tous les types" value={shown.type} valueLabel={LABELS.showType[shown.type as keyof typeof LABELS.showType]} onChange={(type) => set({ type })}>
            {Object.entries(LABELS.showType).map(([value, label]) => (
              <Select.Item key={value} value={value}>
                {label}
              </Select.Item>
            ))}
          </FilterPill>
          {tags.length > 0 && <TagFilterPill label="Étiquette" allLabel="Toutes les étiquettes" menu={tags} value={shown.tag} onChange={(tag) => set({ tag })} />}
          <FilterPill label="Artiste" allLabel="Tous les artistes" value={shown.artist} valueLabel={artists.find((artist) => artist.id === shown.artist)?.name} onChange={(artist) => set({ artist })}>
            {artists.map((artist) => (
              <Select.Item key={artist.id} value={artist.id}>
                {artist.name}
              </Select.Item>
            ))}
          </FilterPill>
          <FilterPill label="À compléter" allLabel="Tous les shows" value={shown.missing} valueLabel={MISSING[shown.missing]} onChange={(missing) => set({ missing })}>
            <Select.Item value="tracklist">Diffusés sans tracklist</Select.Item>
            <Select.Item value="sound">Diffusés sans son</Select.Item>
          </FilterPill>
          {filtered && (
            <Button variant="ghost" color="gray" size="2" asChild>
              <a href="/admin/shows" data-astro-prefetch="false">
                Effacer les filtres
              </a>
            </Button>
          )}
          <div className="admin-pills-end">
            <Select.Root value={shown.order === "oldest" ? "oldest" : "recent"} onValueChange={(order) => set({ order })}>
              <Select.Trigger variant="ghost" color="gray" aria-label="Ordre" />
              <Select.Content position="popper" sideOffset={6} align="end">
                <Select.Item value="recent">Plus récents d'abord</Select.Item>
                <Select.Item value="oldest">Plus anciens d'abord</Select.Item>
              </Select.Content>
            </Select.Root>
          </div>
        </div>
      </div>

      <div className="admin-results" data-loading={loading || undefined}>
        {rows.length ? (
          <Table.Root variant="ghost" size="2" className="admin-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Show</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="admin-hide-mobile">Diffusion</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="admin-hide-tablet">Contenu</Table.ColumnHeaderCell>
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
                    <ShowLine key={row.id} row={row} />
                  ))}
                </Fragment>
              ))}
            </Table.Body>
          </Table.Root>
        ) : (
          <Card size="3" className="admin-empty-card">
            <Flex direction="column" align="center" gap="3" py="6">
              <span className="admin-empty-icon" aria-hidden>
                <DiscIcon width="22" height="22" />
              </span>
              <Text size="3" weight="medium">
                {filtered ? "Aucun show pour ces filtres" : "Pas encore de show"}
              </Text>
              <Text size="2" color="gray" align="center">
                {filtered ? "Essaie une autre recherche, ou retire un filtre." : "Un show, c'est une émission : son titre, sa date, ses artistes et sa tracklist."}
              </Text>
              {filtered ? (
                <Button variant="soft" asChild>
                  <a href="/admin/shows" data-astro-prefetch="false">
                    Effacer les filtres
                  </a>
                </Button>
              ) : (
                <Button asChild>
                  <a href="/admin/shows/nouveau" data-astro-prefetch="false">
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

/** Une ligne : la vignette du type, le titre et les artistes, la diffusion, ce que contient le show, son statut. */
function ShowLine({ row }: { row: ShowRow }) {
  const href = `/admin/shows/${row.id}`;
  // Ce qui manque ne compte que pour un show déjà diffusé (ou sans date) : un show à venir n'a pas encore de son.
  const due = !row.upcoming && Boolean(row.day);
  return (
    <Table.Row className="admin-row" data-href={href}>
      <Table.RowHeaderCell>
        <Flex align="center" gap="3">
          <TypeTile type={row.type} />
          <Flex direction="column" minWidth="0">
            <Link href={href} weight="medium" highContrast underline="hover" data-astro-prefetch="false" className="admin-break">
              {row.title}
            </Link>
            <Text size="1" color="gray" className="admin-break">
              {row.artists || "Sans artiste"}
              <span className="admin-show-mobile">
                {" · "}
                {row.day ? `${row.day}, ${row.time}` : "sans date"}
              </span>
            </Text>
          </Flex>
        </Flex>
      </Table.RowHeaderCell>
      <Table.Cell className="admin-hide-mobile">
        {row.day ? (
          <>
            <Text as="div" size="2" className="admin-nowrap">
              {row.day}
            </Text>
            <Text as="div" size="1" color="gray" className="admin-nowrap">
              {row.time}
              {row.duration && ` · ${row.duration}`}
            </Text>
          </>
        ) : (
          <Text size="2" color="gray">
            Sans date
          </Text>
        )}
      </Table.Cell>
      <Table.Cell className="admin-hide-tablet">
        <Flex align="center" gap="3">
          <Tooltip content={row.tracks ? counted(row.tracks, "morceau", "morceaux") : "Pas de tracklist"}>
            <span className="admin-fact" data-off={!row.tracks || undefined} data-missing={(due && !row.tracks) || undefined}>
              <ListBulletIcon aria-hidden /> {row.tracks || "—"}
              <span className="admin-sr-only">{row.tracks ? counted(row.tracks, "morceau", "morceaux") : "pas de tracklist"}</span>
            </span>
          </Tooltip>
          <Tooltip content={row.hasSound ? "Piste SoundCloud renseignée" : "Pas de son"}>
            <span className="admin-fact" data-off={!row.hasSound || undefined} data-missing={(due && !row.hasSound) || undefined}>
              <SpeakerLoudIcon aria-hidden />
              <span className="admin-sr-only">{row.hasSound ? "son renseigné" : "pas de son"}</span>
            </span>
          </Tooltip>
          {row.fromRadioCult && (
            <Badge size="1" color="gray" variant="outline">
              Radio Cult
            </Badge>
          )}
        </Flex>
      </Table.Cell>
      <Table.Cell justify="end">
        <StatusBadge status={row.status} />
      </Table.Cell>
    </Table.Row>
  );
}
