import { WebSocketServer } from "ws"

const PORT = process.env.PORT || 8080

const ws_server = new WebSocketServer({ port: PORT })

const GameStatus = { QUEUE: "queue", PLAYING: "playing", FINISHED: "finished" }
const GamePrivacy = { PUBLIC: "public", PRIVATE: "private" }
const GameEndReason = { WIN: "win", DRAW: "draw", LEAVE: "leave" }

const clients = new Set()
const games = new Set()

let publicGame

class Game {
    constructor(privacy) {
        this.id = Math.random().toString(36).substring(2, 9)
        this.players = []

        this.status = GameStatus.QUEUE
        this.privacy = privacy
        
        this.grid = Array(9).fill(null)
        this.currentPlayer = 0

        this.results = {
            winner: null,
            reason: null
        }
        games.add(this)
    }
    sync() {
        for (let i = 0; i < this.players.length; i++) {
            const client = this.players[i]
            const gameState = {
                id: this.id,
                status: this.status,
                privacy: this.privacy,
                grid: this.grid,
                currentPlayer: this.currentPlayer,
                results: {
                    winner: this.results.winner,
                    reason: this.results.reason
                },
                playerId: i
            }
            client.send(JSON.stringify({ type: "sync", state: gameState }))
        }
    }
    join(client) {
        if (this.players.length >= 2)
            return
        client.currentGame = this
        this.players.push(client)
        if (this.players.length == 2)
            this.start()
        if (this.privacy === GamePrivacy.PUBLIC) update_public_player_count()
    }
    leave(client) {
        if (this.status === GameStatus.PLAYING)
            this.end(GameEndReason.LEAVE, this.players.indexOf(this.players.find(c => c !== client)))
        else {
            this.players.splice(this.players.indexOf(client), 1)
            client.currentGame = null
            if (this.privacy === GamePrivacy.PUBLIC) update_public_player_count()
            else if (this.privacy === GamePrivacy.PRIVATE && this.players.length === 0)
                games.delete(this)
        }
    }
    start() {
        this.players.sort(() => Math.random() - 0.5)
        this.status = GameStatus.PLAYING
        for (const client of this.players)
            client.send(JSON.stringify({ type: "game_start", gameId: this.id }))
        if (this.privacy === GamePrivacy.PUBLIC) publicGame = new Game(GamePrivacy.PUBLIC)
    }
    play(client, slot) {
        if (this.status !== GameStatus.PLAYING)
            return
        if (this.players[this.currentPlayer] !== client)
            return
        if (this.grid[slot] !== null)
            return
        this.grid[slot] = this.currentPlayer
        const endData = this.checkWinner(slot)
        if (endData)
            this.end(...endData)
        else {
            this.currentPlayer = (this.currentPlayer + 1) % this.players.length
            this.sync()
        }
    }
    end(reason, winner) {
        this.status = GameStatus.FINISHED

        this.results.reason = reason
        this.results.winner = winner

        this.sync()
        games.delete(this)
        for (const client of this.players)
            client.currentGame = null
        if (this.privacy === GamePrivacy.PUBLIC) update_public_player_count()
    }
    checkWinner(slot) {
        const GRID_SIZE = 3
        const grid = []
        for (let i = 0; i < this.grid.length; i += GRID_SIZE) {
            grid.push(this.grid.slice(i, i + GRID_SIZE))
        }
        
        const sx = slot % GRID_SIZE
        const sy = Math.floor(slot / GRID_SIZE)
        const player = grid[sy][sx]
    
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
            let count = 1
            for (const sign of [-1, 1]) {
                let x = sx + dx * sign
                let y = sy + dy * sign
                while ((0 <= x) && (x < GRID_SIZE) && (0 <= y) && (y < GRID_SIZE) && (grid[y][x] === player)) {
                    x += dx * sign
                    y += dy * sign
                    count += 1
                }
                if (count >= 3) {
                    return [ GameEndReason.WIN, player ]
                }
            }
        }

        if (this.grid.every(v => v !== null))
            return [ GameEndReason.DRAW, null ]
    
        return null
    }
}

class Client {
    constructor(ws_connection) {
        this.ws_connection = ws_connection
        this.currentGame = null

        this.ws_connection.on("message", this.onMessage.bind(this))
        this.ws_connection.on("close", this.onClose.bind(this))

        clients.add(this)

        update_public_player_count(this)
    }
    onClose() {
        if (this.currentGame)
            this.currentGame.leave(this)
        clients.delete(this)
    }
    async onMessage(bin) {
        let data
        try {
            data = await JSON.parse(bin.toString())
        } catch(e) {
            console.log(e)
        }
        if (data.type !== "ping")
            console.log(data)
        switch (data.type) {
            case "join_queue":
                if (this.currentGame)
                    return
                if (!data.gameId) {
                    if (data.queue === GamePrivacy.PUBLIC) {
                        this.send(JSON.stringify({ type: "queue", success: true, gameId: publicGame.id }))
                        publicGame.join(this)
                    } else if (data.queue === GamePrivacy.PRIVATE) {
                        const privateGame = new Game(GamePrivacy.PRIVATE)
                        privateGame.join(this)
                        this.send(JSON.stringify({ type: "queue", success: true, gameId: privateGame.id }))
                    }
                }
                else {
                    const game = Array.from(games).find(game => game.id === data.gameId);
                    if (!game || game.status !== GameStatus.QUEUE || game.players.length >= 2)
                        this.send(JSON.stringify({ type: "queue", success: false, gameId: null }))
                    else {
                        game.join(this)
                        this.send(JSON.stringify({ type: "queue", success: true, gameId: game.id }))
                    }
                }
                break
            case "leave_queue":
                if (this.currentGame)
                    this.currentGame.leave(this)
                break
            case "play":
                if (this.currentGame)
                    this.currentGame.play(this, data.slot)
                break
            case "re_sync":
                if (this.currentGame)
                    this.currentGame.sync()
                break
        }
    }
    send(data) {
        this.ws_connection.send(data)
    }
}

function update_public_player_count(client) {
    const targets = client ? [client] : clients
    let count = 0
    for (const game of games)
        if (game.privacy === GamePrivacy.PUBLIC)
            count += game.players.length
    const data = {
        type: "public_player_count",
        count
    }
    for (const target of targets)
        target.send(JSON.stringify(data))
}

ws_server.on("connection", function(client) {
    new Client(client)
})

publicGame = new Game(GamePrivacy.PUBLIC)