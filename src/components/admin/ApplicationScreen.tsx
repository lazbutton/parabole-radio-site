/**
 * Une candidature (cms/README.md, 9.17) : à gauche, l'émission proposée (sa description, ses styles), son son (le MP3 à
 * écouter ou à télécharger, ou le lien d'une playlist ; sa tracklist, morceau par morceau), l'artiste (sa photo, sa
 * bio), son mot pour l'équipe, et la réponse ; à droite, le contact et ses liens, la note de l'équipe et les
 * informations. La réponse se donne en un clic, confirmé :
 *   - « Valider » crée l'émission en brouillon, avec son son, ses styles et sa tracklist, et la fiche d'invité de
 *     l'artiste, en brouillon aussi (ou reprend la fiche qui porte déjà ce nom, sans rien écraser) ; l'écran prépare
 *     ensuite le message à envoyer, modifiable : le copier pour Insta, ou l'ouvrir dans la messagerie. La candidature
 *     est effacée six mois après (l'émission et la fiche restent) ;
 *   - « Pas cette fois » l'efface tout de suite, avec son son et sa photo : depuis le 11 nov. 2026, on ne répond
 *     qu'aux émissions retenues (la page le dit), il n'y a donc pas de message à envoyer.
 * « Mettre de côté » range une candidature à réécouter. Une candidature validée peut s'effacer avant ses six mois.
 */
