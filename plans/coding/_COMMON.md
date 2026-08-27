# Common rules — included in every phase (do not send this file alone)

Project root: `/Users/vidyasagar/ProjectSpace/webmcp_exp/webmcp-computer`

- TypeScript. Avoid `any`.
- Import types and policy from `@webmcp-computer/contract`. Do not copy the union by hand.
- Do not edit `plans/**` or `packages/contract/**`.
- Do not touch `webmcp-todo`, `webmcp-board`, or `agent-outpost`.
- Hono, not Express.
- Machine tools and `POST /api/act` take no `computerId`.
- No mouse/click tools, no in-app LLM, no extra machines.
- When finished: list files changed and how to verify THIS phase only.
