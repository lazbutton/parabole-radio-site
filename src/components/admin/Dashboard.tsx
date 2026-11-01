/**
 * Le tableau de bord : les chiffres des rubriques, les derniers brouillons à reprendre, et ce qui manque encore.
 */
import { InfoCircledIcon, PlusIcon } from "@radix-ui/react-icons";
import { Button, Callout, Card, Flex, Grid, Heading, Link, Table, Text } from "@radix-ui/themes";
import { PageHeader } from "./AdminShell";
import type { DashboardData, Viewer } from "./types";

export function Dashboard({ viewer, stats, drafts }: DashboardData & { viewer: Viewer }) {
  const firstName = viewer.name.split(" ")[0];
  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description={`Bonjour ${firstName}.`}
        actions={
          <>
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
      <Grid columns={{ initial: "2", md: "4" }} gap="3" mb="5">
        {stats.map((stat) => (
          <Card key={stat.label} asChild size="2" className="admin-stat">
            <a href={stat.href} data-astro-prefetch="false">
              <Text as="p" size="2" color="gray">
                {stat.label}
              </Text>
              <Text as="p" size="7" weight="bold" mt="1">
                {stat.value}
              </Text>
            </a>
          </Card>
        ))}
      </Grid>
      <Card size="2" className="admin-card">
        <Heading as="h2" size="3" mb="3">
          Brouillons récents
        </Heading>
        {drafts.length ? (
          <Table.Root size="2">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Titre</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Rubrique</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Modifié</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {drafts.map((draft) => (
                <Table.Row key={draft.href} className="admin-row" data-href={draft.href}>
                  <Table.RowHeaderCell>
                    <Link href={draft.href} weight="medium" highContrast underline="hover" data-astro-prefetch="false">
                      {draft.title}
                    </Link>
                  </Table.RowHeaderCell>
                  <Table.Cell>
                    <Text color="gray">{draft.kind}</Text>
                  </Table.Cell>
                  <Table.Cell justify="end">
                    <Text color="gray">{draft.since}</Text>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        ) : (
          <Text size="2" color="gray">
            Aucun brouillon en cours.
          </Text>
        )}
      </Card>
      <Callout.Root color="blue" mt="5" variant="surface">
        <Callout.Icon>
          <InfoCircledIcon />
        </Callout.Icon>
        <Flex direction="column" gap="1">
          <Callout.Text>
            Les pages du site (Show, Residents) ne lisent pas encore le CMS : ce qui est publié ici y apparaîtra quand elles seront branchées.
          </Callout.Text>
          <Callout.Text>Les images, les événements, les pages et l'équipe arrivent aux prochaines étapes.</Callout.Text>
        </Flex>
      </Callout.Root>
    </>
  );
}
