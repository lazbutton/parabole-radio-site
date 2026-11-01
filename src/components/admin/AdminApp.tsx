/**
 * L'application d'admin (cms/README.md, section 9) : une seule application React pour tous les écrans de travail.
 * Le serveur rend le premier écran (src/layouts/Admin.astro) ; ensuite on passe d'un écran à l'autre sans recharger la
 * page (router.tsx), et les fiches s'enregistrent sans recharger non plus. La connexion reste une page à part.
 */
import { AlertDialog, Button, Flex, Theme } from "@radix-ui/themes";
import { useState } from "react";
import { AdminShell } from "./AdminShell";
import { ArtistEditor } from "./ArtistEditor";
import { ArtistsList } from "./ArtistsList";
import { Dashboard } from "./Dashboard";
import { PasswordScreen } from "./PasswordScreen";
import { RouterProvider, useRouter } from "./router";
import { ShowEditor } from "./ShowEditor";
import { ShowsList } from "./ShowsList";
import { ToastProvider } from "./toast";
import type { AppProps, Viewer } from "./types";

type Leaving = { proceed(): void; save?(): Promise<boolean> };

export default function AdminApp({ viewer, href, screen }: AppProps) {
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  return (
    <Theme accentColor="indigo" grayColor="slate" radius="medium" scaling="100%" panelBackground="solid" className="admin-theme">
      <ToastProvider>
        <RouterProvider href={href} screen={screen} onBlocked={(proceed, save) => setLeaving({ proceed, save })}>
          <AdminShell viewer={viewer}>
            <CurrentScreen viewer={viewer} />
          </AdminShell>
          <LeaveDialog leaving={leaving} onClose={() => setLeaving(null)} />
        </RouterProvider>
      </ToastProvider>
    </Theme>
  );
}

/** L'écran que montre le routeur. Une fiche repart de zéro à chaque visite (key) ; une liste garde sa recherche. */
function CurrentScreen({ viewer }: { viewer: Viewer }) {
  const { screen, visit } = useRouter();
  switch (screen.name) {
    case "dashboard":
      return <Dashboard viewer={viewer} {...screen.data} />;
    case "shows":
      return <ShowsList {...screen.data} />;
    case "show":
      return <ShowEditor key={visit} {...screen.data} />;
    case "artists":
      return <ArtistsList {...screen.data} />;
    case "artist":
      return <ArtistEditor key={visit} {...screen.data} />;
    case "password":
      return <PasswordScreen key={visit} {...screen.data} />;
  }
}

/** Quitter une fiche modifiée : rester, partir sans enregistrer, ou enregistrer puis partir. */
function LeaveDialog({ leaving, onClose }: { leaving: Leaving | null; onClose(): void }) {
  const [saving, setSaving] = useState(false);
  const leave = (target: Leaving) => {
    onClose();
    target.proceed();
  };
  const saveThenLeave = async (target: Leaving, save: () => Promise<boolean>) => {
    setSaving(true);
    const saved = await save();
    setSaving(false);
    // Refusé (un champ à corriger) : on reste sur la fiche, l'erreur y est affichée.
    if (saved) leave(target);
    else onClose();
  };
  return (
    <AlertDialog.Root
      open={leaving !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <AlertDialog.Content maxWidth="480px">
        <AlertDialog.Title>Enregistrer avant de quitter ?</AlertDialog.Title>
        <AlertDialog.Description size="2">Cette fiche a des modifications qui ne sont pas encore enregistrées.</AlertDialog.Description>
        <Flex gap="3" mt="5" justify="end" direction={{ initial: "column-reverse", sm: "row" }}>
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" disabled={saving}>
              Annuler
            </Button>
          </AlertDialog.Cancel>
          <Button variant="soft" color="red" disabled={saving} onClick={() => leaving && leave(leaving)}>
            Quitter sans enregistrer
          </Button>
          {leaving?.save && (
            <Button loading={saving} onClick={() => void saveThenLeave(leaving, leaving.save!)}>
              Enregistrer et quitter
            </Button>
          )}
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
