/**
 * La galerie d'un événement (cms/README.md, 9.2) : ses photos dans l'ordre où le site les fait défiler, chacune avec
 * sa légende. « Ajouter des photos » en prend plusieurs d'un coup, ou on les glisse sur la galerie : une fenêtre les
 * montre, chacune avec sa légende et son texte alternatif (déjà proposé, à préciser), et un crédit pour toutes.
 * « Envoyer » les envoie l'une après l'autre, comme le visuel (sendImage), puis les met au bout de la galerie, tout de
 * suite, sans enregistrer la fiche. Une photo se déplace par sa poignée (ou par son menu), change de légende ou de
 * texte, ou se retire : chaque changement part aussitôt au serveur.
 */
import type { FieldErrors } from "@parabole/cms";
import { DotsHorizontalIcon, DragHandleDots2Icon, ExclamationTriangleIcon, ImageIcon, PlusIcon, TrashIcon, UploadIcon } from "@radix-ui/react-icons";
import { AlertDialog, Button, Callout, Dialog, DropdownMenu, Flex, IconButton, Progress, Text, TextField } from "@radix-ui/themes";
import { useEffect, useRef, useState, type DragEvent, type SubmitEvent } from "react";
import { abandonImage, ACCEPT, DescribeDialog, fields, firstError, inspect, MIN_SIDE, sendImage, typeOf, weight, type Chosen } from "./ImageField";
import { Field, postForm } from "./sheet";
import { useSortable } from "./sortable";
import { useNotify } from "./toast";
import type { GalleryPhoto, GalleryResponse, MediaView, UploadSettings } from "./types";

type Props = {
  photos: GalleryPhoto[];
  uploads: UploadSettings;
  /** Pourquoi on ne peut pas encore en ajouter : la fiche n'est pas créée. */
  blocked?: string;
  /** Le titre de l'événement, pour proposer le texte alternatif. */
  title: string;
  /** L'adresse de la fiche, qui reçoit les changements de la galerie. */
  url: string;
  onChange(photos: GalleryPhoto[]): void;
};

/** Envoie un changement de la galerie à la fiche. */
const change = (url: string, intent: string, values: { media?: string[]; caption?: string[] }) => {
  const data = fields({ intent });
  for (const id of values.media ?? []) data.append("media", id);
  for (const text of values.caption ?? []) data.append("caption", text);
  return postForm<GalleryResponse>(url, data);
};

const sameOrder = (a: GalleryPhoto[], b: GalleryPhoto[]) => a.length === b.length && a.every((photo, index) => photo.image.id === b[index]?.image.id);

