/** Ce que la garde de l'admin (src/middleware.ts) laisse aux pages de /admin. */
declare namespace App {
  interface Locals {
    /** Le client Supabase Auth de la requête : connexion, déconnexion, mot de passe. */
    supabase?: import("@supabase/supabase-js").SupabaseClient;
    /** La personne connectée, telle que Supabase Auth l'a vérifiée. */
    user?: { id: string; email: string };
    /** Sa fiche d'équipe ; absente pour un compte hors de l'équipe. */
    member?: import("@parabole/cms").TeamMember;
    /** Les lectures et les écritures de l'admin, sous son rôle. Seulement pour un membre de l'équipe. */
    admin?: import("@parabole/cms").Admin;
    /** Pourquoi l'admin ne peut pas répondre (page /admin/indisponible). */
    problem?: string;
  }
}
