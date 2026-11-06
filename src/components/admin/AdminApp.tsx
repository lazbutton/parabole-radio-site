/**
 * L'application d'admin (cms/README.md, section 9) : une seule application React pour tous les écrans de travail.
 * Le serveur rend le premier écran (src/layouts/Admin.astro) ; ensuite on passe d'un écran à l'autre sans recharger la
 * page (router.tsx), et les fiches s'enregistrent sans recharger non plus. La connexion reste une page à part.
 */
import { AlertDialog, Button, Flex, Theme } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { ApplicationScreen } from "./ApplicationScreen";
import { ApplicationsList } from "./ApplicationsList";
import { AboutScreen } from "./AboutScreen";
import { AdminShell } from "./AdminShell";
import { AntenneScreen } from "./AntenneScreen";
import { AppearanceProvider } from "./appearance";
import { ArtistEditor } from "./ArtistEditor";
import { ArtistsList } from "./ArtistsList";
import { ClipsScreen } from "./ClipsScreen";
import { CommandProvider } from "./CommandPalette";
import { Dashboard } from "./Dashboard";
import { EventEditor } from "./EventEditor";
import { EventsList } from "./EventsList";
import { PasswordScreen } from "./PasswordScreen";
import { RouterProvider, useRouter } from "./router";
import { ShowEditor } from "./ShowEditor";
import { ShowsList } from "./ShowsList";
import { TagsScreen } from "./TagsScreen";
import { preloadTextEditor } from "./TextEditor";
import { ToastProvider } from "./toast";
import type { AppProps, Viewer } from "./types";

type Leaving = { proceed(): void; save?(): Promise<boolean> };

export default function AdminApp({ viewer, href, screen }: AppProps) {
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  // L'éditeur de texte des fiches se charge au premier temps mort, pour être prêt à l'ouverture d'une fiche.
  useEffect(() => {
    if ("requestIdleCallback" in window) requestIdleCallback(preloadTextEditor, { timeout: 4000 });
    else setTimeout(preloadTextEditor, 1500);
  }, []);
  // L'apparence suit la classe `dark` de la page (appearance.tsx) : « inherit ».
  return (
    <Theme appearance="inherit" accentColor="indigo" grayColor="slate" radius="medium" scaling="100%" panelBackground="solid" className="admin-theme">
      <AppearanceProvider>
        <ToastProvider>
          <RouterProvider href={href} screen={screen} onBlocked={(proceed, save) => setLeaving({ proceed, save })}>
            <CommandProvider>
              <AdminShell viewer={viewer}>
                <CurrentScreen viewer={viewer} />
              </AdminShell>
            </CommandProvider>
            <LeaveDialog leaving={leaving} onClose={() => setLeaving(null)} />
          </RouterProvider>
        </ToastProvider>
      </AppearanceProvider>
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
    case "events":
      return <EventsList {...screen.data} />;
    case "event":
      return <EventEditor key={visit} {...screen.data} />;
    case "password":
      return <PasswordScreen key={visit} viewer={viewer} {...screen.data} />;
    case "clips":
      return <ClipsScreen {...screen.data} />;
    case "antenne":
      return <AntenneScreen {...screen.data} />;
    case "tags":
      return <TagsScreen {...screen.data} />;
    case "about":
      return <AboutScreen key={visit} {...screen.data} />;
    case "applications":
      return <ApplicationsList {...screen.data} />;
    case "application":
      return <ApplicationScreen key={visit} {...screen.data} />;
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
              Rester sur la fiche
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
