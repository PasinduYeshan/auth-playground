@AGENTS.md

## Claude Code notes

- The instructions above apply in full. In particular: ask before every push, because a push to `main` deploys the site.
- To check a change in the app, run `npm run dev` and use the browser to drive `http://localhost:5173`. Read the page with the accessibility tree or page text, and take screenshots only when the layout matters.
- Keep test credentials out of messages. Read them from `scripts/.thunderid-env` when a test needs them.
- In shell heredocs, don't use `EOF` as the delimiter when the body itself contains an `EOF` line (the setup script writes one). Use a unique delimiter, or write the content with a file edit.