export function GalleryField({ photos, uploads, blocked, title, url, onChange }: Props) {
  const notify = useNotify();
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [chosen, setChosen] = useState<Chosen[] | null>(null);
  const [captioning, setCaptioning] = useState<GalleryPhoto | null>(null);
  const [describing, setDescribing] = useState<GalleryPhoto | null>(null);
  const [removing, setRemoving] = useState<GalleryPhoto | null>(null);
  // L'ordre à l'écran : il suit le doigt pendant qu'on glisse, et part au serveur une fois la photo posée.
  const [order, setOrder] = useState(photos);
  useEffect(() => setOrder(photos), [photos]);
  const sortable = useSortable(order, setOrder, { axis: "x" });
  const open = uploads.ready && !blocked;

  useEffect(() => {
    if (sortable.dragging !== null || sameOrder(order, photos)) return;
    void (async () => {
      const result = await change(url, "photos-order", { media: order.map((photo) => photo.image.id) });
      if (result.ok) onChange(result.photos);
      else {
        setOrder(photos);
        notify({ kind: "error", title: "L'ordre n'est pas enregistré", description: firstError(result.errors) });
      }
    })();
    // L'ordre part quand on lâche la photo (ou qu'on la déplace par son menu), pas à chaque pas du glisser.
  }, [sortable.dragging, order]);

  async function choose(list: FileList | null | undefined) {
    if (!list?.length || !open) return;
    const files = [...list];
    const refused = files.filter((file) => !typeOf(file) || file.size > uploads.maxBytes);
    if (refused.length)
      notify({
        kind: "error",
        title: refused.length > 1 ? `${refused.length} fichiers laissés de côté` : `« ${refused[0]!.name} » laissé de côté`,
        description: `Une image JPEG, PNG, WebP ou AVIF de ${uploads.maxBytes / 1_000_000} Mo au plus. Une photo HEIC (iPhone) : exporte-la en JPEG.`,
      });
    const kept = files.filter((file) => !refused.includes(file));
    if (kept.length) setChosen(await Promise.all(kept.map((file) => inspect(file, typeOf(file)!))));
  }

  /** Glisser des fichiers sur la galerie. */
  const drop = open
    ? {
        onDragOver: (event: DragEvent) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setOver(true);
        },
        onDragLeave: () => setOver(false),
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setOver(false);
          void choose(event.dataTransfer.files);
        },
      }
    : {};

  async function remove(photo: GalleryPhoto) {
    const result = await change(url, "photo-remove", { media: [photo.image.id] });
    if (!result.ok) return notify({ kind: "error", title: "La photo n'est pas retirée", description: firstError(result.errors) });
    onChange(result.photos);
    notify({ kind: "success", title: "Photo retirée de la galerie" });
  }

  return (
    <Flex direction="column" gap="3">
      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          const files = event.target.files;
          void choose(files).finally(() => (event.target.value = ""));
        }}
      />
      {order.length > 0 ? (
        <div className="admin-gallery" data-over={over || undefined} ref={(element) => void (sortable.container.current = element)} {...drop}>
          {order.map((photo, index) => (
            <figure key={photo.image.id} className="admin-gallery-photo" data-sort-index={index} data-dragging={sortable.dragging === index || undefined}>
              <div className="admin-gallery-image">
                <img src={photo.image.thumb} alt={photo.image.alt} width={photo.image.width ?? undefined} height={photo.image.height ?? undefined} loading="lazy" />
                <span className="admin-gallery-number" aria-hidden>
                  {index + 1}
                </span>
              </div>
              <figcaption className="admin-gallery-caption">
                <span className="admin-grip" aria-hidden title="Glisser pour déplacer" {...sortable.handle(index)}>
                  <DragHandleDots2Icon />
                </span>
                <button type="button" className="admin-gallery-text" onClick={() => setCaptioning(photo)}>
                  {photo.caption ? (
                    <Text size="1" className="admin-break">
                      {photo.caption}
                    </Text>
                  ) : (
                    <Text size="1" color="gray">
                      Ajouter une légende
                    </Text>
                  )}
                </button>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    <IconButton type="button" size="1" variant="ghost" color="gray" aria-label={`Photo ${index + 1} : plus d'actions`}>
                      <DotsHorizontalIcon />
                    </IconButton>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end" size="2">
                    <DropdownMenu.Item onSelect={() => setCaptioning(photo)}>Légende…</DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={() => setDescribing(photo)}>Texte de l'image…</DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item disabled={index === 0} onSelect={() => sortable.move(index, index - 1)}>
                      Déplacer avant
                    </DropdownMenu.Item>
                    <DropdownMenu.Item disabled={index === order.length - 1} onSelect={() => sortable.move(index, index + 1)}>
                      Déplacer après
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item color="red" onSelect={() => setRemoving(photo)}>
                      <TrashIcon /> Retirer…
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </figcaption>
            </figure>
          ))}
          {over && <span className="admin-image-hint">Lâche pour ajouter</span>}
        </div>
      ) : open ? (
        <button type="button" className="admin-image-drop admin-gallery-empty" data-over={over || undefined} onClick={() => picker.current?.click()} {...drop}>
          <span className="admin-empty-icon" aria-hidden>
            <ImageIcon width="22" height="22" />
          </span>
          <Text size="2" weight="medium">
            {over ? "Lâche les photos ici" : "Glisse des photos ici"}
          </Text>
          <Text size="2" color="gray">
            ou clique pour en choisir plusieurs d'un coup
          </Text>
          <Text size="1" color="gray">
            JPEG, PNG, WebP ou AVIF, {uploads.maxBytes / 1_000_000} Mo au plus chacune ; elles gardent leur cadre
          </Text>
        </button>
      ) : (
        <div className="admin-image-drop admin-gallery-empty" data-disabled>
          <span className="admin-empty-icon" aria-hidden>
            <ImageIcon width="22" height="22" />
          </span>
          <Text size="2" color="gray">
            {blocked ?? "Pas encore de photo."}
          </Text>
        </div>
      )}
      {order.length > 0 && (
        <Flex gap="3" align="center" wrap="wrap">
          <Button type="button" variant="soft" onClick={() => picker.current?.click()} disabled={!open}>
            <PlusIcon /> Ajouter des photos
          </Button>
          <Text size="1" color="gray">
            Glisse une photo par sa poignée pour changer l'ordre du site.
          </Text>
        </Flex>
      )}

      {chosen && (
        <AddPhotosDialog
          chosen={chosen}
          title={title}
          onClose={() => setChosen(null)}
          onAdd={async (sent) => {
            const result = await change(url, "photos-add", { media: sent.map((photo) => photo.image.id), caption: sent.map((photo) => photo.caption) });
            if (!result.ok) return firstError(result.errors);
            onChange(result.photos);
            notify({ kind: "success", title: sent.length > 1 ? `${sent.length} photos ajoutées` : "Photo ajoutée" });
            return null;
          }}
        />
      )}
      {captioning && (
        <CaptionDialog
          photo={captioning}
          onClose={() => setCaptioning(null)}
          onSave={async (caption) => {
            const result = await change(url, "photo-caption", { media: [captioning.image.id], caption: [caption] });
            if (!result.ok) return result.errors;
            onChange(result.photos);
            notify({ kind: "success", title: "Légende enregistrée" });
            return null;
          }}
        />
      )}
      {describing && (
        <DescribeDialog
          image={describing.image}
          kind="photo"
          onClose={() => setDescribing(null)}
          onDone={(image) => {
            onChange(photos.map((photo) => (photo.image.id === image.id ? { ...photo, image } : photo)));
            notify({ kind: "success", title: "Texte de l'image enregistré" });
          }}
        />
      )}
      <AlertDialog.Root open={removing !== null} onOpenChange={(next) => !next && setRemoving(null)}>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>Retirer cette photo ?</AlertDialog.Title>
          <AlertDialog.Description size="2">Elle sort de la galerie et du site. Son fichier est effacé s'il ne sert nulle part ailleurs.</AlertDialog.Description>
          <Flex gap="3" mt="5" justify="end" direction={{ initial: "column-reverse", sm: "row" }}>
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Annuler
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" onClick={() => removing && void remove(removing)}>
                <TrashIcon /> Retirer
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Les fenêtres
// ---------------------------------------------------------------------------------------------------------------

