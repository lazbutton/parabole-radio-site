/**
 * Une candidature (cms/README.md, 9.17) : à gauche, ce qu'elle dit (son idée, le lien à écouter, ses styles) et la
 * réponse ; à droite, le contact, la note de l'équipe et les informations. La réponse se donne en un clic, confirmé :
 *   - « Oui » crée la fiche d'invité, en brouillon (ou reprend la fiche qui porte déjà ce nom), et son lien d'envoi ;
 *   - « Pas cette fois » note le refus ; la candidature est effacée six mois après.
 * Puis l'écran prépare le message à envoyer, modifiable : le copier pour Insta, ou l'ouvrir dans la messagerie, avec
 * l'adresse et l'objet. « Mettre de côté » range une candidature à réécouter ; un refus se reprend tant qu'il n'est pas
 * effacé. « Effacer » la retire tout de suite (indésirable, ou demandé par la personne).
 */
import { LABELS } from "@parabole/cms/labels";
import {
  ArrowLeftIcon,
  BookmarkIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  Cross2Icon,
  EnvelopeClosedIcon,
  ExclamationTriangleIcon,
  InstagramLogoIcon,
  ResetIcon,
  SewingPinIcon,
  SpeakerLoudIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { AlertDialog, Badge, Button, Callout, Flex, Link, Text, TextArea } from "@radix-ui/themes";
import { useEffect, useState, type ReactNode } from "react";
import { APPLICATION_STATUS } from "./ApplicationsList";
import { PageHeader } from "./AdminShell";
import { StatusBadge, TypeTile } from "./marks";
import { forgetRecent } from "./recents";
import { useRouter } from "./router";
import { FormError, postForm, Section, SidePanel } from "./sheet";
import { useNotify } from "./toast";
import type { ApplicationData, ApplicationResponse, ApplicationSheet } from "./types";

type Intent = "note" | "shortlist" | "reopen" | "accept" | "decline" | "delete";

const SIGNATURE = "L'équipe de Parabole Radio";

/** Le message du oui, avec le lien d'envoi en entier. */
export function messageOui(name: string, link: string) {
  return [
    `Salut ${name} !`,
    "Merci pour ta candidature : on a adoré, et on aimerait te faire passer sur Parabole Radio.",
    `Voici ton lien perso pour envoyer ton émission, sans compte ni mot de passe :\n${link}`,
    "Tu peux aussi y compléter ta bio et ta photo, pour ta page sur le site. On te dit vite quand ton émission passe à l'antenne.",
    `À très vite,\n${SIGNATURE}`,
  ].join("\n\n");
}

/** Le message du refus : merci, pas cette fois, la porte reste ouverte. */
export function messageNon(name: string) {
  return [
    `Salut ${name} !`,
    "Merci pour ta candidature et pour le temps que tu y as mis. Ce ne sera pas pour cette fois, mais la porte reste ouverte : n'hésite pas à recandidater plus tard, avec un nouveau projet.",
    `Belle continuation,\n${SIGNATURE}`,
  ].join("\n\n");
}

export function ApplicationScreen({ sheet: initial }: ApplicationData) {
  const router = useRouter();
  const notify = useNotify();
  const [sheet, setSheet] = useState<ApplicationSheet>(initial);
  const [note, setNote] = useState(initial.note);
  const [busy, setBusy] = useState<Intent | null>(null);
  const [asking, setAsking] = useState<"accept" | "decline" | "delete" | null>(null);
  const [error, setError] = useState<string>();
  const url = `/admin/candidatures/${sheet.id}`;
  const status = APPLICATION_STATUS[sheet.status];
  const answered = sheet.status === "accepted" || sheet.status === "declined";

  async function run(intent: Intent) {
    setBusy(intent);
    setError(undefined);
    const body = new FormData();
    body.set("intent", intent);
    if (intent === "note") body.set("note", note);
    const result = await postForm<ApplicationResponse>(url, body);
    setBusy(null);
    setAsking(null);
    if (!result.ok) {
      setError(result.errors.form ?? Object.values(result.errors)[0]);
      return;
    }
    router.invalidate();
    if (result.message) notify({ kind: "success", title: result.message });
    if (intent === "delete") {
      forgetRecent(url);
      router.navigate(result.redirect ?? "/admin/candidatures");
      return;
    }
    setSheet(result.sheet);
    setNote(result.sheet.note);
  }

  const facts = [LABELS.showType[sheet.type], sheet.ready ? "déjà enregistrée" : "pas encore enregistrée", sheet.regular === true ? "régulièrement" : sheet.regular === false ? "une fois" : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="admin-page">
      <PageHeader
        title={sheet.name}
        description={
          <Flex as="span" align="center" gap="2" wrap="wrap">
            <Badge color={status.color} variant="soft" radius="full">
              {status.label}
            </Badge>
            {sheet.late && (
              <Badge color="red" variant="soft" radius="full">
                En retard
              </Badge>
            )}
            <span>
              Reçue {sheet.received}, le {sheet.receivedAt}
            </span>
          </Flex>
        }
        actions={
          <Button variant="soft" color="gray" asChild>
            <a href="/admin/candidatures" data-astro-prefetch="false">
              <ArrowLeftIcon /> Candidatures
            </a>
          </Button>
        }
      />
      <FormError message={error} />

      <div className="admin-sheet-grid">
        <div className="admin-sheet-main">
          <Section title="Son émission">
            <Flex direction="column" gap="4">
              <Flex align="center" gap="3">
                <TypeTile type={sheet.type} size={40} />
                <Text size="2" weight="medium">
                  {facts}
                </Text>
              </Flex>
              <Text as="p" size="3" className="admin-application-pitch">
                {sheet.pitch}
              </Text>
              {sheet.styles.length > 0 && (
                <Flex gap="2" wrap="wrap" aria-label="Ses styles">
                  {sheet.styles.map((style) => (
                    <Badge key={style} variant="soft" color="gray" radius="full" size="2">
                      <BookmarkIcon /> {style}
                    </Badge>
                  ))}
                </Flex>
              )}
              {sheet.listenUrl ? (
                <Flex align="center" gap="3" wrap="wrap" className="admin-application-listen">
                  <Button asChild size="3">
                    <a href={sheet.listenUrl} target="_blank" rel="noopener noreferrer">
                      <SpeakerLoudIcon /> Écouter
                    </a>
                  </Button>
                  <Link href={sheet.listenUrl} target="_blank" rel="noopener noreferrer" size="2" color="gray" className="admin-break">
                    {sheet.listenUrl}
                  </Link>
                </Flex>
              ) : (
                <Text size="2" color="gray">
                  Pas encore de lien à écouter : c'est une idée de podcast.
                </Text>
              )}
            </Flex>
          </Section>

          <Section title="La réponse">
            {sheet.status === "accepted" && sheet.artist ? (
              <Accepted sheet={sheet} artist={sheet.artist} />
            ) : sheet.status === "declined" ? (
              <Declined sheet={sheet} onReopen={() => void run("reopen")} busy={busy === "reopen"} />
            ) : (
              <Flex direction="column" gap="3">
                {sheet.late && (
                  <Callout.Root color="red" size="1">
                    <Callout.Icon>
                      <ClockIcon />
                    </Callout.Icon>
                    <Callout.Text>La page annonce une réponse sous {sheet.replyDays} jours : celle-ci attend depuis plus longtemps.</Callout.Text>
                  </Callout.Root>
                )}
                <Text size="2" color="gray">
                  {sheet.sameName
                    ? `« Oui » reprend la fiche « ${sheet.sameName.name} », qui existe déjà, et lui donne son lien d'envoi s'il n'en a pas.`
                    : "« Oui » crée sa fiche d'invité, en brouillon, et son lien d'envoi. Le message à lui envoyer est prêt juste après."}
                </Text>
                <Flex gap="2" wrap="wrap">
                  <Button size="3" color="green" onClick={() => setAsking("accept")} disabled={busy !== null}>
                    <CheckIcon /> Oui
                  </Button>
                  <Button size="3" variant="soft" color="gray" onClick={() => setAsking("decline")} disabled={busy !== null}>
                    <Cross2Icon /> Pas cette fois
                  </Button>
                  {sheet.status === "shortlisted" ? (
                    <Button size="3" variant="ghost" color="gray" loading={busy === "reopen"} onClick={() => void run("reopen")}>
                      <ResetIcon /> Remettre à écouter
                    </Button>
                  ) : (
                    <Button size="3" variant="ghost" color="gray" loading={busy === "shortlist"} onClick={() => void run("shortlist")}>
                      <BookmarkIcon /> Mettre de côté
                    </Button>
                  )}
                </Flex>
              </Flex>
            )}
          </Section>
        </div>

        <aside className="admin-sheet-side" aria-label="Contact, note et informations">
          <SidePanel title="Contact">
            {sheet.instagram && (
              <Line icon={<InstagramLogoIcon />}>
                <Link href={`https://www.instagram.com/${sheet.instagram}/`} target="_blank" rel="noopener noreferrer">
                  @{sheet.instagram}
                </Link>
              </Line>
            )}
            {sheet.email && (
              <Line icon={<EnvelopeClosedIcon />}>
                <Link href={`mailto:${sheet.email}`} className="admin-break">
                  {sheet.email}
                </Link>
              </Line>
            )}
            {sheet.city && <Line icon={<SewingPinIcon />}>{sheet.city}</Line>}
          </SidePanel>

          <SidePanel title="Note de l'équipe">
            <TextArea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Ce qu'on en pense, à qui la faire écouter, pour quel créneau…"
              rows={4}
              aria-label="Note de l'équipe"
            />
            <Button variant="soft" size="2" disabled={note.trim() === sheet.note.trim()} loading={busy === "note"} onClick={() => void run("note")}>
              Enregistrer la note
            </Button>
          </SidePanel>

          <SidePanel title="Informations">
            <Text size="2" color="gray">
              Reçue le {sheet.receivedAt}.
              {answered && sheet.answeredAt && (
                <>
                  {" "}
                  Réponse le {sheet.answeredAt}
                  {sheet.answeredBy ? `, par ${sheet.answeredBy}` : ""}.
                </>
              )}
            </Text>
            <Button variant="ghost" color="red" size="2" onClick={() => setAsking("delete")} disabled={busy !== null} className="admin-align-start">
              <TrashIcon /> Effacer la candidature
            </Button>
          </SidePanel>
        </aside>
      </div>

      <AlertDialog.Root open={asking !== null} onOpenChange={(open) => !open && busy === null && setAsking(null)}>
        <AlertDialog.Content maxWidth="480px">
          {asking === "accept" && (
            <>
              <AlertDialog.Title>Dire oui à {sheet.name} ?</AlertDialog.Title>
              <AlertDialog.Description size="2">
                {sheet.sameName
                  ? `La fiche « ${sheet.sameName.name} » existe déjà : elle est reprise telle quelle, avec son lien d'envoi.`
                  : "Sa fiche d'invité est créée en brouillon, avec son Instagram et son activité, puis son lien d'envoi. Rien n'est publié."}
              </AlertDialog.Description>
            </>
          )}
          {asking === "decline" && (
            <>
              <AlertDialog.Title>Pas cette fois pour {sheet.name} ?</AlertDialog.Title>
              <AlertDialog.Description size="2">La réponse est notée. La candidature reste six mois, le temps de changer d'avis, puis elle est effacée.</AlertDialog.Description>
            </>
          )}
          {asking === "delete" && (
            <>
              <AlertDialog.Title>Effacer la candidature de {sheet.name} ?</AlertDialog.Title>
              <AlertDialog.Description size="2">
                Elle disparaît tout de suite, avec sa note. {sheet.artist ? "Sa fiche d'artiste et son lien d'envoi restent." : ""} C'est définitif.
              </AlertDialog.Description>
            </>
          )}
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" disabled={busy !== null}>
                Annuler
              </Button>
            </AlertDialog.Cancel>
            {asking === "accept" && (
              <Button color="green" loading={busy === "accept"} onClick={() => void run("accept")}>
                <CheckIcon /> Oui
              </Button>
            )}
            {asking === "decline" && (
              <Button color="gray" loading={busy === "decline"} onClick={() => void run("decline")}>
                <Cross2Icon /> Pas cette fois
              </Button>
            )}
            {asking === "delete" && (
              <Button color="red" loading={busy === "delete"} onClick={() => void run("delete")}>
                <TrashIcon /> Effacer
              </Button>
            )}
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  );
}

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <Flex align="center" gap="2">
      <span className="admin-line-icon" aria-hidden>
        {icon}
      </span>
      <Text size="2" className="admin-break">
        {children}
      </Text>
    </Flex>
  );
}

