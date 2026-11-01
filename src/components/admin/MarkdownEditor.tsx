/**
 * Un texte long (la description d'un show, la bio d'un artiste) dans un petit éditeur visuel, Tiptap : gras,
 * italique, liens, listes et citation, rien de plus — c'est ce que le site sait afficher. Le texte s'enregistre
 * toujours en Markdown (@tiptap/markdown) : la base, la recherche et le site (src/lib/markdown.ts, sans HTML brut)
 * n'y voient pas de différence, et ce qui a été écrit avant se rouvre tel quel. Les raccourcis habituels marchent :
 * ⌘B, ⌘I, ⌘Z ; « - » ou « 1. » en début de ligne ouvre une liste, « > » une citation, Maj+Entrée va à la ligne.
 *
 * L'éditeur ne s'ouvre que dans le navigateur (immediatelyRender: false) : le serveur rend le cadre vide. La barre
 * d'outils suit le motif « toolbar » d'ARIA (radix-ui) : les flèches passent d'un bouton à l'autre.
 */
import { FontBoldIcon, FontItalicIcon, Link2Icon, ListBulletIcon, QuoteIcon } from "@radix-ui/react-icons";
import { Button, Flex, IconButton, Kbd, Popover, Text, TextField, Tooltip } from "@radix-ui/themes";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Toolbar } from "radix-ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useModKey } from "./marks";

type Props = { id: string; label: string; value: string; onChange(value: string): void; error?: string; placeholder?: string };

/** Deux textes qui ne diffèrent que par les blancs du début et de la fin : le serveur les retire. */
const same = (a: string, b: string) => a.trim() === b.trim();

export function MarkdownEditor({ id, label, value, onChange, error, placeholder = "" }: Props) {
  const changed = useRef(onChange);
  changed.current = onChange;
  /** Le dernier texte connu de l'éditeur : ce qu'il a envoyé à la fiche, ou ce qu'elle lui a donné. */
  const known = useRef(value);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // Ce que le site n'affiche pas, ou qui n'a pas sa place dans une description : pas de titres, de code, de
        // souligné (le Markdown n'en a pas), de barré ni de filet.
        heading: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null } },
      }),
      Placeholder.configure({ placeholder }),
      // Un simple retour à la ligne en est un, comme sur le site (breaks: true).
      Markdown.configure({ markedOptions: { breaks: true, gfm: true } }),
    ],
    content: value,
    contentType: "markdown",
    editorProps: { attributes: { id, class: "admin-rich-content", role: "textbox", "aria-multiline": "true", "aria-label": label } },
    onUpdate: ({ editor }) => {
      const markdown = editor.getMarkdown().trim();
      known.current = markdown;
      changed.current(markdown);
    },
  });

  // La fiche change le texte d'elle-même (rechargée, remise au propre par le serveur) : l'éditeur suit, sans renvoyer.
  useEffect(() => {
    if (!editor || same(value, known.current)) return;
    known.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  // Le champ fautif se signale aussi aux lecteurs d'écran.
  useEffect(() => {
    if (!editor) return;
    editor.setOptions({ editorProps: { attributes: { id, class: "admin-rich-content", role: "textbox", "aria-multiline": "true", "aria-label": label, ...(error ? { "aria-invalid": "true" } : {}) } } });
  }, [editor, error, id, label]);

  return (
    <div>
      <div className="admin-rich" data-invalid={error ? true : undefined}>
        <Tools editor={editor} label={label} />
        <EditorContent editor={editor} className="admin-rich-body" />
      </div>
      {error && (
        <Text as="p" size="1" color="red" mt="1" role="alert">
          {error}
        </Text>
      )}
    </div>
  );
}

const NOTHING = { bold: false, italic: false, link: false, bulletList: false, orderedList: false, blockquote: false };

/** La barre d'outils : ce qui est actif dans la sélection s'allume. */
function Tools({ editor, label }: { editor: Editor | null; label: string }) {
  const mod = useModKey();
  const active =
    useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      link: current?.isActive("link") ?? false,
      bulletList: current?.isActive("bulletList") ?? false,
      orderedList: current?.isActive("orderedList") ?? false,
      blockquote: current?.isActive("blockquote") ?? false,
    }),
  }) ?? NOTHING;
  const run = (command: (editor: Editor) => void) => () => editor && command(editor);
  return (
    <Toolbar.Root className="admin-rich-bar" aria-label={`Mise en forme : ${label}`}>
      <Tool label="Gras" shortcut={`${mod} B`} on={active.bold} disabled={!editor} onClick={run((e) => e.chain().focus().toggleBold().run())}>
        <FontBoldIcon />
      </Tool>
      <Tool label="Italique" shortcut={`${mod} I`} on={active.italic} disabled={!editor} onClick={run((e) => e.chain().focus().toggleItalic().run())}>
        <FontItalicIcon />
      </Tool>
      <LinkTool editor={editor} on={active.link} />
      <Toolbar.Separator className="admin-rich-sep" />
      <Tool label="Liste à puces" on={active.bulletList} disabled={!editor} onClick={run((e) => e.chain().focus().toggleBulletList().run())}>
        <ListBulletIcon />
      </Tool>
      <Tool label="Liste numérotée" on={active.orderedList} disabled={!editor} onClick={run((e) => e.chain().focus().toggleOrderedList().run())}>
        <span className="admin-rich-glyph">1.</span>
      </Tool>
      <Tool label="Citation" on={active.blockquote} disabled={!editor} onClick={run((e) => e.chain().focus().toggleBlockquote().run())}>
        <QuoteIcon />
      </Tool>
    </Toolbar.Root>
  );
}

