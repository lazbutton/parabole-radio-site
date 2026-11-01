/**
 * Changer son mot de passe : l'actuel, puis le nouveau deux fois. Le serveur vérifie l'actuel avant de changer quoi
 * que ce soit (src/pages/admin/mot-de-passe.astro). Une fois changé, le formulaire laisse place à la confirmation :
 * les gestionnaires de mots de passe y voient un envoi réussi et proposent d'enregistrer le nouveau.
 */
import { CheckCircledIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Avatar, Box, Button, Callout, Card, Flex, Text, TextField } from "@radix-ui/themes";
import { useState, type SubmitEvent } from "react";
import { PageHeader } from "./AdminShell";
import { Field, postForm } from "./sheet";
import { initial } from "./text";
import { useNotify } from "./toast";
import type { PasswordData, Viewer } from "./types";

type Errors = Record<string, string>;

export function PasswordScreen({ email, viewer }: PasswordData & { viewer: Viewer }) {
  const notify = useNotify();
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSending(true);
    const result = await postForm<{ ok: true } | { ok: false; errors: Errors }>("/admin/mot-de-passe", new FormData(form));
    setSending(false);
    if (result.ok) {
      setErrors({});
      setDone(true);
      notify({ kind: "success", title: "Mot de passe changé" });
      return;
    }
    setErrors(result.errors);
    const first = ["current", "next", "again"].find((name) => result.errors[name]);
    if (first) form.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
  }

  return (
    <div className="admin-page">
      <PageHeader title="Mot de passe" description="Pour te connecter à l'admin, sur cet appareil comme sur les autres." />
      <Box maxWidth="520px">
        <Flex align="center" gap="3" mb="4" className="admin-who">
          <Avatar size="3" radius="full" fallback={initial(viewer.name)} variant="solid" />
          <Flex direction="column" minWidth="0">
            <Text size="2" weight="medium">
              {viewer.name}
            </Text>
            <Text size="2" color="gray" className="admin-break">
              {email} · {viewer.role === "admin" ? "admin" : "éditeur"}
            </Text>
          </Flex>
        </Flex>
        {done ? (
          <Callout.Root color="green">
            <Callout.Icon>
              <CheckCircledIcon />
            </Callout.Icon>
            <Flex direction="column" gap="3" align="start">
              <Callout.Text>Mot de passe changé. Il servira à ta prochaine connexion.</Callout.Text>
              <Button asChild variant="soft" color="green">
                <a href="/admin" data-astro-prefetch="false">
                  Retour à l'accueil
                </a>
              </Button>
            </Flex>
          </Callout.Root>
        ) : (
          <>
            {errors.form && (
              <Callout.Root color="red" mb="4">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>{errors.form}</Callout.Text>
              </Callout.Root>
            )}
            <Card size="3" className="admin-panel">
              <form method="post" noValidate onSubmit={(event) => void submit(event)}>
                <input type="text" name="username" value={email} autoComplete="username" readOnly hidden />
                <Flex direction="column" gap="4">
                  <Field label="Mot de passe actuel" htmlFor="current" error={errors.current}>
                    <TextField.Root size="3" id="current" name="current" type="password" autoComplete="current-password" color={errors.current ? "red" : undefined} />
                  </Field>
                  <Field label="Nouveau mot de passe" htmlFor="next" hint="12 caractères au moins. Une phrase de quelques mots fait un bon mot de passe." error={errors.next}>
                    <TextField.Root size="3" id="next" name="next" type="password" autoComplete="new-password" minLength={12} color={errors.next ? "red" : undefined} />
                  </Field>
                  <Field label="Encore une fois" htmlFor="again" error={errors.again}>
                    <TextField.Root size="3" id="again" name="again" type="password" autoComplete="new-password" color={errors.again ? "red" : undefined} />
                  </Field>
                  <Flex justify="end">
                    <Button type="submit" size="3" loading={sending}>
                      Changer le mot de passe
                    </Button>
                  </Flex>
                </Flex>
              </form>
            </Card>
          </>
        )}
      </Box>
    </div>
  );
}
