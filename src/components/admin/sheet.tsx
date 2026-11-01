/**
 * Ce que partagent les fiches (show, artiste) : un champ avec son libellé et ses messages, la carte « Publication »
 * (statut, dates, suppression confirmée par un AlertDialog), la barre d'enregistrement collée en bas de l'écran,
 * l'emplacement d'une image, et l'envoi au serveur (postForm, qui sert aussi au mot de passe).
 */
import { ExclamationTriangleIcon, ImageIcon, TrashIcon } from "@radix-ui/react-icons";
import { AlertDialog, Badge, Box, Button, Card, DataList, Flex, Heading, Kbd, Text, Tooltip } from "@radix-ui/themes";
import { useEffect, useRef, type ReactNode } from "react";
import type { FieldErrors } from "@parabole/cms";
import { StatusBadge } from "./AdminShell";
import type { MediaView } from "./types";

export type Intent = "save" | "publish" | "unpublish" | "delete";
/** Ce qu'envoie la barre d'enregistrement : tout sauf la suppression, qui a son bouton dans la carte Publication. */
export type SaveIntent = Exclude<Intent, "delete">;

/** Un champ : son libellé (facultatif ou non), le contrôle, une aide, l'erreur. */
export function Field({ label, htmlFor, optional, hint, error, children }: { label: string; htmlFor?: string; optional?: boolean; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <Flex direction="column" gap="1">
      <Text as="label" size="2" weight="medium" htmlFor={htmlFor}>
        {label}
        {optional && (
          <Text size="1" color="gray" weight="regular">
            {" "}
            facultatif
          </Text>
        )}
      </Text>
      {children}
      {hint && (
        <Text size="1" color="gray">
          {hint}
        </Text>
      )}
      {error && (
        <Text size="1" color="red" role="alert">
          {error}
        </Text>
      )}
    </Flex>
  );
}

/** Une carte de la fiche, avec son titre. */
export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <Card size="2" className="admin-card">
      <Flex justify="between" align="center" gap="3" mb="3">
        <Heading as="h2" size="3">
          {title}
        </Heading>
        {aside}
      </Flex>
      <Flex direction="column" gap="4">
        {children}
      </Flex>
    </Card>
  );
}

/** La carte « Publication » : statut, dates, et la suppression, confirmée. */
export function PublishCard({
  status,
  created,
  updated,
  deleteTitle,
  deleteNote,
  onDelete,
  deleting,
}: {
  status: "draft" | "published";
  created: string | null;
  updated: string | null;
  /** « Supprimer « Nuit Parabole » ? » ; absent pour une fiche pas encore créée. */
  deleteTitle?: string;
  deleteNote?: string;
  onDelete?(): void;
  deleting?: boolean;
}) {
  return (
    <Section title="Publication" aside={<StatusBadge status={status} />}>
      <DataList.Root size="2">
        <DataList.Item>
          <DataList.Label minWidth="90px">Sur le site</DataList.Label>
          <DataList.Value>{status === "published" ? "Visible" : "Invisible"}</DataList.Value>
        </DataList.Item>
        {created && (
          <DataList.Item>
            <DataList.Label minWidth="90px">Créé</DataList.Label>
            <DataList.Value>{created}</DataList.Value>
          </DataList.Item>
        )}
        {updated && (
          <DataList.Item>
            <DataList.Label minWidth="90px">Modifié</DataList.Label>
            <DataList.Value>{updated}</DataList.Value>
          </DataList.Item>
        )}
      </DataList.Root>
      {deleteTitle && onDelete && (
        <AlertDialog.Root>
          <AlertDialog.Trigger>
            <Button type="button" variant="ghost" color="red" className="admin-delete">
              <TrashIcon /> Supprimer…
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Content maxWidth="460px">
            <AlertDialog.Title>{deleteTitle}</AlertDialog.Title>
            <AlertDialog.Description size="2">{deleteNote} C'est définitif.</AlertDialog.Description>
            <Flex gap="3" mt="4" justify="end">
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray">
                  Annuler
                </Button>
              </AlertDialog.Cancel>
              {/* Pas d'AlertDialog.Action : le dialogue reste ouvert, avec son indicateur, jusqu'au retour à la liste. */}
              <Button color="red" loading={deleting} onClick={onDelete}>
                <TrashIcon /> Supprimer
              </Button>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
      )}
    </Section>
  );
}

/**
 * La barre d'enregistrement, collée en bas de l'écran : le statut, les modifications en attente, puis Enregistrer et
 * Publier (ou Dépublier). ⌘S ou Ctrl+S enregistre aussi.
 */
