import { WebSocketServer } from "ws";

// Set port to 8080 if environment variable PORT is not set
const PORT = process.env.PORT || 8080;

const ws_server = new WebSocketServer({ port: PORT });


// Clients => Map<client, gameId>
const clients = new Map()
// Games => Map<gameId, gameState>
const games = new Map()
// Queue => Set<client>
const queue = new Set()


// const gameState = {
//     grid: Array(9).fill(null),
//     currentPlayer: 0,
// }


function isGameWin(grid1D, i) {
    // Convert the grid to a 2D array
    const grid2D = []
    for (let i = 0; i < grid1D.length; i += 3) {
        grid2D.push(grid1D.slice(i, i + 3))
    }
    const grid = { grid: grid2D, col: 3, row: 3 }

    // Convert i to a 2D coordinate
    const sx = i % 3
    const sy = Math.floor(i / 3)

    const player = grid2D[sy][sx]

    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        let x = sx
        let y = sy
        let count = 1
        while ((0 <= x+dx) && (x+dx < grid.col) && (0 <= y+dy) && (y+dy < grid.row) && (grid.grid[y+dy][x+dx] === player)) {
            x += dx
            y += dy
            count += 1
        }
        x = sx
        y = sy
        while ((0 <= x-dx) && (x-dx < grid.col) && (0 <= y-dy) && (y-dy < grid.row) && (grid.grid[y-dy][x-dx] === player)) {
            x -= dx
            y -= dy
            count += 1
        }
        if (count >= 3) {
            return player
        }
    }
    return null
}


function gameSync(gameId) {
    const gameState = games.get(gameId)
    for (let i = 0; i < gameState.players.length; i++) {
        const client = gameState.players[i]
        const clientState = { ...gameState, playerId: i }
        delete clientState.players
        client.send(JSON.stringify({ type: "sync", state: clientState }))
    }
}

function gameEnd(gameId, winner) {
    const gameState = games.get(gameId)
    gameState.status = "finished"
    gameState.winner = winner
    gameSync(gameId)
    for (const client of gameState.players)
        clients.set(client, null)
    games.delete(gameId)
}

function updateOnlineCount() {
    for (const client of clients.keys()) {
        client.send(JSON.stringify({ type: "online_count_update", count: clients.size }))
    }
}

ws_server.on("connection", function(client) {

    clients.set(client, null)
    updateOnlineCount()

    client.on("message", async function(bin) {
        let data
        try {
            data = await JSON.parse(bin.toString())
        } catch(e) {
            console.log(e)
        }
        if (data.type === "join_queue") {
            queue.add(client)
            if (queue.size < 2)
                return
            const gameId = Math.random().toString(36).substring(2, 15)
            const players = []
            for (const c of queue) {
                clients.set(c, gameId)
                players.push(c)
            }
            queue.clear()
            const gameState = {
                grid: Array(9).fill(null),
                currentPlayer: 0,
                players: players.sort(() => Math.random() - 0.5),
                status: "playing",
                gameId: gameId
            }
            games.set(gameId, gameState)
            gameSync(gameId)
        } else if (data.type === "leave_queue") {
            queue.delete(client)
        } else if (data.type === "play") {
            const gameId = clients.get(client)
            const gameState = games.get(gameId)
            if (!gameId || !gameState)
                return
            if (gameState.currentPlayer !== gameState.players.findIndex(x => x === client))
                return
            if (gameState.grid[data.slot] !== null)
                return
            gameState.grid[data.slot] = gameState.currentPlayer
            if (isGameWin(gameState.grid, data.slot) !== null)
                gameEnd(gameId, gameState.currentPlayer)
            else if (gameState.grid.every(x => x !== null))
                gameEnd(gameId, null)
            else {
                gameState.currentPlayer = (gameState.currentPlayer + 1) % 2
                gameSync(gameId)
            }
        } else if (data.type === "re_sync") {
            const gameId = clients.get(client)
            if (!gameId)
                return
            gameSync(gameId)
        }
    })

    client.on("close", function() {
        if (queue.has(client)) {
            queue.delete(client)
        }
        const gameId = clients.get(client)
        const gameState = games.get(gameId)
        if (gameId && gameState) {
            const winner = gameState.players.findIndex(x => x !== client)
            gameEnd(gameId, winner)
        }
        clients.delete(client)
        updateOnlineCount()
    })

})