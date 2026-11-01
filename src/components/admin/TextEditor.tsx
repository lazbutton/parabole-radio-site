/**
 * Le petit éditeur de texte (MarkdownEditor.tsx, Tiptap) pèse à lui seul autant que le reste de l'admin : il se charge
 * à part, pour que l'accueil et les listes s'ouvrent vite. L'application le demande au premier temps mort
 * (preloadTextEditor) : quand on ouvre une fiche, il est déjà là. Sinon, un cadre vide de la même taille l'attend.
 */
import { lazy, Suspense, type ComponentProps } from "react";

const load = () => import("./MarkdownEditor");
const MarkdownEditor = lazy(() => load().then((module) => ({ default: module.MarkdownEditor })));

/** Charge l'éditeur d'avance, sans l'afficher. */
export const preloadTextEditor = () => void load();

export function TextEditor(props: ComponentProps<typeof MarkdownEditor>) {
  return (
    <Suspense
      fallback={
        <div className="admin-rich" aria-busy="true">
          <div className="admin-rich-bar admin-rich-bar-waiting" />
          <div className="admin-rich-content" />
        </div>
      }
    >
      <MarkdownEditor {...props} />
    </Suspense>
  );
}