/** Un bouton de la barre, avec son infobulle ; allumé quand la sélection a déjà cette mise en forme. */
function Tool({ label, shortcut, on, disabled, onClick, children }: { label: string; shortcut?: string; on: boolean; disabled: boolean; onClick(): void; children: ReactNode }) {
  return (
    <Tooltip content={shortcut ? <>{label} <Kbd size="1">{shortcut}</Kbd></> : label}>
      <Toolbar.Button asChild>
        <IconButton type="button" size="1" variant={on ? "soft" : "ghost"} color={on ? undefined : "gray"} aria-label={label} aria-pressed={on} disabled={disabled} onClick={onClick}>
          {children}
        </IconButton>
      </Toolbar.Button>
    </Tooltip>
  );
}

/**
 * Le lien : sur la sélection (ou le lien sous le curseur), ou un lien nouveau tapé à l'endroit du curseur. Une adresse
 * sans « https:// » le reçoit ; vide, le lien est retiré. Tiptap refuse les adresses dangereuses (javascript:…).
 */
function LinkTool({ editor, on }: { editor: Editor | null; on: boolean }) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState("");

  function apply() {
    if (!editor) return;
    const typed = href.trim();
    if (!typed) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else {
      const url = /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`;
      if (editor.state.selection.empty && !editor.isActive("link")) editor.chain().focus().insertContent({ type: "text", text: typed, marks: [{ type: "link", attrs: { href: url } }] }).run();
      else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    setOpen(false);
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setHref(editor?.getAttributes("link").href ?? "");
        setOpen(next);
      }}
    >
      <Tooltip content="Lien">
        <Popover.Trigger>
          <Toolbar.Button asChild>
            <IconButton type="button" size="1" variant={on ? "soft" : "ghost"} color={on ? undefined : "gray"} aria-label="Lien" aria-pressed={on} disabled={!editor}>
              <Link2Icon />
            </IconButton>
          </Toolbar.Button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Content size="1" width="340px" maxWidth="calc(100vw - 32px)" align="start">
        <Flex direction="column" gap="2">
          <Text as="label" size="2" weight="medium" htmlFor="admin-rich-link">
            Adresse du lien
          </Text>
          <TextField.Root
            id="admin-rich-link"
            value={href}
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              // Entrée pose le lien, sans envoyer la fiche.
              if (event.key !== "Enter") return;
              event.preventDefault();
              apply();
            }}
            placeholder="https://…"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            autoFocus
          />
          <Flex gap="2" justify="end">
            {on && (
              <Button
                type="button"
                size="1"
                variant="ghost"
                color="red"
                onClick={() => {
                  editor?.chain().focus().extendMarkRange("link").unsetLink().run();
                  setOpen(false);
                }}
              >
                Retirer le lien
              </Button>
            )}
            <Button type="button" size="1" onClick={apply}>
              {on ? "Modifier" : "Ajouter"}
            </Button>
          </Flex>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}
