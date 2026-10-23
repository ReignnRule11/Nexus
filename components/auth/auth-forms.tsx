"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, isApiError, userMessageForError } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import type { SessionUser } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { StatusMessage } from "@/components/ui/status";

export function LoginForm() {
  const router = useRouter();
  const { setUser } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const body = await apiRequest<{ user: SessionUser }>("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      setUser(body.user);
      router.push("/feed");
    } catch (caught) {
      if (isApiError(caught) && caught.fields) {
        setFieldErrors(caught.fields);
      }
      setError(userMessageForError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack" noValidate>
      <Field id="login-email" label="Email" required error={fieldErrors.email}>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
          required
        />
      </Field>
      <Field id="login-password" label="Password" required error={fieldErrors.password}>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          required
        />
      </Field>
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const { setUser } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const body = await apiRequest<{ user: SessionUser }>("/api/auth/register", {
        method: "POST",
        body: { email, password, username, displayName },
      });
      setUser(body.user);
      router.push("/feed");
    } catch (caught) {
      if (isApiError(caught) && caught.fields) {
        setFieldErrors(caught.fields);
      }
      setError(userMessageForError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack" noValidate>
      <Field id="register-email" label="Email" required error={fieldErrors.email}>
        <Input
          id="register-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
          required
        />
      </Field>
      <Field
        id="register-password"
        label="Password"
        required
        hint="12 to 128 characters."
        error={fieldErrors.password}
      >
        <Input
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          required
          minLength={12}
        />
      </Field>
      <Field
        id="register-username"
        label="Username"
        required
        hint="3-32 letters, numbers, or underscores."
        error={fieldErrors.username}
      >
        <Input
          id="register-username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          error={fieldErrors.username}
          required
        />
      </Field>
      <Field id="register-display-name" label="Display name" required error={fieldErrors.displayName}>
        <Input
          id="register-display-name"
          name="displayName"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          error={fieldErrors.displayName}
          required
        />
      </Field>
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account..." : "Create account"}
      </Button>
    </form>
  );
}
