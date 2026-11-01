# Pending question controls

The engine's question tool is not a permission approval. It suspends work until the user answers or dismisses a specific pending request. Previously Seneschal displayed the running tool but did not render its question, leaving no way to answer.

## Implemented

- A separate native question dialog with single-choice, multiple-choice and custom answers, plus Send answers and Dismiss question.
- Close and Escape close only the display. The pending-question banner can reopen it without submitting anything.
- Labeled native inputs, fieldset/legend grouping, visible keyboard focus, focus wrapping/restoration and live status/error messages.
- Scrollable, viewport-bounded dialog with sticky header/actions and phone-sized touch targets, using Seneschal's day/night tokens.
- Session/directory-scoped question snapshots and events. Switching sessions cannot send a reply to the previous session.
- Read-only recovery after reload/reconnect, with no default selection, automatic answer, mutation replay or question-to-permission conversion.
- Concurrent clicks are refused. An unconfirmed response requires a manual status refresh before a further explicit attempt.
- The phone gateway permits only the two static assets, GET pending questions, and POST reply/reject for a bounded request identifier. Existing owner, origin, pairing and local-auth checks remain in place.

No model selection, Moli/Brave routing, sign-in, history, Tailscale mapping or approval decision was changed.

## Verification

Twelve focused synthetic question checks pass. The Moli and model-diagnostic unit checks also pass (22 total across those three files), as do two focused model-registration smoke checks.

An isolated browser fixture using a new ephemeral Brave profile and in-memory mock responses passes desktop, phone, short-phone-height and day-theme scenarios. It checks no automatic submission, radio/custom exclusivity, multiple answers, draft preservation while polling, keyboard focus wrapping, Escape/reopen, explicit reply payload and dialog viewport bounds. These are fixture results, not a claim that an actual phone/engine has been tested. No live engine, account, network fetch or model prompt was used.

Docker is not running/accessible in the assistant session. The expanded private-access verifier now expects **55** checks and includes the question assets/tests in its source hashes. The previous owner-reported 43-check proof is historical for this change.

## Activate

Open Docker Desktop and run the installed App's `scripts/verify-private-access.ps1`. Continue only after all 55 checks pass. Finish PC/phone tasks, then run the installed `scripts/restart-seneschal.ps1` and type RESTART. A PC reboot is not needed.

After restart, refresh PC and phone. In a harmless test session, ask Seneschal to ask one question before doing any work. Verify:

1. The question and choices appear, with nothing preselected.
2. Close/Escape leaves it pending and Answer question reopens it.
3. Refreshing the page recovers the pending request without sending a response.
4. An explicit Send answers resumes the waiting task; Dismiss question instead dismisses that request.
5. A question in a different session is never answered by the current session's form.

Do not auto-approve prompts or replay actions as a workaround. Real phone, engine and reconnect checks remain owner-validation work.

Contract checked against [OpenCode's engine-version SDK question endpoints](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/sdk/js/src/v2/gen/sdk.gen.ts) and [question schema](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/sdk/js/src/v2/gen/types.gen.ts).
