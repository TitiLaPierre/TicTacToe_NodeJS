import { WebSocketServer } from "ws"
import Session from "./components/Session.js"
import Client from "./components/Client.js"

const PORT = process.env.PORT || 8080

const session = new Session()
const ws_server = new WebSocketServer({ port: PORT })

ws_server.on("connection", (client) => new Client(client, session))
console.log(`WebSocket server is open and listening on port ${PORT}!`)