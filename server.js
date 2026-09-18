const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(__dirname)); 

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 10000, 
    pingTimeout: 5000
});

let gameState = { status: 'waiting' };
let players = {}; 
let pollVotes = { A: 0, B: 0, C: 0, D: 0 }; 
let questionVotes = { A: 0, B: 0, C: 0, D: 0 }; 
let playerChoices = {}; 

// THRESHOLD FLAGS FOR HIGH CONCURRENCY
let pendingQuestionStats = false;
let pendingPollStats = false;
let pendingPlayerList = false;

io.on('connection', (socket) => {
    socket.emit('gameStateUpdate', gameState);
    socket.emit('playerListUpdate', Object.values(players).sort((a, b) => b.score - a.score));
    socket.emit('pollResultsUpdate', { votes: pollVotes, playerChoices: playerChoices });
    socket.emit('questionStatsUpdate', questionVotes);

    socket.on('joinGame', (name) => {
        players[socket.id] = { id: socket.id, name: name, score: 0 };
        pendingPlayerList = true; 
    });

    socket.on('hostUpdateState', (newState) => {
        gameState = { ...gameState, ...newState };
        if (gameState.status === 'poll' || gameState.status === 'active') {
            pollVotes = { A: 0, B: 0, C: 0, D: 0 };
            questionVotes = { A: 0, B: 0, C: 0, D: 0 };
            playerChoices = {};
            pendingPollStats = true;
            pendingQuestionStats = true;
        }
        io.emit('gameStateUpdate', gameState);
    });

    socket.on('submitAnswer', (data) => {
        if (players[socket.id]) {
            let pts = parseInt(data.pointsEarned) || 0;
            let choice = data.choice || '';
            let isPoll = data.isPoll || false;

            if (isPoll) {
                if (pollVotes[choice] !== undefined) {
                    pollVotes[choice]++;
                    playerChoices[players[socket.id].name] = choice; 
                    pendingPollStats = true;
                }
            } else {
                if (questionVotes[choice] !== undefined) {
                    questionVotes[choice]++;
                    pendingQuestionStats = true;
                }
                players[socket.id].score += pts;
                pendingPlayerList = true;
            }
        }
    });

    socket.on('resetGame', () => {
        gameState = { status: 'waiting' };
        pollVotes = { A: 0, B: 0, C: 0, D: 0 };
        questionVotes = { A: 0, B: 0, C: 0, D: 0 };
        playerChoices = {};
        for (let id in players) players[id].score = 0; 
        
        io.emit('gameStateUpdate', gameState);
        pendingPlayerList = true;
        pendingPollStats = true;
        pendingQuestionStats = true;
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            delete players[socket.id];
            pendingPlayerList = true;
        }
    });
});

// HIGH-CONCURRENCY THROTTLE LOOP (Every 500ms)
setInterval(() => {
    if (pendingQuestionStats) {
        io.emit('questionStatsUpdate', questionVotes);
        pendingQuestionStats = false;
    }
    if (pendingPollStats) {
        io.emit('pollResultsUpdate', { votes: pollVotes, playerChoices: playerChoices });
        pendingPollStats = false;
    }
    if (pendingPlayerList) {
        io.emit('playerListUpdate', Object.values(players).sort((a, b) => b.score - a.score));
        pendingPlayerList = false;
    }
}, 500); 

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Live Quiz server running on port ${PORT}`);
});