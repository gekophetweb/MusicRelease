"use client";

import { useState } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import type { SignInMethods } from "@/lib/signin";

const SENT = "If this address can sign in, a code is on its way. It expires in 10 minutes.";
const ERRORS: Record<string, string> = {
  INVALID_OTP: "That code is wrong or has expired.",
  OTP_EXPIRED: "That code is wrong or has expired.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Request a new code.",
};

function GoogleButton({ callbackURL }: { callbackURL: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className="w-full"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signIn.social({ provider: "google", callbackURL, errorCallbackURL: "/?error=signin" });
      }}
    >
      {busy ? "Redirecting…" : "Continue with Google"}
    </Button>
  );
}

function EmailCodeForm({ callbackURL }: { callbackURL: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  async function sendCode() {
    setBusy(true);
    setMessage(null);
    const res = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" });
    setBusy(false);
    if (res.error) return setMessage({ kind: "error", text: res.error.message ?? "Could not send a code. Try again." });
    setStage("code");
    setCode("");
    setMessage({ kind: "info", text: SENT });
  }

  async function verify() {
    setBusy(true);
    setMessage(null);
    const res = await authClient.signIn.emailOtp({ email: email.trim(), otp: code.trim() });
    if (res.error) {
      setBusy(false);
      const text = (res.error.code && ERRORS[res.error.code]) || res.error.message || "Signing in failed.";
      return setMessage({ kind: "error", text });
    }
    window.location.assign(callbackURL);
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void (stage === "email" ? sendCode() : verify());
      }}
    >
      <Field label="Email" htmlFor="signin-email">
        <TextInput
          id="signin-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          readOnly={stage === "code"}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      {stage === "code" && (
        <Field label="6-digit code" htmlFor="signin-code">
          <TextInput
            id="signin-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
      )}
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-danger" : "text-muted"}`}>
          {message.text}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {stage === "email" ? (busy ? "Sending…" : "Email me a code") : busy ? "Signing in…" : "Sign in"}
        </Button>
        {stage === "code" && (
          <Button type="button" variant="quiet" disabled={busy} onClick={() => void sendCode()}>
            Send a new code
          </Button>
        )}
        {stage === "code" && (
          <Button type="button" variant="quiet" disabled={busy} onClick={() => (setStage("email"), setMessage(null))}>
            Use another email
          </Button>
        )}
      </div>
    </form>
  );
}

/** Sign in with Google and/or an email code, depending on what the admin set up. */
export function SignIn({ methods, callbackURL }: { methods: SignInMethods; callbackURL: string }) {
  if (!methods.google && !methods.emailCode) {
    return <p className="text-muted">Sign-in isn&apos;t set up yet. Ask the admin.</p>;
  }
  return (
    <div className="max-w-sm space-y-6">
      {methods.google && <GoogleButton callbackURL={callbackURL} />}
      {methods.google && methods.emailCode && (
        <p className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted">
          <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
        </p>
      )}
      {methods.emailCode && <EmailCodeForm callbackURL={callbackURL} />}
    </div>
  );
}
