# Seneschal Companion

The companion adds a dedicated **Seneschal** view to the Visual Studio Code Activity Bar and a status-bar shortcut. From the editor you can:

- chat with every model connected in Seneschal;
- choose or create a project-specific session;
- use **Plan** mode for analysis or **Build** mode for edits and commands;
- include the current selection or file as explicit context;
- follow responses and tool activity, stop a run, and open the complete session in Seneschal;
- review model edits immediately in VS Code's editor and Source Control view.

Install it from Seneschal's **VS Code** dialog. Seneschal must be running locally.

The files are shared with Seneschal through the open project. Build mode can therefore edit them directly. Code is only included in a prompt when you enable **Selection** or **File** context, or when the chosen agent reads it with the access you approved.

This panel is independent from GitHub Copilot. Copilot's model picker, account, and upgrade labels do not control Seneschal's providers.
