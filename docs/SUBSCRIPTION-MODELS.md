# Models and provider accounts

Connect providers through OpenCode, then refresh Seneschal's model list. The picker displays models the connected engine reports; a name in a provider's announcement does not establish access through your account.

A ChatGPT subscription and a provider API account are different products. Availability, rate limits and charges depend on the selected provider and account. Seneschal's local usage estimate and target are not billing controls.

If an expected model is missing, check the provider connection and any model allowlist in your OpenCode configuration. The local catalog diagnostic helper can identify availability without returning credentials. Avoid posting raw configuration files or authentication stores in GitHub issues.

The Thinking selector appears when the selected model exposes supported choices. It changes the requested effort level, not the availability of private model reasoning. The interface can display only the summaries and tool events supplied by the provider and engine.

Changing the chat model does not select a speech service. Browser speech and optional NVIDIA speech are configured separately in the Voice dropdown; see the [user guide](USER-GUIDE.md).
