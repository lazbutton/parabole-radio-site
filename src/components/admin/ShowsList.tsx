/**
 * Les shows : tous, brouillons compris, avec la recherche et les filtres de cms/README.md (9.2) — statut, type,
 * étiquette, artiste — et l'ordre. Tout s'applique sans recharger la page, et vit dans l'adresse : une liste filtrée se
 * garde ou se partage.
 */
import { LABELS } from "@parabole/cms/labels";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "@radix-ui/react-icons";
import { Badge, Button, Card, Flex, Link, SegmentedControl, Select, Table, Text } from "@radix-ui/themes";
import { PageHeader, StatusBadge } from "./AdminShell";
import { ALL, listHref, SearchField, useListFilters } from "./filters";
import { useRouter } from "./router";
import type { ShowFilters, ShowsListData } from "./types";

const counted = (n: number) => `${n} ${n > 1 ? "shows" : "show"}`;
const hrefOf = (filters: ShowFilters, page?: number) => listHref("/admin/shows", filters, { page, defaults: { order: "recent" } });

export function ShowsList({ rows, total, page, pages, filters, artists, tags }: ShowsListData) {
  const { loading } = useRouter();
  const { shown, set, goToPage, query } = useListFilters(filters, hrefOf);
  const filtered = Boolean(filters.q || filters.status || filters.type || filters.tag || filters.artist);
  const tagKinds = (["genre", "mood", "theme"] as const).map((kind) => ({ kind, tags: tags.filter((tag) => tag.kind === kind) })).filter((group) => group.tags.length);

  return (
    <>
      <PageHeader
        title="Shows"
        description={`${counted(total)}${filtered ? " pour ces filtres" : ""}`}
        actions={
          <Button asChild>
            <a href="/admin/shows/nouveau" data-astro-prefetch="false">
              <PlusIcon /> Nouveau show
            </a>
          </Button>
        }
      />
      <Card size="2" mb="4" className="admin-card">
        <Flex direction="column" gap="3">
          <Flex gap="3" wrap="wrap" align="center">
            <SearchField query={query} placeholder="Rechercher un titre, un artiste, un morceau…" />
            <SegmentedControl.Root value={shown.status || ALL} onValueChange={(status) => set({ status })} aria-label="Statut">
              <SegmentedControl.Item value={ALL}>Tous</SegmentedControl.Item>
              <SegmentedControl.Item value="published">Publiés</SegmentedControl.Item>
              <SegmentedControl.Item value="draft">Brouillons</SegmentedControl.Item>
            </SegmentedControl.Root>
          </Flex>
          <Flex gap="2" wrap="wrap" align="center">
            <Select.Root value={shown.type || ALL} onValueChange={(type) => set({ type })}>
              <Select.Trigger aria-label="Type" variant="soft" color="gray" />
              <Select.Content>
                <Select.Item value={ALL}>Tous les types</Select.Item>
                {Object.entries(LABELS.showType).map(([value, label]) => (
                  <Select.Item key={value} value={value}>
                    {label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Select.Root value={shown.tag || ALL} onValueChange={(tag) => set({ tag })}>
              <Select.Trigger aria-label="Étiquette" variant="soft" color="gray" />
              <Select.Content>
                <Select.Item value={ALL}>Toutes les étiquettes</Select.Item>
                {tagKinds.map((group) => (
                  <Select.Group key={group.kind}>
                    <Select.Separator />
                    <Select.Label>{LABELS.tagKind[group.kind]}</Select.Label>
                    {group.tags.map((tag) => (
                      <Select.Item key={tag.id} value={tag.id}>
                        {tag.name}
                      </Select.Item>
                    ))}
                  </Select.Group>
                ))}
              </Select.Content>
            </Select.Root>
            <Select.Root value={shown.artist || ALL} onValueChange={(artist) => set({ artist })}>
              <Select.Trigger aria-label="Artiste" variant="soft" color="gray" />
              <Select.Content>
                <Select.Item value={ALL}>Tous les artistes</Select.Item>
                {artists.map((artist) => (
                  <Select.Item key={artist.id} value={artist.id}>
                    {artist.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Select.Root value={shown.order === "oldest" ? "oldest" : "recent"} onValueChange={(order) => set({ order })}>
              <Select.Trigger aria-label="Ordre" variant="ghost" color="gray" />
              <Select.Content>
                <Select.Item value="recent">Plus récents d'abord</Select.Item>
                <Select.Item value="oldest">Plus anciens d'abord</Select.Item>
              </Select.Content>
            </Select.Root>
            {filtered && (
              <Button variant="ghost" color="gray" asChild>
                <a href="/admin/shows" data-astro-prefetch="false">
                  Effacer les filtres
                </a>
              </Button>
            )}
          </Flex>
        </Flex>
      </Card>

      <div className="admin-results" data-loading={loading || undefined}>
        {rows.length ? (
          <Table.Root variant="surface" size="2" className="admin-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Titre</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="admin-hide-mobile">Type</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="admin-hide-mobile">Diffusion</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="admin-hide-tablet">Tracklist</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Statut</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => {
                const href = `/admin/shows/${row.id}`;
                return (
                  <Table.Row key={row.id} className="admin-row" data-href={href}>
                    <Table.RowHeaderCell>
                      <Link href={href} weight="medium" highContrast underline="hover" data-astro-prefetch="false">
                        {row.title}
                      </Link>
                      <Text as="div" size="1" color="gray" className="admin-break">
                        {row.artists || "Sans artiste"}
                        <span className="admin-show-mobile">
                          {" "}
                          · {LABELS.showType[row.type]} · {row.date}
                        </span>
                      </Text>
                    </Table.RowHeaderCell>
                    <Table.Cell className="admin-hide-mobile">{LABELS.showType[row.type]}</Table.Cell>
                    <Table.Cell className="admin-hide-mobile">
                      <Text color="gray" className="admin-nowrap">
                        {row.date}
                      </Text>
                      {row.duration && (
                        <Text as="div" size="1" color="gray">
                          {row.duration}
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell className="admin-hide-tablet">
                      <Text color="gray">{row.tracks ? `${row.tracks} ${row.tracks > 1 ? "morceaux" : "morceau"}` : "—"}</Text>
                      {row.hasSound && (
                        <Text as="div" size="1" color="gray">
                          SoundCloud
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Flex gap="1" justify="end" wrap="wrap">
                        <StatusBadge status={row.status} size="1" />
                        {row.fromRadioCult && (
                          <Badge size="1" color="gray" variant="outline">
                            Radio Cult
                          </Badge>
                        )}
                      </Flex>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        ) : (
          <Card size="3" className="admin-card">
            <Flex direction="column" align="center" gap="3" py="5">
              <Text size="3" weight="medium">
                {filtered ? "Aucun show pour ces filtres" : "Pas encore de show"}
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
    </>
  );
}