export function SaveBar({ status, dirty, busy, isNew, onSave }: { status: "draft" | "published"; dirty: boolean; busy: Intent | null; isNew: boolean; onSave(intent: SaveIntent): void }) {
  const published = status === "published";
  return (
    <div className="admin-savebar">
      <Flex align="center" gap="3" minWidth="0">
        <StatusBadge status={status} />
        {dirty ? (
          <Flex align="center" gap="1" className="admin-unsaved">
            <Badge color="amber" variant="soft" radius="full">
              Modifications non enregistrées
            </Badge>
          </Flex>
        ) : (
          <Text size="2" color="gray" className="admin-hide-mobile">
            {published ? "Enregistrer met à jour la version publiée." : "Invisible sur le site tant que ce n'est pas publié."}
          </Text>
        )}
      </Flex>
      <Flex gap="2" className="admin-savebar-actions">
        {published && (
          <Button type="button" variant="soft" color="gray" loading={busy === "unpublish"} disabled={busy !== null} onClick={() => onSave("unpublish")}>
            Dépublier
          </Button>
        )}
        <Tooltip content={<>Enregistrer <Kbd size="1">⌘ S</Kbd></>}>
          <Button
            type="submit"
            variant={published ? "solid" : "soft"}
            loading={busy === "save"}
            disabled={busy !== null || (!dirty && !isNew)}
          >
            {published ? "Enregistrer" : "Enregistrer le brouillon"}
          </Button>
        </Tooltip>
        {!published && (
          <Button type="button" loading={busy === "publish"} disabled={busy !== null} onClick={() => onSave("publish")}>
            Publier
          </Button>
        )}
      </Flex>
    </div>
  );
}

/** L'emplacement d'une image, en attendant l'envoi vers Cloudflare R2 (prochaine étape). */
export function MediaSlot({ media }: { media: MediaView }) {
  return (
    <Flex gap="3" align="center">
      <Flex align="center" justify="center" className="admin-media-frame">
        <ImageIcon width="22" height="22" />
      </Flex>
      <Box minWidth="0">
        <Text as="p" size="2" weight="medium">
          {media ? "Image enregistrée" : "Pas encore d'image"}
        </Text>
        {media && (
          <Text as="p" size="1" color="gray" className="admin-break">
            {media.key}
            {media.alt ? ` — « ${media.alt} »` : " — sans texte alternatif"}
          </Text>
        )}
        <Text as="p" size="1" color="gray">
          L'envoi des images arrive à la prochaine étape, avec le stockage Cloudflare R2.
        </Text>
      </Box>
    </Flex>
  );
}

/** Le message général d'un enregistrement refusé, en haut de la fiche. */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <Flex align="start" gap="2" className="admin-form-error" role="alert">
      <ExclamationTriangleIcon />
      <Text size="2">{message}</Text>
    </Flex>
  );
}

/** Les places des lignes remplies d'une liste (tracklist, liens) : le serveur ignore les lignes vides. */
export const filledPlaces = <T,>(rows: T[], filled: (row: T) => boolean) => rows.flatMap((row, index) => (filled(row) ? [index] : []));

/**
 * Les erreurs du serveur, numérotées sur les lignes remplies (« tracks.0.title »), remises sur les lignes de la fiche,
 * lignes vides comprises.
 */
export function placeErrors(errors: FieldErrors, list: string, places: number[]): FieldErrors {
  const placed: FieldErrors = {};
  for (const [key, message] of Object.entries(errors)) {
    const [name, index, field] = key.split(".");
    placed[name === list && field && places[Number(index)] !== undefined ? `${list}.${places[Number(index)]}.${field}` : key] = message;
  }
  return placed;
}

/**
 * La fiche après un enregistrement : celle du serveur (remise au propre, artistes créés…), sauf les champs modifiés
 * pendant l'envoi, qui restent tels qu'on les a tapés.
 */
export function mergeSaved<F extends object>(current: F, sent: F, fresh: F): F {
  const merged = { ...fresh };
  for (const key of Object.keys(fresh) as (keyof F)[]) if (current[key] !== sent[key]) merged[key] = current[key];
  return merged;
}

/**
 * ⌘S ou Ctrl+S pour enregistrer, et le rappel du navigateur avant de fermer ou de recharger une fiche modifiée. Quitter
 * la fiche pour un autre écran de l'admin, c'est le routeur qui le retient (useBlocker).
 */
export function useSheetKeys(dirty: boolean, save: () => void) {
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        latest.current();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener("beforeunload", onLeave);
    return () => removeEventListener("beforeunload", onLeave);
  }, [dirty]);
}

/**
 * Envoie un formulaire au serveur (l'adresse de l'écran, qui répond en JSON) et rend sa réponse. Une session expirée ou
 * une panne deviennent un message, jamais une page perdue : rien n'est enregistré, la saisie reste à l'écran.
 */
export async function postForm<T>(url: string, body: FormData): Promise<T | { ok: false; errors: FieldErrors }> {
  try {
    const response = await fetch(url, { method: "POST", body, headers: { Accept: "application/json" } });
    if ((response.headers.get("content-type") ?? "").includes("application/json")) return (await response.json()) as T;
    const expired = response.url.includes("/admin/connexion");
    return {
      ok: false,
      errors: {
        form: expired
          ? "Ta session a expiré : reconnecte-toi dans un autre onglet, puis enregistre de nouveau. Ta saisie est toujours là."
          : "Le serveur n'a pas répondu comme prévu. Réessaie dans un instant.",
      },
    };
  } catch {
    return { ok: false, errors: { form: "Pas de connexion au serveur. Vérifie le réseau, puis réessaie : ta saisie est toujours là." } };
  }
}
