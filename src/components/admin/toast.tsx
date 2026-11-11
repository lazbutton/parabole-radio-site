/**
 * Les notifications de l'admin (Radix Toast) : « Show enregistré », « La fiche n'est pas enregistrée »… En bas à
 * droite, quatre secondes (huit pour une erreur), fermables, glissables vers la droite ; lues par les lecteurs d'écran.
 * Elles restent affichées quand on change d'écran.
 *
 * Toast vient de radix-ui, comme le reste de Radix Themes, et non du paquet @radix-ui/react-toast : sa version à
 * part ramenait une autre copie de react-dismissable-layer, et chaque copie tient son propre compte des fenêtres
 * ouvertes. Le menu « … » et le dialogue de suppression ne se voyaient plus : en partant, le dialogue remettait
 * pointer-events: none sur la page, et plus rien ne se cliquait. Pas d'autre paquet @radix-ui/* à part.
 */
import { CheckCircledIcon, Cross2Icon, CrossCircledIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { Toast } from "radix-ui";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Flash } from "./types";

type Item = Flash & { id: number };

const NotifyContext = createContext<(flash: Flash) => void>(() => {});

/** Affiche une notification. */
export const useNotify = () => useContext(NotifyContext);

const ICONS = { success: CheckCircledIcon, error: CrossCircledIcon, info: InfoCircledIcon };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const notify = useCallback((flash: Flash) => setItems((list) => [...list.slice(-2), { ...flash, id: Date.now() + Math.random() }]), []);
  return (
    <NotifyContext.Provider value={notify}>
      <Toast.Provider swipeDirection="right" duration={flashDuration} label="Notification">
        {children}
        {items.map((item) => {
          const Icon = ICONS[item.kind];
          return (
            <Toast.Root
              key={item.id}
              className={`admin-toast admin-toast-${item.kind}`}
              duration={item.kind === "error" ? 8000 : flashDuration}
              onOpenChange={(open) => {
                if (!open) setItems((list) => list.filter((other) => other.id !== item.id));
              }}
            >
              <Icon className="admin-toast-icon" aria-hidden />
              <div className="admin-toast-text">
                <Toast.Title className="admin-toast-title">{item.title}</Toast.Title>
                {item.description && <Toast.Description className="admin-toast-description">{item.description}</Toast.Description>}
              </div>
              <Toast.Close className="admin-toast-close" aria-label="Fermer">
                <Cross2Icon />
              </Toast.Close>
            </Toast.Root>
          );
        })}
        <Toast.Viewport className="admin-toast-viewport" />
      </Toast.Provider>
    </NotifyContext.Provider>
  );
}

const flashDuration = 4000;
