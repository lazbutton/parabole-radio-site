/**
 * Ce que les résidents envoient, dans l'admin (cms/README.md, 9.12) :
 *   - dans la fiche d'un artiste, son lien d'envoi : le créer, le copier pour le lui envoyer, le remplacer, le
 *     désactiver ;
 *   - dans la fiche d'un show, l'envoi (qui, quand, pour quel bloc, son mot, le lien de sa playlist) et les créneaux où
 *     le rattacher s'il attend le sien ; le son reçu, à écouter, valider, télécharger (le MP3 à charger dans Radio Cult)
 *     ou effacer, et à publier tout de suite sur SoundCloud (9.14) ; les morceaux d'une playlist.
 * Chaque action part tout de suite, à l'adresse de la fiche, sans enregistrer le reste.
 */
import { LABELS } from "@parabole/cms/labels";
import { CheckIcon, CopyIcon, DownloadIcon, ExternalLinkIcon, TrashIcon, UploadIcon } from "@radix-ui/react-icons";
import { AlertDialog, Badge, Button, Callout, DataList, Flex, IconButton, RadioCards, Spinner, Text, TextField } from "@radix-ui/themes";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "./router";
import { postForm, Section, SidePanel } from "./sheet";
import { counted } from "./text";
import { useNotify } from "./toast";
import type { AttachResponse, AudioView, EnvoiResponse, EnvoiView, ShowSheet, UploadLinkResponse, UploadLinkView } from "./types";

const TONES: Record<AudioView["status"], "gray" | "amber" | "green" | "blue" | "red"> = { uploading: "gray", received: "amber", approved: "green", sending: "blue", sent: "green", failed: "red" };

const fields = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
};

/** Une confirmation avant une action qui ne se défait pas. */
function Confirm({ open, title, action, busy, color = "red", onConfirm, onClose, children }: { open: boolean; title: string; action: string; busy: boolean; color?: "red" | "indigo"; onConfirm(): void; onClose(): void; children: ReactNode }) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialog.Content maxWidth="440px">
        <AlertDialog.Title>{title}</AlertDialog.Title>
        <AlertDialog.Description size="2">{children}</AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" disabled={busy}>
              Annuler
            </Button>
          </AlertDialog.Cancel>
          <Button color={color} loading={busy} onClick={onConfirm}>
            {action}
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Le lien d'envoi d'un artiste
// ---------------------------------------------------------------------------------------------------------------

/** L'adresse complète d'un lien : le serveur ne donne que son chemin, la page connaît son origine. */
function useOrigin() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(location.origin), []);
  return origin;
}

