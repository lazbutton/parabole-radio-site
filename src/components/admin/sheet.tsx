/**
 * Ce que partagent les fiches (show, artiste). En haut, la barre de la fiche : où l'on est, le statut, l'état de
 * l'enregistrement et toutes les actions au même endroit (Enregistrer, Publier ; Dépublier et Supprimer dans le menu
 * « … »). Sur téléphone, les actions descendent en bas de l'écran, sous le pouce. Dans le corps : le titre en grand,
 * qui s'écrit sur place, les propriétés en lignes (libellé à gauche, valeur à droite), les sections, et le panneau
 * de côté (image, son, informations). Plus l'envoi au serveur (postForm, qui sert aussi au mot de passe).
 */
import { ArrowLeftIcon, CheckIcon, DotsHorizontalIcon, ExclamationTriangleIcon, ExternalLinkIcon, EyeNoneIcon, TrashIcon } from "@radix-ui/react-icons";
import { AlertDialog, Button, DropdownMenu, Flex, Heading, IconButton, Kbd, Spinner, Text, Tooltip } from "@radix-ui/themes";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FieldErrors } from "@parabole/cms";
import { StatusBadge, useModKey } from "./marks";

export type Intent = "save" | "publish" | "unpublish" | "delete";
/** Ce qu'envoient les boutons de la barre : tout sauf la suppression, qui passe par une confirmation. */
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

/**
 * Une propriété de la fiche, en ligne : le libellé (avec son icône) à gauche, la valeur à droite, puis l'aide et
 * l'erreur. Sur téléphone, le libellé passe au-dessus.
 */
export function Property({ label, icon, htmlFor, hint, error, children }: { label: string; icon: ReactNode; htmlFor?: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="admin-prop" data-invalid={error ? true : undefined}>
      <Text as={htmlFor ? "label" : "div"} size="2" color="gray" className="admin-prop-label" {...(htmlFor ? { htmlFor } : {})}>
        <span aria-hidden>{icon}</span>
        {label}
      </Text>
      <div className="admin-prop-value">
        {children}
        {hint && (
          <Text as="p" size="1" color="gray">
            {hint}
          </Text>
        )}
        {error && (
          <Text as="p" size="1" color="red" role="alert">
            {error}
          </Text>
        )}
      </div>
    </div>
  );
}

const fieldSizing = () => typeof CSS !== "undefined" && CSS.supports("field-sizing", "content");

/**
 * Le titre de la fiche, en grand, qui s'écrit sur place et passe à la ligne s'il est long. Entrée enregistre, comme
 * dans un champ de formulaire.
 */
