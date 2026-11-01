/**
 * Les artistes : l'index A–Z, brouillons compris, avec la recherche et les filtres résident / invité et statut
 * (cms/README.md, 9.2), appliqués sans recharger la page. Les lettres en haut mènent à leur groupe.
 */
import { LABELS } from "@parabole/cms/labels";
import { PlusIcon } from "@radix-ui/react-icons";
import { Avatar, Badge, Button, Card, Flex, Link, SegmentedControl, Select, Table, Text } from "@radix-ui/themes";
import { Fragment } from "react";
import { PageHeader, StatusBadge } from "./AdminShell";
import { ALL, listHref, SearchField, useListFilters } from "./filters";
import { useRouter } from "./router";
import type { ArtistFilters, ArtistsListData } from "./types";

const anchor = (letter: string) => (letter === "#" ? "lettre-chiffres" : `lettre-${letter.toLowerCase()}`);
const hrefOf = (filters: ArtistFilters) => listHref("/admin/artistes", filters);

/** Aller au groupe d'une lettre, sans toucher à l'adresse. */
function jumpTo(letter: string) {
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(anchor(letter))?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}

export function ArtistsList({ groups, total, filters }: ArtistsListData) {
  const { loading } = useRouter();
  const { shown, set, query } = useListFilters(filters, hrefOf);
  const filtered = Boolean(filters.q || filters.role || filters.status);

  return (
    <>
      <PageHeader
        title="Artistes"
        description={`${total} ${total > 1 ? "artistes" : "artiste"}${filtered ? " pour ces filtres" : ""}`}
        actions={
          <Button asChild>
            <a href="/admin/artistes/nouveau" data-astro-prefetch="false">
              <PlusIcon /> Nouvel artiste
            </a>
          </Button>
        }
      />
      <Card size="2" mb="4" className="admin-card">
        <Flex gap="3" wrap="wrap" align="center">
          <SearchField query={query} placeholder="Rechercher un nom…" />
          <SegmentedControl.Root value={shown.role || ALL} onValueChange={(role) => set({ role })} aria-label="Rôle">
            <SegmentedControl.Item value={ALL}>Tous</SegmentedControl.Item>
            <SegmentedControl.Item value="resident">Résidents</SegmentedControl.Item>
            <SegmentedControl.Item value="guest">Invités</SegmentedControl.Item>
          </SegmentedControl.Root>
          <Select.Root value={shown.status || ALL} onValueChange={(status) => set({ status })}>
            <Select.Trigger aria-label="Statut" variant="soft" color="gray" />
            <Select.Content>
              <Select.Item value={ALL}>Tous les statuts</Select.Item>
              <Select.Item value="published">Publiés</Select.Item>
              <Select.Item value="draft">Brouillons</Select.Item>
            </Select.Content>
          </Select.Root>
          {filtered && (
            <Button variant="ghost" color="gray" asChild>
              <a href="/admin/artistes" data-astro-prefetch="false">
                Effacer les filtres
              </a>
            </Button>
          )}
        </Flex>
      </Card>

      <div className="admin-results" data-loading={loading || undefined}>
        {groups.length > 1 && (
          <Flex gap="1" wrap="wrap" mb="3" asChild>
            <nav aria-label="Lettres">
              {groups.map((group) => (
                <Button key={group.letter} asChild variant="soft" color="gray" size="1" className="admin-letter">
                  <a
                    href={`#${anchor(group.letter)}`}
                    data-astro-prefetch="false"
                    onClick={(event) => {
                      event.preventDefault();
                      jumpTo(group.letter);
                    }}
                  >
                    {group.letter}
                  </a>
                </Button>
              ))}
            </nav>
          </Flex>
        )}

        {groups.length ? (
          <Table.Root variant="surface" size="2" className="admin-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Nom</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="admin-hide-mobile">Rôle</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="admin-hide-mobile">Shows</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Statut</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {groups.map((group) => (
                <Fragment key={group.letter}>
                  <Table.Row className="admin-group" id={anchor(group.letter)}>
                    <Table.Cell colSpan={4}>
                      <Text size="2" weight="bold" color="indigo">
                        {group.letter === "#" ? "Chiffres et signes" : group.letter}
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                  {group.artists.map((artist) => {
                    const href = `/admin/artistes/${artist.id}`;
                    return (
                      <Table.Row key={artist.id} className="admin-row" data-href={href}>
                        <Table.RowHeaderCell>
                          <Flex align="center" gap="3">
                            <Avatar size="2" radius="full" fallback={artist.name.trim().charAt(0).toUpperCase() || "?"} color={artist.role === "resident" ? "indigo" : "gray"} />
                            <Flex direction="column" minWidth="0">
                              <Link href={href} weight="medium" highContrast underline="hover" data-astro-prefetch="false" className="admin-break">
                                {artist.name}
                              </Link>
                              <Text size="1" color="gray">
                                <span className="admin-show-mobile">{LABELS.artistRole[artist.role]} · </span>
                                {artist.shows ? `${artist.shows} show${artist.shows > 1 ? "s" : ""}` : "aucun show"}
                                {artist.hasPhoto ? "" : " · sans photo"}
                              </Text>
                            </Flex>
                          </Flex>
                        </Table.RowHeaderCell>
                        <Table.Cell className="admin-hide-mobile">
                          <Badge color={artist.role === "resident" ? "indigo" : "gray"} variant="soft">
                            {LABELS.artistRole[artist.role]}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell className="admin-hide-mobile">
                          <Text color="gray">{artist.shows}</Text>
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <StatusBadge status={artist.status} size="1" />
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Fragment>
              ))}
            </Table.Body>
          </Table.Root>
        ) : (
          <Card size="3" className="admin-card">
            <Flex direction="column" align="center" gap="3" py="5">
              <Text size="3" weight="medium">
                {filtered ? "Aucun artiste pour ces filtres" : "Pas encore d'artiste"}
              </Text>
              {filtered ? (
                <Button variant="soft" asChild>
                  <a href="/admin/artistes" data-astro-prefetch="false">
                    Effacer les filtres
                  </a>
                </Button>
              ) : (
                <Button asChild>
                  <a href="/admin/artistes/nouveau" data-astro-prefetch="false">
                    <PlusIcon /> Créer le premier
                  </a>
                </Button>
              )}
            </Flex>
          </Card>
        )}
      </div>
    </>
  );
}
