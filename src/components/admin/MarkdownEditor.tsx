/**
 * Un texte long en Markdown (description, bio) : « Écrire » ou « Aperçu » (Radix Tabs). L'aperçu est rendu par le
 * serveur comme il le sera sur le site, sans HTML brut (/admin/apercu, src/lib/markdown.ts).
 */
import { Box, Flex, Spinner, Tabs, Text, TextArea } from "@radix-ui/themes";
import { useState } from "react";

export function MarkdownEditor({ label, value, onChange, error, rows = 8 }: { label: string; value: string; onChange(value: string): void; error?: string; rows?: number }) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function preview() {
    setLoading(true);
    try {
      const response = await fetch("/admin/apercu", { method: "POST", body: new URLSearchParams({ texte: value }) });
      setHtml(response.ok && (response.headers.get("content-type") ?? "").includes("text/html") ? await response.text() : null);
    } catch {
      setHtml(null);
    }
    setLoading(false);
  }

  return (
    <Tabs.Root defaultValue="ecrire" onValueChange={(tab) => tab === "apercu" && void preview()}>
      <Flex justify="between" align="end" gap="3">
        <Text as="div" size="2" weight="medium">
          {label}{" "}
          <Text size="1" color="gray" weight="regular">
            facultatif
          </Text>
        </Text>
        <Tabs.List size="1">
          <Tabs.Trigger value="ecrire">Écrire</Tabs.Trigger>
          <Tabs.Trigger value="apercu">Aperçu</Tabs.Trigger>
        </Tabs.List>
      </Flex>
      <Box pt="2">
        <Tabs.Content value="ecrire">
          <TextArea value={value} onChange={(event) => onChange(event.target.value)} rows={rows} aria-label={label} color={error ? "red" : undefined} resize="vertical" />
          <Text as="p" size="1" color="gray" mt="1">
            Markdown : **gras**, *italique*, [lien](https://…), une ligne vide entre deux paragraphes.
          </Text>
        </Tabs.Content>
        <Tabs.Content value="apercu">
          <Box className="admin-markdown" p="3">
            {loading ? (
              <Spinner />
            ) : html === null ? (
              <Text size="2" color="red">
                Aperçu indisponible : ta session a peut-être expiré.
              </Text>
            ) : html.trim() ? (
              <div dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <Text size="2" color="gray">
                Rien à afficher.
              </Text>
            )}
          </Box>
        </Tabs.Content>
      </Box>
      {error && (
        <Text as="p" size="1" color="red" mt="1">
          {error}
        </Text>
      )}
    </Tabs.Root>
  );
}
