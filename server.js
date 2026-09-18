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
let questionVotes = { A: 0, B: 0, C: 0, D: 0 }; 

let pendingQuestionStats = false;
let pendingPlayerList = false;

// Track round points for the Fastest Finger shoutout
let roundGains = {}; 

io.on('connection', (socket) => {
    socket.emit('gameStateUpdate', gameState);
    socket.emit('playerListUpdate', Object.values(players).sort((a, b) => b.score - a.score));
    socket.emit('questionStatsUpdate', questionVotes);

    socket.on('joinGame', (name) => {
        players[socket.id] = { id: socket.id, name: name, score: 0 };
        pendingPlayerList = true; 
    });

    socket.on('hostUpdateState', (newState) => {
        gameState = { ...gameState, ...newState };
        if (gameState.status === 'active') {
            questionVotes = { A: 0, B: 0, C: 0, D: 0 };
            roundGains = {}; // Reset round gains for the new question
            pendingQuestionStats = true;
        }
        io.emit('gameStateUpdate', gameState);
    });

    socket.on('submitAnswer', (data) => {
        if (players[socket.id]) {
            let pts = parseInt(data.pointsEarned) || 0;
            let choice = data.choice || '';
            let isPoll = data.isPoll || false;

            if (!isPoll) {
                if (questionVotes[choice] !== undefined) {
                    questionVotes[choice]++;
                    pendingQuestionStats = true;
                }
                players[socket.id].score += pts;
                
                // Track points earned in this specific round
                roundGains[players[socket.id].name] = pts;

                pendingPlayerList = true;
            }
        }
    });

    socket.on('resetGame', () => {
        gameState = { status: 'waiting' };
        questionVotes = { A: 0, B: 0, C: 0, D: 0 };
        roundGains = {};
        for (let id in players) players[id].score = 0; 
        
        io.emit('gameStateUpdate', gameState);
        pendingPlayerList = true;
        pendingQuestionStats = true;
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            delete players[socket.id];
            pendingPlayerList = true;
        }
    });
});

// Broadcast player list along with the top round earner
setInterval(() => {
    if (pendingQuestionStats) {
        io.emit('questionStatsUpdate', questionVotes);
        pendingQuestionStats = false;
    }
    if (pendingPlayerList) {
        let sortedPlayers = Object.values(players).sort((a, b) => b.score - a.score);
        
        // Find who gained the most points in this round
        let fastestFinger = null;
        let maxPts = 0;
        for (let name in roundGains) {
            if (roundGains[name] > maxPts) {
                maxPts = roundGains[name];
                fastestFinger = name;
            }
        }

        io.emit('playerListUpdate', { players: sortedPlayers, fastestFinger: fastestFinger, roundPoints: maxPts });
        pendingPlayerList = false;
    }
}, 500); 

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Live Quiz server running on port ${PORT}`);
});