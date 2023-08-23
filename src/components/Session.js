import Game from './Game.js'
import { GamePrivacy } from './Enums.js'

export default class Session {
    constructor() {
        this.games = new Set()
        this.clients = new Set()
        this.publicGame = new Game(GamePrivacy.PUBLIC, this)
    }
    updatePublicPlayerCount(client) {
        const targets = client ? [client] : this.clients
        let count = 0
        for (const game of this.games)
            if (game.privacy === GamePrivacy.PUBLIC)
                count += game.players.length
        const data = {
            type: "public_player_count",
            count
        }
        for (const target of targets)
            target.send(JSON.stringify(data))
    }
    retreiveGameById(id) {
        return Array.from(this.games).find(game => game.id === id)
    }
}