export function UploadLinkPanel({ url, name, link, onChange }: { url: string; name: string; link: UploadLinkView | null; onChange(link: UploadLinkView | null): void }) {
  const notify = useNotify();
  const origin = useOrigin();
  const [busy, setBusy] = useState<"create" | "renew" | "delete" | null>(null);
  const [asking, setAsking] = useState<"renew" | "delete" | null>(null);

  async function copy(target: UploadLinkView) {
    try {
      await navigator.clipboard.writeText(`${location.origin}${target.path}`);
      notify({ kind: "success", title: "Lien copié", description: `Colle-le dans ton message à ${name}.` });
    } catch {
      notify({ kind: "error", title: "Copie impossible", description: "Sélectionne le lien, puis copie-le à la main." });
    }
  }

  async function run(action: "create" | "renew" | "delete") {
    setBusy(action);
    const result = await postForm<UploadLinkResponse>(url, fields({ intent: "link", action }));
    setBusy(null);
    setAsking(null);
    if (!result.ok) return notify({ kind: "error", title: "Le lien n'a pas changé", description: result.errors.form });
    onChange(result.link);
    notify({ kind: "success", title: result.message });
  }

  return (
    <SidePanel title="Lien d'envoi">
      {link ? (
        <Flex direction="column" gap="3">
          <TextField.Root readOnly value={`${origin}${link.path}`} aria-label={`Lien d'envoi de ${name}`} onFocus={(event) => event.currentTarget.select()} className="admin-mono" size="1" />
          <Flex gap="2" wrap="wrap">
            <Button type="button" size="2" onClick={() => void copy(link)}>
              <CopyIcon /> Copier
            </Button>
            <Button type="button" size="2" variant="soft" asChild>
              <a href={link.path} target="_blank" rel="noreferrer">
                <ExternalLinkIcon /> Ouvrir
              </a>
            </Button>
          </Flex>
          <DataList.Root size="1" className="admin-facts">
            <DataList.Item>
              <DataList.Label minWidth="80px">Créé</DataList.Label>
              <DataList.Value>{link.created}</DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label minWidth="80px">Ouvert</DataList.Label>
              <DataList.Value>{link.used ?? "Pas encore"}</DataList.Value>
            </DataList.Item>
            {link.profile && (
              <DataList.Item>
                <DataList.Label minWidth="80px">Sa fiche</DataList.Label>
                <DataList.Value>Bio ou photo changée le {link.profile}</DataList.Value>
              </DataList.Item>
            )}
          </DataList.Root>
          <Flex gap="3" wrap="wrap">
            <Button type="button" size="1" variant="ghost" color="gray" onClick={() => setAsking("renew")}>
              Nouveau lien
            </Button>
            <Button type="button" size="1" variant="ghost" color="red" onClick={() => setAsking("delete")}>
              Désactiver
            </Button>
          </Flex>
        </Flex>
      ) : (
        <Flex direction="column" gap="3" align="start">
          <Text size="2" color="gray">
            Sa page à lui pour envoyer ses émissions, et mettre à jour sa bio et sa photo, sans compte.
          </Text>
          <Button type="button" size="2" variant="soft" loading={busy === "create"} onClick={() => void run("create")}>
            Créer le lien
          </Button>
        </Flex>
      )}
      <Confirm open={asking === "renew"} title="Remplacer le lien ?" action="Nouveau lien" color="indigo" busy={busy === "renew"} onConfirm={() => void run("renew")} onClose={() => setAsking(null)}>
        L'ancien lien cessera de marcher : envoie le nouveau à {name}. Ce qu'il a déjà envoyé reste.
      </Confirm>
      <Confirm open={asking === "delete"} title="Désactiver le lien ?" action="Désactiver" busy={busy === "delete"} onConfirm={() => void run("delete")} onClose={() => setAsking(null)}>
        {name} ne pourra plus rien envoyer, jusqu'à ce qu'on lui crée un nouveau lien. Ce qu'il a déjà envoyé reste.
      </Confirm>
    </SidePanel>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// L'envoi d'un show
// ---------------------------------------------------------------------------------------------------------------

/** Qui a envoyé, quand, pour quel bloc ; son mot ; le lien de sa playlist ; et le créneau où le rattacher. */
export function SubmissionPanel({ url, envoi, dirty }: { url: string; envoi: EnvoiView; dirty: boolean }) {
  const router = useRouter();
  const notify = useNotify();
  const [target, setTarget] = useState<EnvoiView["candidates"][number] | null>(null);
  const [busy, setBusy] = useState(false);
  const sent = envoi.submission;
  if (!sent) return null;

  async function attach() {
    if (!target) return;
    setBusy(true);
    const result = await postForm<AttachResponse>(url, fields({ intent: "attach", to: target.id }));
    setBusy(false);
    if (!result.ok) return notify({ kind: "error", title: "Pas rattaché", description: result.errors.form });
    setTarget(null);
    router.invalidate();
    router.setBlocker(null);
    notify({ kind: "success", title: result.message, description: "Voici la fiche du créneau, avec l'envoi." });
    router.navigate(result.redirect, { replace: true });
  }

  return (
    <SidePanel title="Envoi" aside={sent.late ? <Badge color="red">En retard</Badge> : undefined}>
      <Flex direction="column" gap="3">
        <DataList.Root size="1" className="admin-facts">
          <DataList.Item>
            <DataList.Label minWidth="80px">De</DataList.Label>
            <DataList.Value>
              {sent.artist ? (
                <a href={`/admin/artistes/${sent.artist.id}`} className="admin-link-text">
                  {sent.artist.name}
                </a>
              ) : (
                "Artiste supprimé"
              )}
            </DataList.Value>
          </DataList.Item>
          <DataList.Item>
            <DataList.Label minWidth="80px">Reçu</DataList.Label>
            <DataList.Value>{sent.updated ? `${sent.sent} · modifié le ${sent.updated}` : sent.sent}</DataList.Value>
          </DataList.Item>
          {sent.block && (
            <DataList.Item>
              <DataList.Label minWidth="80px">Pour le</DataList.Label>
              <DataList.Value>{[sent.block, sent.week].filter(Boolean).join(", ")}</DataList.Value>
            </DataList.Item>
          )}
          {sent.link && (
            <DataList.Item>
              <DataList.Label minWidth="80px">Playlist</DataList.Label>
              <DataList.Value>
                <a href={sent.link} target="_blank" rel="noopener noreferrer" className="admin-link-text admin-break">
                  {sent.link.replace(/^https:\/\/(www\.)?/, "")}
                </a>
              </DataList.Value>
            </DataList.Item>
          )}
        </DataList.Root>
        {sent.note && (
          <blockquote className="admin-envoi-note">
            <Text size="2">{sent.note}</Text>
          </blockquote>
        )}
        {sent.waiting && (
          <Callout.Root size="1" color="amber">
            <Callout.Text>
              {envoi.candidates.length
                ? "Il attend son créneau. Rattache-le à celui de la grille : le titre, la description, les étiquettes, la tracklist, la pochette et le son y passent, la date reste celle du créneau."
                : "Il attend son créneau : dès qu'il est dans la grille de Radio Cult et importé, il s'y rattache tout seul, la nuit, s'il est le seul possible."}
            </Callout.Text>
          </Callout.Root>
        )}
        {sent.waiting &&
          envoi.candidates.map((slot) => (
            <Flex key={slot.id} align="center" justify="between" gap="2" className="admin-envoi-slot">
              <Flex direction="column" minWidth="0">
                <Text size="2" weight="medium" className="admin-break">
                  {slot.title}
                </Text>
                <Text size="1" color="gray">
                  {slot.when}
                </Text>
              </Flex>
              <Button type="button" size="1" variant="soft" onClick={() => setTarget(slot)} disabled={dirty} title={dirty ? "Enregistre d'abord la fiche." : undefined}>
                Rattacher
              </Button>
            </Flex>
          ))}
      </Flex>
      <Confirm open={target !== null} title="Rattacher l'envoi à ce créneau ?" action="Rattacher" color="indigo" busy={busy} onConfirm={() => void attach()} onClose={() => setTarget(null)}>
        « {target?.title} », {target?.when}. L'envoi et ses fichiers passent sur le créneau, qui garde sa date et sa durée ; cette fiche provisoire est
        supprimée.
      </Confirm>
    </SidePanel>
  );
}

/** Un fichier reçu : à écouter, valider, télécharger, effacer. */
function useAudioActions(url: string, onChange: (envoi: EnvoiView) => void) {
  const notify = useNotify();
  const [busy, setBusy] = useState<string | null>(null);
  async function run(intent: "approve-audio" | "delete-audio", file: AudioView): Promise<boolean> {
    setBusy(`${intent}:${file.id}`);
    const result = await postForm<EnvoiResponse>(url, fields({ intent, file: file.id }));
    setBusy(null);
    if (!result.ok) {
      notify({ kind: "error", title: intent === "approve-audio" ? "Pas validé" : "Pas effacé", description: result.errors.form });
      return false;
    }
    onChange(result.envoi);
    notify({ kind: "success", title: result.message });
    return true;
  }
  return { busy, run };
}

/** Où en est le son, en une phrase sous ses boutons. */
function soundHint(main: AudioView, scheduled: boolean): string {
  if (main.status === "received") return "Écoute-le, puis valide-le : validé, il part tout seul sur SoundCloud le lendemain matin de sa diffusion.";
  if (main.status === "approved")
    return scheduled
      ? "Le MP3 à charger dans Radio Cult pour la diffusion. Il part tout seul sur SoundCloud le lendemain matin."
      : "Le MP3 à charger dans Radio Cult. Sans date de diffusion, il ne part pas tout seul sur SoundCloud.";
  if (main.status === "sending")
    return main.stalled ? "L'envoi vers SoundCloud s'est interrompu : relance-le." : "En route vers SoundCloud : la fiche se met à jour toute seule. Tu peux la quitter, l'envoi continue.";
  if (main.status === "sent") return "Publié sur SoundCloud : sa piste est ci-dessous.";
  if (main.status === "failed") return "Règle ce qui bloque, puis « Publier maintenant » le renvoie.";
  return "Le MP3 à charger dans Radio Cult pour la diffusion.";
}

/** Le choix avant de publier tout de suite : en public (la page de l'émission suit) ou en privé, pour un essai. */
function PublishDialog({ open, scheduled, busy, onPublish, onClose }: { open: boolean; scheduled: boolean; busy: boolean; onPublish(sharing: "public" | "private"): void; onClose(): void }) {
  const [sharing, setSharing] = useState<"public" | "private">("public");
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialog.Content maxWidth="460px">
        <AlertDialog.Title>Publier sur SoundCloud ?</AlertDialog.Title>
        <AlertDialog.Description size="2">
          Le son part tout de suite sur le compte de Parabole, avec ce qui est enregistré dans la fiche : titre, artistes, description, tracklist, étiquettes et
          pochette.
        </AlertDialog.Description>
        <RadioCards.Root value={sharing} onValueChange={(value) => setSharing(value === "private" ? "private" : "public")} columns="1" gap="2" mt="3" size="1">
          <RadioCards.Item value="public">
            <Flex direction="column" width="100%">
              <Text size="2" weight="bold">
                En public
              </Text>
              <Text size="1" color="gray">
                {scheduled ? "Visible de tous, et la page de l'émission est publiée sur le site." : "Visible de tous. La page de l'émission reste en brouillon : elle n'a pas de date de diffusion."}
              </Text>
            </Flex>
          </RadioCards.Item>
          <RadioCards.Item value="private">
            <Flex direction="column" width="100%">
              <Text size="2" weight="bold">
                En privé, pour un essai
              </Text>
              <Text size="1" color="gray">
                Seul le compte de Parabole la voit, et la page ne change pas. Pour l'ouvrir à tous ensuite : passe-la en public sur SoundCloud, puis publie la page
                ici.
              </Text>
            </Flex>
          </RadioCards.Item>
        </RadioCards.Root>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" disabled={busy}>
              Annuler
            </Button>
          </AlertDialog.Cancel>
          <Button loading={busy} onClick={() => onPublish(sharing)}>
            Publier
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

/** La fiche d'un show telle que l'enregistre le serveur (l'écran en JSON), ou null s'il ne la rend pas. */
async function readSheet(url: string): Promise<ShowSheet | null> {
  const screen = (await fetch(url, { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null)) as { name?: string; data?: { sheet?: ShowSheet } } | null;
  return (screen?.name === "show" && screen.data?.sheet) || null;
}

/** La fiche, relue toutes les 5 secondes tant que son son est en route vers SoundCloud : onDone la reçoit dès qu'il ne l'est plus. */
function useSendingWatch(url: string, sending: boolean, onDone: (sheet: ShowSheet) => void) {
  const latest = useRef(onDone);
  latest.current = onDone;
  useEffect(() => {
    if (!sending) return;
    let live = true;
    const timer = window.setInterval(async () => {
      const fresh = await readSheet(url);
      if (!live || !fresh) return;
      const main = fresh.envoi.main;
      if (main?.status === "sending" && !main.stalled) return;
      live = false;
      window.clearInterval(timer);
      latest.current(fresh);
    }, 5000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [url, sending]);
}

/**
 * Le son reçu d'un show, en tête du panneau Son : le lecteur, sa place dans le circuit, et ses actions. « Publier
 * maintenant » l'envoie sur SoundCloud sans attendre le lendemain matin, ou le renvoie après un échec ; pendant
 * l'envoi, la fiche se relit toutes les 5 secondes, puis prend la piste (onPublished).
 */
export function ReceivedSound({
  url,
  envoi,
  dirty,
  scheduled,
  onChange,
  onPublished,
}: {
  url: string;
  envoi: EnvoiView;
  /** La fiche a des changements pas enregistrés : SoundCloud ne recevrait pas ce qu'on y voit. */
  dirty: boolean;
  /** La fiche a une date de diffusion (un créneau de la grille). */
  scheduled: boolean;
  onChange(envoi: EnvoiView): void;
  onPublished(sheet: ShowSheet): void;
}) {
  const notify = useNotify();
  const { busy, run } = useAudioActions(url, onChange);
  const [asking, setAsking] = useState(false);
  const [publishing, setPublishing] = useState<"ask" | "busy" | null>(null);
  const main = envoi.main;
  const sending = main?.status === "sending" && !main.stalled;

  /** L'envoi est fini : la fiche prend la piste (ou l'échec), et on dit comment ça s'est passé. */
  function finish(fresh: ShowSheet) {
    onPublished(fresh);
    const now = fresh.envoi.main;
    if (now?.status === "sent")
      notify({ kind: "success", title: "Publié sur SoundCloud", description: fresh.status === "published" ? "La page de l'émission est en ligne aussi." : "La page de l'émission n'a pas changé." });
    else if (now?.status === "failed") notify({ kind: "error", title: "SoundCloud n'a pas pris le son", description: now.error ?? undefined });
    else if (now?.stalled) notify({ kind: "error", title: "L'envoi vers SoundCloud s'est interrompu", description: "Relance-le avec « Publier maintenant »." });
  }
  useSendingWatch(url, sending, finish);

  async function publish(sharing: "public" | "private") {
    setPublishing("busy");
    const result = await postForm<EnvoiResponse>(url, fields({ intent: "soundcloud-publish", sharing }));
    if (!result.ok) {
      setPublishing("ask");
      notify({ kind: "error", title: "Pas envoyé", description: result.errors.form });
      return;
    }
    setPublishing(null);
    onChange(result.envoi);
    if (result.envoi.main?.status === "sending") {
      notify({ kind: "success", title: result.message, description: "La fiche se met à jour toute seule ; tu peux la quitter, l'envoi continue." });
      return;
    }
    // Déjà fini (un refus tout de suite) : la fiche se relit sans attendre.
    const fresh = await readSheet(url);
    if (fresh) finish(fresh);
  }

  if (!main) return null;
  const publishable = main.status === "approved" || main.status === "failed" || (main.status === "sending" && main.stalled);
  const blocked =
    envoi.soundcloud === "off"
      ? "SoundCloud n'est pas branché : il manque son appli (SOUNDCLOUD_CLIENT_ID et SOUNDCLOUD_CLIENT_SECRET)."
      : envoi.soundcloud === "unlinked"
        ? "SoundCloud n'est pas relié : un admin le relie depuis l'accueil de l'admin."
        : dirty
          ? "Enregistre d'abord la fiche : SoundCloud reçoit ce qui est enregistré."
          : null;
  return (
    <Flex direction="column" gap="2" className="admin-received">
      <Flex justify="between" align="start" gap="2">
        <Text size="2" weight="medium" className="admin-break">
          {main.fileName}
        </Text>
        <Badge color={main.stalled ? "red" : TONES[main.status]} className="admin-nowrap">
          {sending && <Spinner size="1" />}
          {main.stalled ? "Interrompu" : LABELS.audioStatus[main.status]}
        </Badge>
      </Flex>
      {main.size && (
        <Text size="1" color="gray">
          {main.size}
        </Text>
      )}
      {envoi.ready ? (
        <audio controls preload="none" src={main.listen} className="admin-audio">
          <a href={main.download} download>
            Télécharger le son
          </a>
        </audio>
      ) : (
        <Text size="1" color="gray">
          Le seau des fichiers son n'est pas branché : on ne peut pas l'écouter d'ici.
        </Text>
      )}
      {main.error && (
        <Text size="1" color="red">
          {main.error}
        </Text>
      )}
      <Flex gap="2" wrap="wrap" align="center">
        {main.status === "received" && (
          <Button type="button" size="2" loading={busy === `approve-audio:${main.id}`} onClick={() => void run("approve-audio", main)}>
            <CheckIcon /> Valider
          </Button>
        )}
        {envoi.ready && (
          <Button type="button" size="2" variant="soft" asChild>
            <a href={main.download} download>
              <DownloadIcon /> Télécharger
            </a>
          </Button>
        )}
        {publishable && (
          <Button type="button" size="2" variant={main.status === "approved" ? "soft" : "solid"} disabled={blocked !== null} onClick={() => setPublishing("ask")}>
            <UploadIcon /> Publier maintenant
          </Button>
        )}
        <IconButton type="button" size="2" variant="ghost" color="red" aria-label="Effacer le son" title="Effacer le son" disabled={main.status === "sending"} onClick={() => setAsking(true)}>
          <TrashIcon />
        </IconButton>
      </Flex>
      <Text size="1" color="gray">
        {publishable && blocked ? blocked : soundHint(main, scheduled)}
      </Text>
      <PublishDialog open={publishing !== null} scheduled={scheduled} busy={publishing === "busy"} onPublish={(sharing) => void publish(sharing)} onClose={() => setPublishing(null)} />
      <Confirm
        open={asking}
        title="Effacer le son ?"
        action="Effacer"
        busy={busy === `delete-audio:${main.id}`}
        onConfirm={() => void run("delete-audio", main).then((done) => done && setAsking(false))}
        onClose={() => setAsking(false)}
      >
        « {main.fileName} » sera effacé pour de bon. Le résident pourra en renvoyer un depuis son lien.
      </Confirm>
    </Flex>
  );
}

/** Les morceaux d'une playlist, reçus du curateur : dans l'ordre, à télécharger un à un. */
export function ReceivedParts({ url, envoi, onChange }: { url: string; envoi: EnvoiView; onChange(envoi: EnvoiView): void }) {
  const { busy, run } = useAudioActions(url, onChange);
  const [asking, setAsking] = useState<AudioView | null>(null);
  if (!envoi.parts.length) return null;
  return (
    <Section title="Morceaux reçus" count={<Badge color="gray" radius="full">{envoi.parts.length}</Badge>}>
      <Text as="p" size="2" color="gray" mb="3">
        {counted(envoi.parts.length, "morceau envoyé", "morceaux envoyés")} par le curateur, dans l'ordre de sa playlist. Ils seront enchaînés en un seul fichier.
      </Text>
      <ol className="admin-parts">
        {envoi.parts.map((part, index) => (
          <li key={part.id} className="admin-part">
            <span className="admin-track-number">{index + 1}</span>
            <Flex direction="column" minWidth="0" flexGrow="1">
              <Text size="2" weight="medium" className="admin-break">
                {[part.artist, part.title].filter(Boolean).join(" – ") || part.fileName}
              </Text>
              <Text size="1" color="gray" className="admin-break">
                {[part.duration, part.size, part.fileName].filter(Boolean).join(" · ")}
              </Text>
            </Flex>
            {envoi.ready && (
              <IconButton size="1" variant="ghost" color="gray" asChild>
                <a href={part.download} download aria-label={`Télécharger le morceau ${index + 1}`} title="Télécharger">
                  <DownloadIcon />
                </a>
              </IconButton>
            )}
            <IconButton type="button" size="1" variant="ghost" color="red" aria-label={`Effacer le morceau ${index + 1}`} title="Effacer" onClick={() => setAsking(part)}>
              <TrashIcon />
            </IconButton>
          </li>
        ))}
      </ol>
      <Confirm
        open={asking !== null}
        title="Effacer ce morceau ?"
        action="Effacer"
        busy={asking !== null && busy === `delete-audio:${asking.id}`}
        onConfirm={() => asking && void run("delete-audio", asking).then((done) => done && setAsking(null))}
        onClose={() => setAsking(null)}
      >
        « {asking ? [asking.artist, asking.title].filter(Boolean).join(" – ") || asking.fileName : ""} » sera effacé pour de bon.
      </Confirm>
    </Section>
  );
}
