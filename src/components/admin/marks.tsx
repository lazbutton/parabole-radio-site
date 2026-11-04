/**
 * Les petites marques que partagent les écrans : le statut (publié, brouillon), le type d'un show en vignette, et la
 * touche de commande du clavier (⌘ sur Mac, Ctrl ailleurs).
 */
import { LABELS } from "@parabole/cms/labels";
import { ChatBubbleIcon, DiscIcon, ListBulletIcon } from "@radix-ui/react-icons";
import { Badge } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import type { ShowType } from "@parabole/cms";

/**
 * Brouillon ou publié : une pastille, avec son point de couleur et son mot (la couleur ne dit jamais tout). `feminine` :
 * « Publiée », pour une émission.
 */
export function StatusBadge({ status, size = "1", feminine = false }: { status: "draft" | "published"; size?: "1" | "2"; feminine?: boolean }) {
  const published = status === "published";
  return (
    <Badge color={published ? "green" : "gray"} variant="soft" radius="full" size={size} className="admin-status">
      <span className="admin-status-dot" aria-hidden />
      {published ? (feminine ? "Publiée" : "Publié") : "Brouillon"}
    </Badge>
  );
}

const TYPE_ICONS = { dj_set: DiscIcon, playlist: ListBulletIcon, podcast: ChatBubbleIcon } satisfies Record<ShowType, unknown>;

/** L'icône d'un type de show : un disque pour un DJ set, une liste pour une playlist, une bulle pour un podcast. */
export function TypeIcon({ type }: { type: ShowType }) {
  const Icon = TYPE_ICONS[type];
  return <Icon aria-hidden />;
}

/** La vignette d'un show tant qu'il n'a pas de pochette affichable : son type, en couleur. */
export function TypeTile({ type, size = 36 }: { type: ShowType; size?: number }) {
  return (
    <span className="admin-type-tile" data-type={type} style={{ width: size, height: size }} title={LABELS.showType[type]}>
      <TypeIcon type={type} />
    </span>
  );
}

/** « ⌘ » sur Mac et iPad, « Ctrl » ailleurs. Le serveur ne sait pas : il écrit ⌘, le navigateur corrige. */
export function useModKey() {
  const [mod, setMod] = useState("⌘");
  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.userAgent)) setMod("Ctrl");
  }, []);
  return mod;
}