import { LABELS } from "@parabole/cms/labels";
import {
  ArrowLeftIcon,
  BookmarkIcon,
  CheckIcon,
  CopyIcon,
  Cross2Icon,
  DownloadIcon,
  EnvelopeClosedIcon,
  ExclamationTriangleIcon,
  InstagramLogoIcon,
  Link2Icon,
  ResetIcon,
  SewingPinIcon,
  SpeakerLoudIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import { AlertDialog, Badge, Blockquote, Button, Callout, Flex, Link, Text, TextArea } from "@radix-ui/themes";
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

/** Le message de la validation : son émission passera à l'antenne. */
export function messageValidee(name: string, title: string) {
  return [
    `Salut ${name} !`,
    `Merci pour « ${title} » : on a adoré, et ton émission va passer sur Parabole Radio.`,
    "On te dit vite quand elle passe à l'antenne. D'ici là, ta page d'artiste et celle de ton émission se préparent sur le site.",
    `À très vite,\n${SIGNATURE}`,
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
  /** De quoi valider : son MP3, ou le lien de sa playlist (une candidature d'avant le son n'a ni l'un ni l'autre). */
  const listenable = Boolean(sheet.sound || sheet.listenUrl);

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
    if (intent === "delete" || intent === "decline") {
      forgetRecent(url);
      router.navigate(result.redirect ?? "/admin/candidatures");
      return;
    }
    setSheet(result.sheet);
    setNote(result.sheet.note);
  }

  const facts = [LABELS.showType[sheet.type], sheet.regular === true ? "régulièrement" : sheet.regular === false ? "une fois" : null].filter(Boolean).join(" · ");

  return (
    <div className="admin-page">
      <PageHeader
        title={sheet.title}
        description={
          <Flex as="span" align="center" gap="2" wrap="wrap">
            <Badge color={status.color} variant="soft" radius="full">
              {status.label}
            </Badge>
            <span>
              Par {sheet.name}, reçue {sheet.received}
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
          <Section title="L'émission">
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
            </Flex>
          </Section>

          <Section title="Le son">
            <Flex direction="column" gap="4">
              <Sound sheet={sheet} />
              {sheet.tracklist.length > 0 ? (
                <Flex direction="column" gap="2">
                  <Text size="2" weight="medium">
                    Sa tracklist · {sheet.tracklist.length} morceau{sheet.tracklist.length > 1 ? "x" : ""}
                  </Text>
                  <div className="admin-application-tracklist">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">N°</th>
                          <th scope="col">Artiste</th>
                          <th scope="col">Titre</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sheet.tracklist.map((morceau, rang) => (
                          <tr key={rang}>
                            <td>{rang + 1}</td>
                            <td>{morceau.artiste || "?"}</td>
                            <td>{morceau.titre || "?"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Flex>
              ) : (
                sheet.type === "podcast" && (
                  <Text size="2" color="gray">
                    Pas de tracklist (facultative pour un podcast).
                  </Text>
                )
              )}
            </Flex>
          </Section>

          <Section title="L'artiste">
            <Flex direction="column" gap="3">
              <Flex align="center" gap="3">
                {sheet.photo ? (
                  <img src={sheet.photo.thumb} alt={sheet.photo.alt} width={96} height={96} className="admin-application-photo" />
                ) : (
                  <span className="admin-application-photo admin-application-photo-vide">Sans photo</span>
                )}
                <Flex direction="column" gap="1" minWidth="0">
                  <Text size="4" weight="bold" className="admin-break">
                    {sheet.name}
                  </Text>
                  {sheet.city && (
                    <Text size="2" color="gray">
                      {sheet.city}
                    </Text>
                  )}
                </Flex>
              </Flex>
              {sheet.bio ? (
                <Text as="p" size="2" className="admin-application-pitch">
                  {sheet.bio}
                </Text>
              ) : (
                <Text size="2" color="gray">
                  Pas de bio.
                </Text>
              )}
              {sheet.sameName && !sheet.artist && (
                <Text size="2" color="gray">
                  Une fiche porte déjà ce nom :{" "}
                  <Link href={`/admin/artistes/${sheet.sameName.id}`} data-astro-prefetch="false">
                    {sheet.sameName.name}
                  </Link>
                  . La validation la reprend sans rien écraser : seules une bio et une photo manquantes sont complétées.
                </Text>
              )}
            </Flex>
          </Section>

          {sheet.message && (
            <Section title="Son mot pour l'équipe">
              <Blockquote size="2" className="admin-application-pitch">
                {sheet.message}
              </Blockquote>
            </Section>
          )}

          <Section title="La réponse">
            {sheet.status === "accepted" && sheet.show && sheet.artist ? (
              <Validated sheet={sheet} show={sheet.show} artist={sheet.artist} />
            ) : sheet.status === "declined" ? (
              <Declined sheet={sheet} />
            ) : (
              <Flex direction="column" gap="3">
                {listenable ? (
                  <Text size="2" color="gray">
                    « Valider » crée l'émission « {sheet.title} » en brouillon, avec {sheet.sound ? "ce son" : "ce lien"}, ses styles et sa tracklist,{" "}
                    {sheet.sameName ? `et reprend la fiche « ${sheet.sameName.name} », qui existe déjà.` : `et la fiche d'invité de ${sheet.name}, en brouillon aussi.`} Le message à
                    lui envoyer est prêt juste après. « Pas cette fois » efface la candidature : on ne répond qu'aux émissions retenues.
                  </Text>
                ) : (
                  <Callout.Root color="amber" size="1">
                    <Callout.Icon>
                      <ExclamationTriangleIcon />
                    </Callout.Icon>
                    <Callout.Text>Ni son ni lien de playlist : il n'y a rien à valider. Pour l'entendre, demande-lui de candidater de nouveau.</Callout.Text>
                  </Callout.Root>
                )}
                <Flex gap="2" wrap="wrap">
                  <Button size="3" color="green" onClick={() => setAsking("accept")} disabled={busy !== null || !listenable}>
                    <CheckIcon /> Valider
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
            {sheet.profile && (
              <Line icon={<Link2Icon />}>
                <Link href={sheet.profile.url} target="_blank" rel="noopener noreferrer" className="admin-break" title={sheet.profile.url}>
                  {sheet.profile.label}
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
            {sheet.status === "accepted" && sheet.erasedAt && (
              <Text size="2" color="gray">
                Elle sera effacée le {sheet.erasedAt} ; l'émission et la fiche restent.
              </Text>
            )}
            {answered && (
              <Button variant="ghost" color="red" size="2" onClick={() => setAsking("delete")} disabled={busy !== null} className="admin-align-start">
                <TrashIcon /> Effacer la candidature
              </Button>
            )}
          </SidePanel>
        </aside>
      </div>

      <AlertDialog.Root open={asking !== null} onOpenChange={(open) => !open && busy === null && setAsking(null)}>
        <AlertDialog.Content maxWidth="500px">
          {asking === "accept" && (
            <>
              <AlertDialog.Title>Valider « {sheet.title} » ?</AlertDialog.Title>
              <AlertDialog.Description size="2">
                L'émission est créée en brouillon, sans date, avec {sheet.sound ? "son son" : "son lien"}, ses styles et sa tracklist.{" "}
                {sheet.sameName
                  ? `La fiche « ${sheet.sameName.name} », qui existe déjà, est reprise sans rien écraser.`
                  : `La fiche d'invité de ${sheet.name} est créée en brouillon, avec sa bio, sa photo et son Instagram.`}{" "}
                Rien n'est publié.
              </AlertDialog.Description>
            </>
          )}
          {asking === "decline" && (
            <>
              <AlertDialog.Title>Pas cette fois pour {sheet.name} ?</AlertDialog.Title>
              <AlertDialog.Description size="2">
                La candidature est effacée tout de suite, avec son son et sa photo : on ne pourra plus l'écouter. Pas de message à lui envoyer : la page dit qu'on ne répond
                qu'aux émissions sélectionnées.
              </AlertDialog.Description>
            </>
          )}
          {asking === "delete" && (
            <>
              <AlertDialog.Title>Effacer la candidature de {sheet.name} ?</AlertDialog.Title>
              <AlertDialog.Description size="2">
                {sheet.status === "accepted"
                  ? "Elle disparaît tout de suite, avec sa note. L'émission et la fiche nées de sa validation restent, avec le son."
                  : "Elle disparaît tout de suite, avec son son, sa photo et sa note."}{" "}
                C'est définitif.
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
                <CheckIcon /> Valider
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

/** Le son : le MP3 à écouter ici (le lecteur ne charge rien avant le clic) ou à télécharger, ou le lien d'une playlist. */
function Sound({ sheet }: { sheet: ApplicationSheet }) {
  if (sheet.sound) {
    const listen = `/admin/api/son/${sheet.sound.id}`;
    return (
      <Flex direction="column" gap="2" className="admin-application-listen">
        <Flex justify="between" align="baseline" gap="3">
          <Text size="2" weight="medium" className="admin-break">
            {sheet.sound.fileName}
          </Text>
          {sheet.sound.size && (
            <Text size="1" color="gray" className="admin-nowrap">
              {sheet.sound.size}
            </Text>
          )}
        </Flex>
        <audio controls preload="none" src={listen} className="admin-audio">
          <a href={`${listen}?telecharger`} download>
            Télécharger le son
          </a>
        </audio>
        <Button variant="soft" size="2" asChild className="admin-align-start">
          <a href={`${listen}?telecharger`} download>
            <DownloadIcon /> Télécharger le MP3
          </a>
        </Button>
      </Flex>
    );
  }
  if (sheet.listenUrl)
    return (
      <Flex align="center" gap="3" wrap="wrap" className="admin-application-listen">
        <Button asChild size="3">
          <a href={sheet.listenUrl} target="_blank" rel="noopener noreferrer">
            <SpeakerLoudIcon /> Écouter la playlist
          </a>
        </Button>
        <Link href={sheet.listenUrl} target="_blank" rel="noopener noreferrer" size="2" color="gray" className="admin-break">
          {sheet.listenUrl}
        </Link>
      </Flex>
    );
  return (
    <Text size="2" color="gray">
      {sheet.status === "declined" ? "Son son a été effacé avec le refus." : "Pas de son."}
    </Text>
  );
}

/** La validation : l'émission et la fiche nées, et le message à lui envoyer. */
function Validated({ sheet, show, artist }: { sheet: ApplicationSheet; show: NonNullable<ApplicationSheet["show"]>; artist: NonNullable<ApplicationSheet["artist"]> }) {
  return (
    <Flex direction="column" gap="4">
      <Callout.Root color="green" size="1">
        <Callout.Icon>
          <CheckIcon />
        </Callout.Icon>
        <Callout.Text>
          Validée{sheet.answeredAt ? ` le ${sheet.answeredAt}` : ""}
          {sheet.answeredBy ? ` par ${sheet.answeredBy}` : ""}. L'émission :{" "}
          <Link href={`/admin/shows/${show.id}`} data-astro-prefetch="false" weight="medium">
            {show.title}
          </Link>{" "}
          <StatusBadge status={show.status} /> ; sa fiche :{" "}
          <Link href={`/admin/artistes/${artist.id}`} data-astro-prefetch="false" weight="medium">
            {artist.name}
          </Link>{" "}
          <StatusBadge status={artist.status} />. Elle attend son créneau : donne-lui une date depuis sa fiche.
        </Callout.Text>
      </Callout.Root>
      <Message sheet={sheet} text={messageValidee(sheet.name, sheet.title)} subject="Ton émission sur Parabole Radio : c'est validé !" />
    </Flex>
  );
}

/** Un refus d'avant le 11 nov. 2026, quand on gardait les refus six mois : la tâche de nuit l'efface. */
function Declined({ sheet }: { sheet: ApplicationSheet }) {
  return (
    <Callout.Root color="gray" size="1">
      <Callout.Icon>
        <Cross2Icon />
      </Callout.Icon>
      <Callout.Text>
        Pas cette fois{sheet.answeredAt ? `, le ${sheet.answeredAt}` : ""}
        {sheet.answeredBy ? ` par ${sheet.answeredBy}` : ""}. Elle sera effacée cette nuit.
      </Callout.Text>
    </Callout.Root>
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
      <TextArea id="message" value={message} onChange={(event) => setMessage(event.target.value)} rows={8} />
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
