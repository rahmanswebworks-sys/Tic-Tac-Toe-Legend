const express = require('express');
const http = require('http');
const { Server } = require('ws');
const { readFileSync, writeFile } = require('fs');
const os = require('os');
const app = express();
const server = http.createServer(app);
const wss = new Server({ server });
let roomsCounts = 0;
const rooms = [];
let users = [];
const startedDateTime = Date.now();
const A_POINT = 15;
let connection_logs = 'connection logs : <br>';

try {
    users = JSON.parse(readFileSync('users.json', 'utf-8'));
} catch (err) {
    console.error('<= Failed to read users.json =>');
}

wss.on('connection', (ws) => {
    connection_logs += `connection at ${new Date().toLocaleString()}<br>`;
    ws.on('message', (msg) => {
        const decoded_msg = JSON.parse(msg);

        switch (decoded_msg.action) {
            case 'play':
                {
                    let freeRoom = null;

                    if (decoded_msg.type === 'random') freeRoom = rooms.find(r => !r.private && r.vacant && r.player1.userId !== decoded_msg.userId);
                    if (decoded_msg.type === 'private' && decoded_msg.code) freeRoom = rooms.find(r => r.code === decoded_msg.code && r.vacant && r.player1.userId !== decoded_msg.userId);

                    if (rooms.length && freeRoom) {
                        freeRoom.player2 = {
                            profile: decoded_msg.profile,
                            xp: decoded_msg.xp,
                            userId: decoded_msg.userId,
                            socket: ws,
                            ready: false,
                            roomId: freeRoom.id,
                            playerId: 2,
                        }

                        freeRoom.vacant = false;

                        freeRoom.player2.socket.send(JSON.stringify({
                            action: 'room_info',
                            opponent: {
                                profile: freeRoom.player1.profile,
                                xp: freeRoom.player1.xp,
                                userId: freeRoom.player1.userId,
                            },
                            roomId: freeRoom.id,
                            playerId: 2,
                            code: freeRoom.code,
                            type: decoded_msg.type
                        }))

                        freeRoom.player2.socket.on('close', () => {
                            const roomIndex = rooms.findIndex(r => r === freeRoom);

                            freeRoom.player1.socket.send(JSON.stringify({
                                action: 'player_disconnected',
                            }))

                            rooms.splice(roomIndex, 1);
                        })

                        freeRoom.player1.socket.send(JSON.stringify({
                            action: 'room_info',
                            opponent: {
                                profile: freeRoom.player2.profile,
                                xp: freeRoom.player2.xp,
                                userId: freeRoom.player2.userId,
                            },
                            roomId: freeRoom.id,
                            code: freeRoom.code,
                            playerId: 1,
                            type: decoded_msg.type
                        }))

                        freeRoom.player1.socket.on('close', () => {
                            const roomIndex = rooms.findIndex(r => r === freeRoom);

                            freeRoom.player2.socket.send(JSON.stringify({
                                action: 'player_disconnected',
                            }))

                            rooms.splice(roomIndex, 1);
                        })

                    } else {
                        if (decoded_msg.type === 'private' && !decoded_msg.createRoom) {
                            ws.send(JSON.stringify({
                                action: 'invalid_code',
                            }))

                            break;
                        }

                        const roomId = ++roomsCounts;

                        const room = {
                            private: false,
                            vacant: true,
                            player1: {
                                profile: decoded_msg.profile,
                                xp: decoded_msg.xp,
                                userId: decoded_msg.userId,
                                socket: ws,
                                ready: false,
                                roomId: roomsCounts,
                                playerId: 1,
                            },
                            player2: null,
                            id: roomsCounts,
                            type: decoded_msg.type
                        }

                        if (decoded_msg.type === 'private' && decoded_msg.createRoom) {
                            room.private = true;
                            room.code = getCode(roomId);
                        }

                        rooms.push(room);

                        room.player1.socket.send(JSON.stringify({
                            action: 'room_info',
                            playerId: 1,
                            roomId,
                            code: room.code,
                            type: decoded_msg.type
                        }))

                        setTimeout(() => {
                            if (room.vacant) {
                                const roomIndex = rooms.findIndex(r => r.id === room.id);

                                if (room.player1 && room.player1.socket.readyState === 1) room.player1.socket.send(JSON.stringify({
                                    action: 'timeout',
                                    code: room.code,
                                    roomId,
                                }))

                                rooms.splice(roomIndex, 1);
                            }
                        }, 1800000);
                    }
                }
                break;
            case 'canceled':
                {
                    const room = rooms.find(r => r.id === decoded_msg.roomId);
                    const roomIndex = rooms.findIndex(r => r.id === decoded_msg.roomId);

                    if (!room) break;

                    if (decoded_msg.playerId === 1) {
                        if (room.player2) room.player2.socket.send(JSON.stringify({
                            action: 'player_canceled',
                            endOfGame: decoded_msg.endOfGame
                        }))
                    } else if (decoded_msg.playerId === 2) {
                        if (room.player1) room.player1.socket.send(JSON.stringify({
                            action: 'player_canceled',
                            endOfGame: decoded_msg.endOfGame
                        }))
                    }

                    rooms.splice(roomIndex, 1);
                }
                break;
            case 'ready':
                {
                    const room = rooms.find(r => r.id === decoded_msg.roomId);

                    if (!room) break;

                    function flipPlayers() {
                        const p1 = room.player1, p2 = room.player2;
                        room.player1 = p2;
                        room.player2 = p1;
                    }

                    if (decoded_msg.playerId === 1) {
                        room.player1.ready = true;

                        if (room.player2.ready) {
                            room.player1.socket.send(JSON.stringify({
                                action: 'start_game',
                                type: room.type
                            }))

                            room.player2.socket.send(JSON.stringify({
                                action: 'start_game',
                                type: room.type
                            }))

                            room.player1.ready = false;

                            room.player2.ready = false;

                            if (decoded_msg.flipPlayers) flipPlayers();
                        }
                    } else if (decoded_msg.playerId === 2) {
                        room.player2.ready = true;

                        if (room.player1.ready) {
                            room.player1.socket.send(JSON.stringify({
                                action: 'start_game',
                                type: room.type
                            }))

                            room.player2.socket.send(JSON.stringify({
                                action: 'start_game',
                                type: room.type
                            }))

                            room.player1.ready = false;

                            room.player2.ready = false;

                            if (decoded_msg.flipPlayers) flipPlayers();
                        }
                    }
                }
                break;
            case 'play_turn':
                {
                    const room = rooms.find(r => r.id === decoded_msg.roomId);

                    if (!room) break;

                    if (decoded_msg.playerId === 1) {
                        room.player2.socket.send(JSON.stringify({
                            action: 'play_turn',
                            rowIndex: decoded_msg.rowIndex,
                            cellIndex: decoded_msg.cellIndex
                        }))
                    } else if (decoded_msg.playerId === 2) {
                        room.player1.socket.send(JSON.stringify({
                            action: 'play_turn',
                            rowIndex: decoded_msg.rowIndex,
                            cellIndex: decoded_msg.cellIndex
                        }))
                    }
                }
                break;
            case 'timer_elapsed':
                {
                    const room = rooms.find(r => r.id === decoded_msg.roomId);

                    if (!room) break;

                    if (decoded_msg.playerId === 1) {
                        if (room.player2) room.player2.socket.send(JSON.stringify({
                            action: 'timer_elapsed',
                        }))
                    } else if (decoded_msg.playerId === 2) {
                        if (room.player1) room.player1.socket.send(JSON.stringify({
                            action: 'timer_elapsed',
                        }))
                    }
                }
                break;
            case 'send_message':
                {
                    const room = rooms.find(r => r.id === decoded_msg.roomId);

                    if (!room) break;

                    if (decoded_msg.playerId === 1) {
                        if (room.player2) room.player2.socket.send(JSON.stringify({
                            action: 'receive_message',
                            message: decoded_msg.message,
                            time: decoded_msg.time,
                        }))
                    } else if (decoded_msg.playerId === 2) {
                        if (room.player1) room.player1.socket.send(JSON.stringify({
                            action: 'receive_message',
                            message: decoded_msg.message,
                            time: decoded_msg.time
                        }))
                    }
                }
                break;
            case 'request_user_id':
                {
                    const id = getUserId();

                    users.push({
                        id,
                        profile: null,
                        points: 0
                    })

                    writeFile('users.json', JSON.stringify(users), () => { });

                    ws.send(JSON.stringify({
                        action: 'user_id',
                        id
                    }))
                }
                break;
            case 'update_user_profile':
                {
                    const user = users.find(u => u.id === decoded_msg.userId);

                    if (!user) break;

                    user.profile = decoded_msg.profile;
                    broadcastLeaderboard();
                    writeFile('users.json', JSON.stringify(users), () => { });
                }
                break;
            case 'add_points':
                {
                    const user = users.find(u => u.id === decoded_msg.userId);

                    if (!user) break;

                    user.points += A_POINT;
                    broadcastLeaderboard();
                    writeFile('users.json', JSON.stringify(users), () => { });
                }
                break;
        }
    })
})

