// Ayudante MCP de Aula para los agentes CLI (claude, codex, opencode). electron-vite lo empaqueta como `out/main/aula-mcp.js`
// y Aula lo lanza con su propio ejecutable en modo Node:
//
//   ELECTRON_RUN_AS_NODE=1 AULA_RELAY_URL=http://127.0.0.1:<puerto> AULA_RELAY_TOKEN=<clave> <Aula> out/main/aula-mcp.js
//
// (ver `aulaMCPServerSpec` en src/main/services/agents/provider.ts). Habla JSON-RPC por stdin/stdout, un mensaje por línea;
// todo lo demás va a stderr. Nunca importa `electron`.
import { mainAulaMCP } from './helper'

mainAulaMCP()