/** Le oui : la fiche née, son lien d'envoi, et le message à lui envoyer. */
function Accepted({ sheet, artist }: { sheet: ApplicationSheet; artist: NonNullable<ApplicationSheet["artist"]> }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(location.origin), []);
  const link = artist.link ? `${origin}${artist.link}` : "";
  return (
    <Flex direction="column" gap="4">
      <Callout.Root color="green" size="1">
        <Callout.Icon>
          <CheckIcon />
        </Callout.Icon>
        <Callout.Text>
          Acceptée{sheet.answeredAt ? ` le ${sheet.answeredAt}` : ""}
          {sheet.answeredBy ? ` par ${sheet.answeredBy}` : ""}. Sa fiche :{" "}
          <Link href={`/admin/artistes/${artist.id}`} data-astro-prefetch="false" weight="medium">
            {artist.name}
          </Link>{" "}
          <StatusBadge status={artist.status} />
        </Callout.Text>
      </Callout.Root>
      {artist.link ? (
        <Message key={link} sheet={sheet} text={messageOui(sheet.name, link)} subject="Ta candidature sur Parabole Radio : c'est oui !" />
      ) : (
        <Callout.Root color="amber" size="1">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            Sa fiche n'a plus de lien d'envoi : crée-le depuis{" "}
            <Link href={`/admin/artistes/${artist.id}`} data-astro-prefetch="false">
              sa fiche
            </Link>
            , bloc « Lien d'envoi ».
          </Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  );
}

/** Le refus : quand, par qui, quand il sera effacé, le message, et de quoi le reprendre. */
function Declined({ sheet, onReopen, busy }: { sheet: ApplicationSheet; onReopen(): void; busy: boolean }) {
  return (
    <Flex direction="column" gap="4">
      <Callout.Root color="gray" size="1">
        <Callout.Icon>
          <Cross2Icon />
        </Callout.Icon>
        <Callout.Text>
          Pas cette fois{sheet.answeredAt ? `, le ${sheet.answeredAt}` : ""}
          {sheet.answeredBy ? ` par ${sheet.answeredBy}` : ""}. {sheet.erasedAt ? `Effacée le ${sheet.erasedAt}.` : ""}
        </Callout.Text>
      </Callout.Root>
      <Message sheet={sheet} text={messageNon(sheet.name)} subject="Ta candidature sur Parabole Radio" />
      <Button variant="ghost" color="gray" loading={busy} onClick={onReopen} className="admin-align-start">
        <ResetIcon /> Remettre à écouter
      </Button>
    </Flex>
  );
}

/** Le message à envoyer, modifiable : le copier pour Insta, ou l'ouvrir dans la messagerie. */
function Message({ sheet, text, subject }: { sheet: ApplicationSheet; text: string; subject: string }) {
  const notify = useNotify();
  const [message, setMessage] = useState(text);
  useEffect(() => setMessage(text), [text]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      notify({ kind: "success", title: "Message copié", description: sheet.instagram ? "Colle-le dans ta réponse sur Insta." : "Colle-le dans ta réponse." });
    } catch {
      notify({ kind: "error", title: "Copie impossible", description: "Sélectionne le message, puis copie-le à la main." });
    }
  }

  return (
    <Flex direction="column" gap="2">
      <Text as="label" size="2" weight="medium" htmlFor="message">
        Le message à lui envoyer
      </Text>
      <TextArea id="message" value={message} onChange={(event) => setMessage(event.target.value)} rows={9} />
      <Flex gap="2" wrap="wrap">
        <Button onClick={() => void copy()}>
          <CopyIcon /> Copier le message
        </Button>
        {sheet.email && (
          <Button variant="soft" asChild>
            <a href={`mailto:${sheet.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}>
              <EnvelopeClosedIcon /> Écrire un e-mail
            </a>
          </Button>
        )}
        {sheet.instagram && (
          <Button variant="soft" asChild>
            <a href={`https://www.instagram.com/${sheet.instagram}/`} target="_blank" rel="noopener noreferrer">
              <InstagramLogoIcon /> Ouvrir son Insta
            </a>
          </Button>
        )}
      </Flex>
    </Flex>
  );
}
