/**
 * Les candidatures (cms/README.md, 9.17) : celles qui attendent une réponse d'abord (à écouter, mises de côté), les plus
 * récentes en haut. Les filtres en pastilles (statut, type, émission prête, en retard) et la recherche s'appliquent sans
 * recharger la page et vivent dans l'adresse, comme dans les autres listes. Chaque ligne dit d'un coup d'œil qui, quoi,
 * depuis quand, et si l'émission est déjà prête (de quoi boucher un trou de la grille). Un admin règle ici les types
 * ouverts sur la page et le délai de réponse qu'elle annonce.
 */
import { LABELS } from "@parabole/cms/labels";
import { EnvelopeClosedIcon, ExternalLinkIcon, GearIcon } from "@radix-ui/react-icons";
import { Badge, Button, Card, Checkbox, Dialog, Flex, Link, Select, Table, Text, TextField } from "@radix-ui/themes";
import { useState } from "react";
import type { ShowType } from "@parabole/cms";
import { PageHeader } from "./AdminShell";
import { FilterPill, listHref, SearchField, useListFilters } from "./filters";
import { TypeTile } from "./marks";
import { useRouter } from "./router";
import { Field, FormError, postForm } from "./sheet";
import { counted } from "./text";
import { useNotify } from "./toast";
import type { ApplicationFilters, ApplicationRow, ApplicationSettingsResponse, ApplicationSettingsView, ApplicationsListData } from "./types";

const hrefOf = (filters: ApplicationFilters) => listHref("/admin/candidatures", filters);

/** Les statuts, au féminin (une candidature), et la couleur de leur pastille. */
export const APPLICATION_STATUS = {
  new: { label: "À écouter", color: "amber" },
  shortlisted: { label: "Mise de côté", color: "blue" },
  accepted: { label: "Acceptée", color: "green" },
  declined: { label: "Refusée", color: "gray" },
} as const;

const STATUS_FILTERS: Record<string, string> = {
  new: "À écouter",
  shortlisted: "Mises de côté",
  accepted: "Acceptées",
  declined: "Refusées",
  all: "Toutes",
};

const TYPES: ShowType[] = ["dj_set", "podcast", "playlist"];

export function ApplicationsList({ rows, total, filters, counts, settings, canSettle }: ApplicationsListData) {
  const { loading } = useRouter();
  const { shown, set, query } = useListFilters(filters, hrefOf);
  const filtered = Boolean(filters.q || filters.status || filters.type || filters.ready || filters.late);
  const [settling, setSettling] = useState(false);
  const todo = counts.new + counts.shortlisted;
  const closed = settings.openTypes.length === 0;

  return (
    <div className="admin-page">
      <PageHeader
        title="Candidatures"
        description={
          filtered
            ? `${counted(total, "candidature")} pour ces filtres`
            : todo
              ? `${counted(todo, "candidature")} à traiter · réponse annoncée sous ${settings.replyDays} jours`
              : "Rien à traiter pour l'instant"
        }
        actions={
          <Flex gap="2" wrap="wrap">
            <Button variant="soft" color="gray" asChild>
              <a href="/candidater" target="_blank" rel="noopener">
                <ExternalLinkIcon /> Voir la page
              </a>
            </Button>
            {canSettle && (
              <Button variant="soft" onClick={() => setSettling(true)}>
                <GearIcon /> Réglages
              </Button>
            )}
          </Flex>
        }
      />
      {(closed || settings.openTypes.length < TYPES.length) && (
        <Text as="p" size="2" color="gray" mb="3">
          {closed
            ? "Les candidatures sont fermées : la page dit « Complet pour le moment »."
            : `Complets pour le moment : ${TYPES.filter((type) => !settings.openTypes.includes(type))
                .map((type) => LABELS.showType[type])
                .join(", ")}.`}
        </Text>
      )}

      <div className="admin-toolbar">
        <SearchField query={query} placeholder="Rechercher un nom, un compte, une adresse, une ville…" />
        <div className="admin-pills">
          <FilterPill label="Statut" allLabel={`À traiter (${todo})`} value={shown.status} valueLabel={STATUS_FILTERS[shown.status]} onChange={(status) => set({ status })}>
            <Select.Item value="new">À écouter ({counts.new})</Select.Item>
            <Select.Item value="shortlisted">Mises de côté ({counts.shortlisted})</Select.Item>
            <Select.Item value="accepted">Acceptées ({counts.accepted})</Select.Item>
            <Select.Item value="declined">Refusées ({counts.declined})</Select.Item>
            <Select.Item value="all">Toutes</Select.Item>
          </FilterPill>
          <FilterPill label="Type" allLabel="Tous les types" value={shown.type} valueLabel={LABELS.showType[shown.type as ShowType]} onChange={(type) => set({ type })}>
            {TYPES.map((type) => (
              <Select.Item key={type} value={type}>
                {LABELS.showType[type]}
              </Select.Item>
            ))}
          </FilterPill>
          <FilterPill label="Émission" allLabel="Prête ou non" value={shown.ready} valueLabel="Déjà prête" onChange={(ready) => set({ ready })}>
            <Select.Item value="1">Déjà prête</Select.Item>
          </FilterPill>
          <FilterPill label="Réponse" allLabel="Dans les temps ou non" value={shown.late} valueLabel="En retard" onChange={(late) => set({ late })}>
            <Select.Item value="1">En retard</Select.Item>
          </FilterPill>
          {filtered && (
            <Button variant="ghost" color="gray" size="2" asChild>
              <a href="/admin/candidatures" data-astro-prefetch="false">
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
                <Table.ColumnHeaderCell>Candidature</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell className="admin-hide-mobile">Reçue</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Statut</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((row) => (
                <ApplicationLine key={row.id} row={row} />
              ))}
            </Table.Body>
          </Table.Root>
        ) : (
          <Card size="3" className="admin-empty-card">
            <Flex direction="column" align="center" gap="3" py="6">
              <span className="admin-empty-icon" aria-hidden>
                <EnvelopeClosedIcon width="22" height="22" />
              </span>
              <Text size="3" weight="medium">
                {filtered ? "Aucune candidature pour ces filtres" : "Aucune candidature à traiter"}
              </Text>
              <Text size="2" color="gray" align="center">
                Le lien à partager : <strong>{typeof location === "undefined" ? "" : location.origin}/candidater</strong>, sur Insta ou en réponse à un message.
              </Text>
            </Flex>
          </Card>
        )}
      </div>

      {canSettle && <SettingsDialog open={settling} settings={settings} onClose={() => setSettling(false)} />}
    </div>
  );
}