/** Une photo choisie, avant l'envoi : sa légende et son texte alternatif ; puis où en est son envoi. */
type Pending = { chosen: Chosen; caption: string; alt: string; state: "waiting" | "sending" | "sent" | "failed"; error?: string };

/**
 * Les photos choisies : chacune avec sa légende et son texte alternatif, un crédit pour toutes ; puis l'envoi, l'une
 * après l'autre, avec sa progression, et leur mise en place au bout de la galerie. Une photo refusée (trop petite,
 * illisible) est signalée ; les autres passent. Fermer la fenêtre pendant l'envoi l'arrête : les photos déjà
 * préparées mais pas mises en place sont retirées.
 */
function AddPhotosDialog({
  chosen,
  title,
  onClose,
  onAdd,
}: {
  chosen: Chosen[];
  title: string;
  onClose(): void;
  /** Met les photos envoyées au bout de la galerie ; rend null si c'est fait, sinon la raison du refus. */
  onAdd(sent: { image: MediaView; caption: string }[]): Promise<string | null>;
}) {
  const suggestion = title.trim() ? `Photo de « ${title.trim()} »` : "";
  const [items, setItems] = useState<Pending[]>(() => chosen.map((one) => ({ chosen: one, caption: "", alt: suggestion, state: "waiting" })));
  const [credit, setCredit] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [progress, setProgress] = useState<{ index: number; percent: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const sending = progress !== null;
  const small = (one: Chosen) => one.width !== null && one.height !== null && Math.min(one.width, one.height) < MIN_SIDE;
  const update = (index: number, change: Partial<Pending>) => setItems((current) => current.map((item, at) => (at === index ? { ...item, ...change } : item)));

  // Les aperçus vivent le temps de la fenêtre ; fermer l'onglet couperait l'envoi.
  useEffect(() => () => chosen.forEach((one) => URL.revokeObjectURL(one.preview)), [chosen]);
  useEffect(() => {
    if (!sending) return;
    const hold = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener("beforeunload", hold);
    return () => removeEventListener("beforeunload", hold);
  }, [sending]);
  useEffect(() => () => controller.current?.abort(), []);

  async function send(event: SubmitEvent) {
    event.preventDefault();
    // La fenêtre est rendue hors de la fiche, mais ses événements remontent jusqu'à elle : pas d'enregistrement de la fiche.
    event.stopPropagation();
    if (sending) return;
    const missing = items.findIndex((item) => item.state !== "sent" && !small(item.chosen) && !item.alt.trim());
    if (missing >= 0) return setErrors({ [`alt.${missing}`]: "Décris la photo en quelques mots." });
    setErrors({});
    const abort = new AbortController();
    controller.current = abort;
    const sent: { image: MediaView; caption: string }[] = [];
    const sentAt = new Set<number>();
    for (const [index, item] of items.entries()) {
      if (item.state === "sent" || small(item.chosen)) continue;
      if (abort.signal.aborted) break;
      update(index, { state: "sending", error: undefined });
      setProgress({ index, percent: 0 });
      try {
        const result = await sendImage(item.chosen, {
          shape: "free",
          focus: 0.5,
          text: { alt: item.alt, credit, decorative: false },
          onProgress: ({ percent }) => setProgress({ index, percent }),
          signal: abort.signal,
        });
        if (!result.ok) {
          update(index, { state: "failed", error: result.errors.alt ?? result.errors.credit ?? result.message });
          if (result.errors.credit) setErrors({ credit: result.errors.credit });
          continue;
        }
        sent.push({ image: result.image, caption: item.caption.trim() });
        sentAt.add(index);
        update(index, { state: "sent" });
      } catch (error) {
        if (abort.signal.aborted) break;
        update(index, { state: "failed", error: error instanceof Error && error.message ? error.message : "L'envoi a échoué. Réessaie." });
      }
    }
    if (abort.signal.aborted) {
      for (const one of sent) void abandonImage(one.image);
      return;
    }
    setProgress(null);
    controller.current = null;
    if (sent.length) {
      const refused = await onAdd(sent);
      if (refused) {
        for (const one of sent) void abandonImage(one.image);
        setItems((current) => current.map((item) => (item.state === "sent" ? { ...item, state: "waiting" } : item)));
        return setErrors({ form: refused });
      }
    }
    // Tout est passé (les trop petites, déjà signalées, restent de côté) : la fenêtre se ferme ; sinon elle reste, avec
    // les photos refusées, à corriger ou à laisser.
    if (sentAt.size === items.filter((item) => !small(item.chosen)).length) return onClose();
    setItems((current) => current.filter((_, index) => !sentAt.has(index)));
  }

  const count = items.filter((item) => !small(item.chosen)).length;
  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (next) return;
        controller.current?.abort();
        onClose();
      }}
    >
      <Dialog.Content maxWidth="640px" aria-describedby={undefined}>
        <form noValidate onSubmit={send}>
          <Dialog.Title size="4">{items.length > 1 ? `${items.length} nouvelles photos` : "Nouvelle photo"}</Dialog.Title>
          <Flex direction="column" gap="3" className="admin-gallery-new">
            {items.map((item, index) => (
              <div key={item.chosen.preview} className="admin-gallery-new-row" data-state={item.state}>
                <img src={item.chosen.preview} alt="" className="admin-gallery-new-thumb" />
                <Flex direction="column" gap="2" minWidth="0" flexGrow="1">
                  <Text size="1" color="gray" className="admin-break">
                    {[item.chosen.file.name, item.chosen.width && item.chosen.height ? `${item.chosen.width} × ${item.chosen.height}` : null, weight(item.chosen.file.size)].filter(Boolean).join(" · ")}
                  </Text>
                  {small(item.chosen) ? (
                    <Text size="1" color="red">
                      Trop petite : il faut {MIN_SIDE} pixels de côté au moins. Elle ne sera pas envoyée.
                    </Text>
                  ) : (
                    <>
                      <TextField.Root
                        value={item.caption}
                        onChange={(e) => update(index, { caption: e.target.value })}
                        placeholder="Légende (facultative) : « Le vernissage »"
                        aria-label={`Légende de ${item.chosen.file.name}`}
                        maxLength={240}
                        disabled={sending || item.state === "sent"}
                      />
                      <TextField.Root
                        value={item.alt}
                        onChange={(e) => update(index, { alt: e.target.value })}
                        placeholder="Texte alternatif : ce que montre la photo"
                        aria-label={`Texte alternatif de ${item.chosen.file.name}`}
                        maxLength={300}
                        disabled={sending || item.state === "sent"}
                        color={errors[`alt.${index}`] ? "red" : undefined}
                      />
                      {errors[`alt.${index}`] && (
                        <Text size="1" color="red" role="alert">
                          {errors[`alt.${index}`]}
                        </Text>
                      )}
                      {item.state === "failed" && (
                        <Text size="1" color="red" role="alert">
                          {item.error}
                        </Text>
                      )}
                      {item.state === "sending" && progress?.index === index && (
                        <Progress size="1" value={progress.percent >= 100 ? undefined : progress.percent} aria-label={`Envoi de ${item.chosen.file.name}`} />
                      )}
                      {item.state === "sent" && (
                        <Text size="1" color="green">
                          Envoyée
                        </Text>
                      )}
                    </>
                  )}
                </Flex>
              </div>
            ))}
          </Flex>
          <Field label="Crédit, pour toutes" htmlFor="gallery-credit" optional hint="Le nom du ou de la photographe : « © Prénom Nom »." error={errors.credit}>
            <TextField.Root id="gallery-credit" value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="© Prénom Nom" maxLength={120} disabled={sending} autoComplete="off" />
          </Field>
          {errors.form && (
            <Callout.Root color="red" size="1" mt="4" role="alert">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>{errors.form}</Callout.Text>
            </Callout.Root>
          )}
          {sending && (
            <Text as="p" size="1" color="gray" mt="3" aria-live="polite">
              Envoi de la photo {items.slice(0, progress.index + 1).filter((item) => !small(item.chosen)).length} sur {count}…
            </Text>
          )}
          <Flex gap="3" mt="5" justify="end" direction={{ initial: "column-reverse", sm: "row" }}>
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray">
                {sending ? "Arrêter" : "Annuler"}
              </Button>
            </Dialog.Close>
            <Button type="submit" loading={sending} disabled={!count}>
              <UploadIcon /> {count > 1 ? `Envoyer les ${count} photos` : "Envoyer la photo"}
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** La légende d'une photo de la galerie, changée sur place. */
function CaptionDialog({ photo, onClose, onSave }: { photo: GalleryPhoto; onClose(): void; onSave(caption: string): Promise<FieldErrors | null> }) {
  const [caption, setCaption] = useState(photo.caption);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function save(event: SubmitEvent) {
    event.preventDefault();
    event.stopPropagation();
    setBusy(true);
    const errors = await onSave(caption);
    setBusy(false);
    if (errors) return setError(errors.caption ?? firstError(errors));
    onClose();
  }

  return (
    <Dialog.Root open onOpenChange={(next) => !next && !busy && onClose()}>
      <Dialog.Content maxWidth="480px" aria-describedby={undefined}>
        <form noValidate onSubmit={save}>
          <Dialog.Title size="4">Légende de la photo</Dialog.Title>
          <Flex gap="3" align="start">
            <img src={photo.image.thumb} alt="" className="admin-gallery-new-thumb" />
            <Field label="Légende" htmlFor="gallery-caption" optional hint="Une phrase sous la photo, sur le site. Vide : pas de légende." error={error}>
              <TextField.Root id="gallery-caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Le vernissage" maxLength={240} disabled={busy} autoFocus />
            </Field>
          </Flex>
          <Flex gap="3" mt="5" justify="end" direction={{ initial: "column-reverse", sm: "row" }}>
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray" disabled={busy}>
                Annuler
              </Button>
            </Dialog.Close>
            <Button type="submit" loading={busy}>
              Enregistrer la légende
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
