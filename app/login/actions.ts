"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOrigin } from "@/lib/origin";

export async function login(formData: FormData) {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
    options: {
      data: { display_name: String(formData.get("display_name") ?? "") },
    },
  });

  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  // If email confirmation is enabled, there is no session yet.
  if (!data.session) {
    redirect(`/login?message=${encodeURIComponent("Check your email to confirm your account.")}`);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

// Send a password-reset email. The link lands on /auth/callback, which exchanges
// the code for a (recovery) session and forwards to /reset-password.
export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (email) {
    const supabase = await createClient();
    // Origin from the live request (not NEXT_PUBLIC_SITE_URL) so the link points
    // at whatever domain the user is actually on. No query string on redirectTo —
    // Supabase matches it against the allowlist exactly, and a `?next=` param
    // makes it fall back to the Site URL (homepage).
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${await getOrigin()}/auth/callback`,
    });
  }
  // Always report success — don't reveal whether an email is registered.
  redirect("/forgot-password?sent=1");
}

// Set a new password. Requires the recovery session created by /auth/callback.
export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?error=${encodeURIComponent("Reset link expired. Request a new one.")}`);
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(`/reset-password?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard?account_msg=Password+updated.");
}