export function TitleInput({ id, label, value, onChange, placeholder, error }: { id: string; label: string; value: string; onChange(value: string): void; placeholder: string; error?: string }) {
  const field = useRef<HTMLTextAreaElement>(null);
  // Les navigateurs sans `field-sizing` (Firefox) : la hauteur suit le texte à la main.
  useEffect(() => {
    const element = field.current;
    if (!element || fieldSizing()) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  return (
    <div className="admin-title-field">
      <textarea
        ref={field}
        id={id}
        className="admin-title-input"
        rows={1}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-erreur` : undefined}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value.replace(/\s*\n\s*/g, " "))}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
      />
      {error && (
        <Text as="p" size="2" color="red" role="alert" id={`${id}-erreur`}>
          {error}
        </Text>
      )}
    </div>
  );
}

/** Un bloc du corps de la fiche (Description, Tracklist, Liens) : son titre, un compte, des actions à droite. */
export function Section({ title, count, aside, children }: { title: string; count?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="admin-section">
      <Flex justify="between" align="center" gap="3" wrap="wrap" mb="3">
        <Flex align="center" gap="2">
          <Heading as="h2" size="4">
            {title}
          </Heading>
          {count}
        </Flex>
        {aside}
      </Flex>
      {children}
    </section>
  );
}

/** Un bloc du panneau de côté (Pochette, Son, Informations). */
export function SidePanel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="admin-side-panel">
      <Flex justify="between" align="center" gap="2" mb="3">
        <Heading as="h2" size="1" weight="bold" color="gray" className="admin-side-title">
          {title}
        </Heading>
        {aside}
      </Flex>
      <Flex direction="column" gap="3">
        {children}
      </Flex>
    </section>
  );
}

/**
 * La barre de la fiche, collée en haut : le retour à la liste, le nom, le statut ; puis l'état de l'enregistrement
 * et les actions. Un brouillon a Enregistrer et Publier ; un contenu publié a Enregistrer (qui met à jour la version
 * publiée), et Dépublier dans le menu « … », avec Supprimer, toujours confirmé. ⌘S ou Ctrl+S enregistre aussi.
 * Une page toujours en ligne (`live`, À propos) n'a qu'Enregistrer, et `view`, le lien vers sa page du site.
 */
export function SheetBar({
  back,
  name,
  status,
  isNew,
  dirty,
  busy,
  updated,
  onSave,
  deleteTitle,
  deleteNote = "",
  onDelete,
  live = false,
  view,
}: {
  /** La liste où revenir ; absente pour une page qui n'est dans aucune liste. */
  back?: { label: string; href: string };
  name: string;
  status: "draft" | "published";
  isNew: boolean;
  dirty: boolean;
  busy: Intent | null;
  updated: string | null;
  onSave(intent: SaveIntent): void;
  /** « Supprimer « Nuit Parabole » ? » ; absent pour une fiche pas encore créée. */
  deleteTitle?: string;
  deleteNote?: string;
  onDelete?(): void;
  /** Toujours en ligne : ni statut, ni Publier, ni Dépublier. */
  live?: boolean;
  /** La page du site, à ouvrir dans un autre onglet. */
  view?: { label: string; href: string };
}) {
  const mod = useModKey();
  const [confirming, setConfirming] = useState(false);
  const published = live || status === "published";
  const saving = busy !== null && busy !== "delete";
  const state = saving
    ? { tone: "busy", text: "Enregistrement…" }
    : dirty
      ? { tone: "dirty", text: "Modifications non enregistrées" }
      : isNew
        ? { tone: "new", text: "Nouveau brouillon" }
        : { tone: "saved", text: published ? "Enregistré" : "Brouillon enregistré" };
  const hint = dirty && published ? (live ? "Enregistrer met à jour le site." : "Enregistrer met à jour la version publiée.") : updated ? `Modifié le ${updated}` : undefined;
  const menu = (published && !live) || Boolean(deleteTitle);

  return (
    <div className="admin-sheet-bar">
      <div className="admin-sheet-where">
        {back && (
          <>
            <Tooltip content={`Retour : ${back.label}`}>
              <IconButton asChild variant="ghost" color="gray" size="2">
                <a href={back.href} data-astro-prefetch="false" aria-label={`Retour : ${back.label}`}>
                  <ArrowLeftIcon width="18" height="18" />
                </a>
              </IconButton>
            </Tooltip>
            <Text size="2" color="gray" className="admin-sheet-crumb admin-hide-mobile">
              <a href={back.href} data-astro-prefetch="false">
                {back.label}
              </a>
              <span aria-hidden> / </span>
            </Text>
          </>
        )}
        <Text size="2" weight="medium" truncate className="admin-sheet-name">
          {name}
        </Text>
        {!isNew && !live && <StatusBadge status={status} />}
        {view && (
          <Tooltip content={`${view.label} (nouvel onglet)`}>
            <IconButton asChild variant="ghost" color="gray" size="2">
              <a href={view.href} target="_blank" rel="noopener" aria-label={`${view.label} (nouvel onglet)`}>
                <ExternalLinkIcon />
              </a>
            </IconButton>
          </Tooltip>
        )}
      </div>

      <div className="admin-sheet-actions">
        <Tooltip content={hint ?? state.text}>
          <span className="admin-save-state" data-tone={state.tone} role="status">
            {state.tone === "busy" ? <Spinner size="1" /> : state.tone === "saved" ? <CheckIcon aria-hidden /> : <span className="admin-save-dot" aria-hidden />}
            <span className="admin-save-text">{state.text}</span>
          </span>
        </Tooltip>
        {menu && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton type="button" variant="soft" color="gray" size="2" aria-label="Plus d'actions" disabled={busy !== null}>
                <DotsHorizontalIcon />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" size="2">
              {published && !live && (
                <DropdownMenu.Item onSelect={() => onSave("unpublish")}>
                  <EyeNoneIcon /> Dépublier
                </DropdownMenu.Item>
              )}
              {published && !live && deleteTitle && <DropdownMenu.Separator />}
              {deleteTitle && (
                <DropdownMenu.Item color="red" onSelect={() => setConfirming(true)}>
                  <TrashIcon /> Supprimer…
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        )}
        <Tooltip
          content={
            <>
              Enregistrer <Kbd size="1">{mod} S</Kbd>
            </>
          }
        >
          <Button
            type="submit"
            size="2"
            variant={published ? "solid" : "soft"}
            loading={busy === "save"}
            disabled={busy !== null || (!dirty && !isNew)}
            className="admin-save-button"
            data-dirty={dirty || undefined}
          >
            Enregistrer
          </Button>
        </Tooltip>
        {!published && !live && (
          <Button type="button" size="2" loading={busy === "publish"} disabled={busy !== null} onClick={() => onSave("publish")}>
            Publier
          </Button>
        )}
      </div>

      {deleteTitle && (
        <AlertDialog.Root open={confirming} onOpenChange={(open) => busy !== "delete" && setConfirming(open)}>
          <AlertDialog.Content maxWidth="460px">
            <AlertDialog.Title>{deleteTitle}</AlertDialog.Title>
            <AlertDialog.Description size="2">{deleteNote} C'est définitif.</AlertDialog.Description>
            <Flex gap="3" mt="4" justify="end">
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray" disabled={busy === "delete"}>
                  Annuler
                </Button>
              </AlertDialog.Cancel>
              {/* Pas d'AlertDialog.Action : le dialogue reste ouvert, avec son indicateur, jusqu'au retour à la liste. */}
              <Button color="red" loading={busy === "delete"} onClick={() => onDelete?.()}>
                <TrashIcon /> Supprimer
              </Button>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
      )}
    </div>
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
