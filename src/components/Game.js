import { GamePrivacy, GameStatus, GameEndReason } from "./Enums.js"

export default class Game {
    constructor(privacy, session) {
        this.session = session

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
        this.lastUpdate = Date.now()
        this.session.games.add(this)
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
                lastUpdate: this.lastUpdate = Date.now(),
                playInterval: null,
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
        if (this.privacy === GamePrivacy.PUBLIC) this.session.updatePublicPlayerCount()
        this.sync()
    }
    leave(client) {
        if (this.status === GameStatus.PLAYING)
            this.end(GameEndReason.LEAVE, this.players.indexOf(this.players.find(c => c !== client)))
        else {
            this.players.splice(this.players.indexOf(client), 1)
            client.currentGame = null
            client.send(JSON.stringify({ type: "sync", state: null }))
            if (this.privacy === GamePrivacy.PUBLIC) this.session.updatePublicPlayerCount()
            else if (this.privacy === GamePrivacy.PRIVATE && this.players.length === 0)
                this.session.games.delete(this)
        }
    }
    start() {
        this.players.sort(() => Math.random() - 0.5)
        this.status = GameStatus.PLAYING
        if (this.privacy === GamePrivacy.PUBLIC) this.session.publicGame = new Game(GamePrivacy.PUBLIC, this.session)
        this.lastUpdate = Date.now()
        this.playInterval = setInterval(() => this.end(GameEndReason.TIME, this.currentPlayer === 0 ? 1 : 0), 2 * 60 * 1000)
    }
    play(client, slot) {
        if (this.status !== GameStatus.PLAYING)
            return
        if (this.players[this.currentPlayer] !== client)
            return
        if (this.grid[slot] !== null)
            return
        this.grid[slot] = this.currentPlayer
        this.lastUpdate = Date.now()
        clearInterval(this.playInterval)
        this.playInterval = setInterval(() => this.end(GameEndReason.TIME, this.currentPlayer === 0 ? 1 : 0), 30 * 1000)
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

        clearInterval(this.playInterval)

        this.sync()
        this.session.games.delete(this)
        for (const client of this.players)
            client.currentGame = null
        if (this.privacy === GamePrivacy.PUBLIC) this.session.updatePublicPlayerCount()
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