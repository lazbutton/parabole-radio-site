/**
 * Les artistes : l'index A–Z, brouillons compris, avec la recherche et les filtres en pastilles — rôle, activité (les
 * étiquettes des filtres des artistes), statut, ce qui manque (photo, bio) — appliqués sans recharger la page
 * (cms/README.md, 9.2). Les lettres en haut mènent à leur groupe.
 */
import { LABELS } from "@parabole/cms/labels";
import { PersonIcon, PlusIcon } from "@radix-ui/react-icons";
import { Avatar, Badge, Button, Card, Flex, Link, Select, Table, Text } from "@radix-ui/themes";
import { Fragment } from "react";
import { PageHeader } from "./AdminShell";
import { FilterPill, listHref, SearchField, TagFilterPill, useListFilters } from "./filters";
import { StatusBadge } from "./marks";
import { useRouter } from "./router";
import { counted, initial } from "./text";
import type { ArtistFilters, ArtistsListData } from "./types";

const anchor = (letter: string) => (letter === "#" ? "lettre-chiffres" : `lettre-${letter.toLowerCase()}`);
const hrefOf = (filters: ArtistFilters) => listHref("/admin/artistes", filters);

/** Ce qui manque à une fiche : les choix du filtre, et leurs libellés. */
const MISSING: Record<string, string> = { photo: "Sans photo", bio: "Sans bio" };

/** Aller au groupe d'une lettre, sans toucher à l'adresse. */
function jumpTo(letter: string) {
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(anchor(letter))?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}

