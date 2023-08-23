import Game from "./Game.js"
import { GamePrivacy, GameStatus } from "./Enums.js"

export default class Client {
    constructor(ws, session) {
        this.session = session

        this.ws = ws
        this.currentGame = null

        this.ws.on("message", this.onMessage.bind(this))
        this.ws.on("close", this.onClose.bind(this))

        this.session.clients.add(this)
        this.session.updatePublicPlayerCount(this)
    }
    onClose() {
        if (this.currentGame)
            this.currentGame.leave(this)
        this.session.clients.delete(this)
    }
    async onMessage(bin) {
        let data
        try {
            data = await JSON.parse(bin.toString())
        } catch(e) {
            return
        }
        switch (data.type) {
            case "join_queue":
                if (this.currentGame)
                    return
                if (!data.gameId) {
                    if (data.queue === GamePrivacy.PUBLIC) {
                        this.session.publicGame.join(this)
                    } else if (data.queue === GamePrivacy.PRIVATE) {
                        new Game(GamePrivacy.PRIVATE, this.session).join(this)
                    }
                }
                else {
                    const game = this.session.retreiveGameById(data.gameId)
                    if (game && game.status === GameStatus.QUEUE && game.players.length < 2)
                        game.join(this)
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
        }
    }
    send(data) {
        this.ws.send(data)
    }
}