function getLeaderboard() {
    let players = JSON.parse(JSON.stringify(users.filter(u => u.profile)));
    players.sort((a, b) => b.points - a.points);
    return JSON.stringify(players);
}

function broadcastLeaderboard() {
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(JSON.stringify({
                action: 'leaderboard',
                leaderboard: getLeaderboard()
            }));
        }
    })
}

function getCode(id) {
    return Math.floor(Math.random() * 89465373 / (Math.random() * 100) + Math.random() * 55236) + '-r' + id
}

function getUserId() {
    return Math.floor(Math.random() * 9565255895052754475 / (Math.random() * 10787450) + Math.random() * 5526655765353436) + '-' + (users.length + 1);
}

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

app.get('/', (req, res) => {
    res.status(200).send('<h1>Tic Tac Toe Legend</h1><a href="/info">info</a>');
})

app.head("/", (req, res) => {
    res.sendStatus(200);
});

app.get('/leaderboard', (req, res) => {
    res.status(200).send(getLeaderboard());
});

app.get('/users', (req, res) => {
    res.status(200).send(JSON.stringify(users));
});

app.get('/connection_logs', (req, res) => {
    res.status(200).send(connection_logs);
});

app.get('/info', (req, res) => {
    res.status(200).send(`
    Tic Tac Toe Legend
    <br>status: <span style="color: green">running</span> on ${os.type()} ${os.arch()}
    <br>users: ${users.length}
    <br>rooms: ${rooms.length}
    <br>rooms count: ${roomsCounts}
    <br>online users: ${wss.clients.size}
    <br>started on: ${new Date(startedDateTime).toString()}
    `)
});

app.get('/rooms', (req, res) => {
    res.status(200).send(JSON.stringify(rooms.map(r => {
        const rr = JSON.parse(JSON.stringify(r));

        if (rr.player1) delete rr.player1.socket;
        if (rr.player2) delete rr.player2.socket;

        return rr;
    })))
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));