/**
 * Changer son mot de passe : l'actuel, puis le nouveau deux fois. Le serveur vérifie l'actuel avant de changer quoi
 * que ce soit (src/pages/admin/mot-de-passe.astro). Une fois changé, le formulaire laisse place à la confirmation :
 * les gestionnaires de mots de passe y voient un envoi réussi et proposent d'enregistrer le nouveau.
 */
import { CheckCircledIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Box, Button, Callout, Card, Flex, TextField } from "@radix-ui/themes";
import { useState, type SubmitEvent } from "react";
import { PageHeader } from "./AdminShell";
import { Field, postForm } from "./sheet";
import { useNotify } from "./toast";
import type { PasswordData } from "./types";

type Errors = Record<string, string>;

export function PasswordScreen({ email }: PasswordData) {
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
    <>
      <PageHeader title="Mot de passe" description={email} />
      <Box maxWidth="520px">
        {done ? (
          <Callout.Root color="green">
            <Callout.Icon>
              <CheckCircledIcon />
            </Callout.Icon>
            <Flex direction="column" gap="3" align="start">
              <Callout.Text>Mot de passe changé. Il servira à ta prochaine connexion.</Callout.Text>
              <Button asChild variant="soft" color="green">
                <a href="/admin" data-astro-prefetch="false">
                  Retour au tableau de bord
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
            <Card size="3" className="admin-card">
              <form method="post" noValidate onSubmit={(event) => void submit(event)}>
                <input type="text" name="username" value={email} autoComplete="username" readOnly hidden />
                <Flex direction="column" gap="4">
                  <Field label="Mot de passe actuel" htmlFor="current" error={errors.current}>
                    <TextField.Root id="current" name="current" type="password" autoComplete="current-password" color={errors.current ? "red" : undefined} />
                  </Field>
                  <Field label="Nouveau mot de passe" htmlFor="next" hint="12 caractères au moins. Une phrase de quelques mots fait un bon mot de passe." error={errors.next}>
                    <TextField.Root id="next" name="next" type="password" autoComplete="new-password" minLength={12} color={errors.next ? "red" : undefined} />
                  </Field>
                  <Field label="Encore une fois" htmlFor="again" error={errors.again}>
                    <TextField.Root id="again" name="again" type="password" autoComplete="new-password" color={errors.again ? "red" : undefined} />
                  </Field>
                  <Flex justify="end">
                    <Button type="submit" loading={sending}>
                      Changer le mot de passe
                    </Button>
                  </Flex>
                </Flex>
              </form>
            </Card>
          </>
        )}
      </Box>
    </>
  );
}
