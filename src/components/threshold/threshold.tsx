"use client";

import { useActionState } from "react";
import { ApparitionField } from "@/components/apparition";
import { signIn, type AuthState } from "@/app/actions";

const INITIAL: AuthState = { error: null, notice: null };

export function Threshold() {
  const [state, formAction, pending] = useActionState(signIn, INITIAL);

  return (
    <>
      <ApparitionField
        className="field-bg"
        options={{ count: 860, fade: 0.12, scale: 0.56, yShift: 0.015, shape: "site" }}
      />

      <main className="threshold">
        <header className="th-head">
          <div className="readout mono manifest" style={{ ["--d" as string]: 6 }}>
            <span className="tick" />
            <span>PHANTOM&nbsp;·&nbsp;THE&nbsp;THRESHOLD</span>
          </div>
          <div className="readout mono manifest" style={{ ["--d" as string]: 7 }}>
            <span>
              SIGNAL&nbsp;<b>98%</b>&nbsp;·&nbsp;VEIL&nbsp;THIN
            </span>
            <span className="tick" />
          </div>
        </header>

        <section className="th-stage">
          <h1 className="wordmark manifest" style={{ ["--d" as string]: 1 }} data-ghost="PHANTOM">
            PHANTOM
          </h1>
          <p className="manifesto manifest" style={{ ["--d" as string]: 3 }}>
            Every site already exists, perfect and waiting.
            <br />
            <strong>Cross the veil to make it visible.</strong>
          </p>

          <form className="auth manifest" style={{ ["--d" as string]: 5 }} action={formAction}>
            <div className="field">
              <label htmlFor="email">Your name in the world</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@studio.com"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="password">The word that lifts the veil</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
            </div>

            <button type="submit" className="ghost-btn ecto" disabled={pending}>
              {pending ? "Parting the veil…" : "Cross the Threshold →"}
            </button>

            <p
              className={`auth-msg ${state.error ? "err" : state.notice ? "ok" : ""}`}
              role="status"
              aria-live="polite"
            >
              {state.error ?? state.notice ?? " "}
            </p>
          </form>

          <p className="summon-hint manifest" style={{ ["--d" as string]: 8 }}>
            Click the vapor to summon the form
          </p>
        </section>

        <footer className="th-foot">
          <span className="mono manifest" style={{ ["--d" as string]: 9 }}>
            EVERY&nbsp;SITE&nbsp;ALREADY&nbsp;EXISTS
          </span>
          <span className="mono foot-right manifest" style={{ ["--d" as string]: 10 }}>
            MANIFEST&nbsp;01&nbsp;·&nbsp;SIGNAL&nbsp;98%
          </span>
        </footer>
      </main>
    </>
  );
}