export function ArtistsList({ groups, total, filters, tags }: ArtistsListData) {
  const { loading } = useRouter();
  const { shown, set, query } = useListFilters(filters, hrefOf);
  const filtered = Boolean(filters.q || filters.role || filters.status || filters.tag || filters.missing);
  // Un seul filtre d'artistes (Activité) : la pastille prend son nom.
  const tagLabel = tags.length === 1 ? tags[0]!.facet : "Étiquette";

  return (
    <div className="admin-page">
      <PageHeader
        title="Résidents"
        description={`${counted(total, "fiche")} : résidents et invités${filtered ? ", pour ces filtres" : ""}`}
        actions={
          <Button asChild>
            <a href="/admin/artistes/nouveau" data-astro-prefetch="false">
              <PlusIcon /> Nouvel artiste
            </a>
          </Button>
        }
      />
      <div className="admin-toolbar">
        <SearchField query={query} placeholder="Rechercher un nom…" />
        <div className="admin-pills">
          <FilterPill label="Rôle" allLabel="Résidents et invités" value={shown.role} valueLabel={shown.role === "resident" ? "Résidents" : "Invités"} onChange={(role) => set({ role })}>
            <Select.Item value="resident">Résidents</Select.Item>
            <Select.Item value="guest">Invités</Select.Item>
          </FilterPill>
          {tags.length > 0 && (
            <TagFilterPill label={tagLabel} allLabel={tags.length === 1 ? "Toutes les activités" : "Toutes les étiquettes"} menu={tags} value={shown.tag} onChange={(tag) => set({ tag })} />
          )}
          <FilterPill label="Statut" allLabel="Tous les statuts" value={shown.status} valueLabel={shown.status === "draft" ? "Brouillons" : "Publiés"} onChange={(status) => set({ status })}>
            <Select.Item value="published">Publiés</Select.Item>
            <Select.Item value="draft">Brouillons</Select.Item>
          </FilterPill>
          <FilterPill label="À compléter" allLabel="Toutes les fiches" value={shown.missing} valueLabel={MISSING[shown.missing]} onChange={(missing) => set({ missing })}>
            <Select.Item value="photo">Sans photo</Select.Item>
            <Select.Item value="bio">Sans bio</Select.Item>
          </FilterPill>
          {filtered && (
            <Button variant="ghost" color="gray" size="2" asChild>
              <a href="/admin/artistes" data-astro-prefetch="false">
                Effacer les filtres
              </a>
            </Button>
          )}
        </div>
      </div>

      <div className="admin-results" data-loading={loading || undefined}>
        {groups.length > 1 && (
          <nav className="admin-letters" aria-label="Lettres">
            {groups.map((group) => (
              <a
                key={group.letter}
                className="admin-letter"
                href={`#${anchor(group.letter)}`}
                data-astro-prefetch="false"
                onClick={(event) => {
                  event.preventDefault();
                  jumpTo(group.letter);
                }}
              >
                {group.letter}
              </a>
            ))}
          </nav>
        )}

        {groups.length ? (
          <Table.Root variant="ghost" size="2" className="admin-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Artiste</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="admin-hide-mobile">Émissions</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="admin-hide-tablet">Fiche</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Statut</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {groups.map((group) => (
                <Fragment key={group.letter}>
                  <Table.Row className="admin-group" id={anchor(group.letter)}>
                    <Table.Cell colSpan={4}>
                      <Flex align="center" gap="2">
                        <Text size="2" weight="bold" highContrast>
                          {group.letter === "#" ? "Chiffres et signes" : group.letter}
                        </Text>
                        <Text size="1" color="gray">
                          {group.artists.length}
                        </Text>
                      </Flex>
                    </Table.Cell>
                  </Table.Row>
                  {group.artists.map((artist) => {
                    const href = `/admin/artistes/${artist.id}`;
                    const gaps = [!artist.hasPhoto && "sans photo", !artist.hasBio && "sans bio"].filter((gap): gap is string => Boolean(gap));
                    return (
                      <Table.Row key={artist.id} className="admin-row" data-href={href}>
                        <Table.RowHeaderCell>
                          <Flex align="center" gap="3">
                            <Avatar size="2" radius="full" fallback={initial(artist.name)} color={artist.role === "resident" ? "indigo" : "gray"} variant="soft" />
                            <Flex direction="column" minWidth="0">
                              <Link href={href} weight="medium" highContrast underline="hover" data-astro-prefetch="false" className="admin-break">
                                {artist.name}
                              </Link>
                              <Text size="1" color="gray">
                                {LABELS.artistRole[artist.role]}
                                {artist.tags.length > 0 && ` · ${artist.tags.join(", ")}`}
                                <span className="admin-show-mobile"> · {artist.shows ? counted(artist.shows, "émission") : "aucune émission"}</span>
                              </Text>
                            </Flex>
                          </Flex>
                        </Table.RowHeaderCell>
                        <Table.Cell className="admin-hide-mobile">
                          <Text size="2" color={artist.shows ? undefined : "gray"}>
                            {artist.shows ? counted(artist.shows, "émission") : "Aucune"}
                          </Text>
                        </Table.Cell>
                        <Table.Cell className="admin-hide-tablet">
                          {gaps.length ? (
                            <Flex gap="1" wrap="wrap">
                              {gaps.map((gap) => (
                                <Badge key={gap} size="1" color="amber" variant="soft">
                                  {gap}
                                </Badge>
                              ))}
                            </Flex>
                          ) : (
                            <Text size="1" color="gray">
                              Complète
                            </Text>
                          )}
                        </Table.Cell>
                        <Table.Cell justify="end">
                          <StatusBadge status={artist.status} />
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Fragment>
              ))}
            </Table.Body>
          </Table.Root>
        ) : (
          <Card size="3" className="admin-empty-card">
            <Flex direction="column" align="center" gap="3" py="6">
              <span className="admin-empty-icon" aria-hidden>
                <PersonIcon width="22" height="22" />
              </span>
              <Text size="3" weight="medium">
                {filtered ? "Aucun artiste pour ces filtres" : "Pas encore d'artiste"}
              </Text>
              <Text size="2" color="gray" align="center">
                {filtered ? "Essaie une autre recherche, ou retire un filtre." : "Les résidents et les invités de la radio, avec leur bio et leurs liens."}
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
    </div>
  );
}