function ApplicationLine({ row }: { row: ApplicationRow }) {
  const href = `/admin/candidatures/${row.id}`;
  const status = APPLICATION_STATUS[row.status];
  return (
    <Table.Row className="admin-row" data-href={href}>
      <Table.RowHeaderCell>
        <Flex align="center" gap="3">
          <TypeTile type={row.type} />
          <Flex direction="column" minWidth="0" gap="1">
            <Flex align="center" gap="2" wrap="wrap">
              <Link href={href} weight="medium" highContrast underline="hover" data-astro-prefetch="false" className="admin-break">
                {row.name}
              </Link>
              {row.ready && (
                <Badge color="green" variant="soft" radius="full">
                  Déjà prête
                </Badge>
              )}
            </Flex>
            <Text size="1" color="gray" className="admin-break">
              {[LABELS.showType[row.type], row.regular ? "régulièrement" : null, row.contact, row.city].filter(Boolean).join(" · ")}
              <span className="admin-show-mobile">
                {" · "}
                {row.received}
              </span>
            </Text>
          </Flex>
        </Flex>
      </Table.RowHeaderCell>
      <Table.Cell className="admin-hide-mobile">
        <Text size="2" color="gray" className="admin-nowrap" title={row.receivedAt}>
          {row.received}
        </Text>
      </Table.Cell>
      <Table.Cell justify="end">
        <Flex align="center" justify="end" gap="2" wrap="wrap">
          {row.late && (
            <Badge color="red" variant="soft" radius="full">
              En retard
            </Badge>
          )}
          <Badge color={status.color} variant="soft" radius="full">
            {status.label}
          </Badge>
        </Flex>
      </Table.Cell>
    </Table.Row>
  );
}

/** Les réglages d'un admin : les types ouverts sur la page, le délai de réponse qu'elle annonce. */
function SettingsDialog({ open, settings, onClose }: { open: boolean; settings: ApplicationSettingsView; onClose(): void }) {
  const notify = useNotify();
  const router = useRouter();
  const [openTypes, setOpenTypes] = useState<ShowType[]>(settings.openTypes);
  const [replyDays, setReplyDays] = useState(String(settings.replyDays));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save() {
    setBusy(true);
    const body = new FormData();
    body.set("intent", "settings");
    for (const type of openTypes) body.append("openTypes", type);
    body.set("replyDays", replyDays);
    const result = await postForm<ApplicationSettingsResponse>("/admin/candidatures", body);
    setBusy(false);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    notify({ kind: "success", title: result.message });
    onClose();
    router.invalidate();
    router.navigate(location.pathname + location.search, { replace: true, keepScroll: true });
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
        else {
          setOpenTypes(settings.openTypes);
          setReplyDays(String(settings.replyDays));
          setErrors({});
        }
      }}
    >
      <Dialog.Content maxWidth="440px">
        <Dialog.Title>Réglages des candidatures</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          Un type fermé est « complet pour le moment » sur la page. Tout fermé, la page le dit à la place du formulaire.
        </Dialog.Description>
        <FormError message={errors.form} />
        <Flex direction="column" gap="4">
          <Field label="Ouvertes pour">
            <Flex direction="column" gap="2">
              {TYPES.map((type) => (
                <Text as="label" size="2" key={type}>
                  <Flex gap="2" align="center">
                    <Checkbox
                      checked={openTypes.includes(type)}
                      onCheckedChange={(checked) => setOpenTypes((before) => (checked ? TYPES.filter((one) => one === type || before.includes(one)) : before.filter((one) => one !== type)))}
                    />
                    {LABELS.showType[type]}
                  </Flex>
                </Text>
              ))}
            </Flex>
          </Field>
          <Field label="Réponse annoncée sous" htmlFor="replyDays" hint="En jours : 21 s'affiche « 3 semaines » sur la page." error={errors.replyDays}>
            <TextField.Root id="replyDays" type="number" min={1} max={90} value={replyDays} onChange={(event) => setReplyDays(event.target.value)}>
              <TextField.Slot side="right">jours</TextField.Slot>
            </TextField.Root>
          </Field>
        </Flex>
        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Annuler
            </Button>
          </Dialog.Close>
          <Button loading={busy} onClick={() => void save()}>
            Enregistrer
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
