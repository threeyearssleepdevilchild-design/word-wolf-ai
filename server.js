require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

const apiKey = process.env.GEMINI_API_KEY;
let model = null;

// ★ここを修正：最も性能が良い最新モデルを指定し、余計な設定は削除
if (apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
}

app.use(express.static('public'));

let players = []; 
let gameState = 'WAITING'; 
let votesReceived = 0; 

async function generateWords(difficulty) {
    if (!model) {
        console.log("APIキー未設定");
        return { village: "うどん", wolf: "そば", fox: "パスタ" };
    }

    let difficultyPrompt = "一般向け";
    if (difficulty === 'easy') difficultyPrompt = "小学生向け。簡単で具体的な単語";
    if (difficulty === 'hard') difficultyPrompt = "大人向け。抽象的な単語";

    // プロンプトで強くJSONを要求する
    const prompt = `
        ワードウルフのお題を作成してください。
        難易度: ${difficultyPrompt}
        
        以下のJSON形式だけで返答してください。余計な解説は不要です。
        {
            "village": "...",
            "wolf": "...",
            "fox": "..."
        }
    `;

    try {
        console.log("AIへリクエスト中...");
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();
        
        console.log("AIの返答(生データ):", text);

        // ★ここがポイント：JSON以外の余計な文字（```json や ```）をプログラムで削除する
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        return JSON.parse(text);

    } catch (error) {
        console.error("生成エラー:", error); 
        return { village: "犬", wolf: "猫", fox: "たぬき" };
    }
}

io.on('connection', (socket) => {
    socket.on('join_game', (playerName) => {
        if (gameState !== 'WAITING') {
            const existing = players.find(p => p.name === playerName);
            if (existing) {
                existing.id = socket.id;
                socket.emit('game_started', { word: existing.word });
                if(gameState === 'VOTING') socket.emit('show_voting_screen', players);
                if(gameState === 'RESULT') socket.emit('game_result', players);
                io.emit('update_players', players);
                return;
            }
            socket.emit('error_msg', 'ゲーム進行中です');
            return;
        }
        if (players.find(p => p.name === playerName)) {
            socket.emit('error_msg', '名前が重複しています');
            return;
        }
        players.push({ id: socket.id, name: playerName, role: '', word: '', voteCount: 0 });
        io.emit('update_players', players);
    });

    socket.on('start_game', async (diff) => {
        if (players.length < 1) return;
        gameState = 'PLAYING';
        votesReceived = 0;
        players.forEach(p => p.voteCount = 0);

        const words = await generateWords(diff);
        
        const shuffled = [...players].sort(() => 0.5 - Math.random());
        shuffled.forEach((p, i) => {
            if (i === 0) { p.role = 'wolf'; p.word = words.wolf; }
            else if (i === 1 && players.length >= 4) { p.role = 'fox'; p.word = words.fox; }
            else { p.role = 'villager'; p.word = words.village; }
            io.to(p.id).emit('game_started', { word: p.word });
        });
        players = shuffled;
    });

    socket.on('start_voting', () => { gameState = 'VOTING'; io.emit('show_voting_screen', players); });
    
    socket.on('submit_vote', (targetId) => {
        const t = players.find(p => p.id === targetId);
        if(t) { t.voteCount++; votesReceived++; }
        if(votesReceived >= players.length) {
            gameState = 'RESULT';
            io.emit('game_result', players);
            setTimeout(() => {
                players.forEach(p => { p.role=''; p.word=''; p.voteCount=0; });
                votesReceived = 0; gameState = 'WAITING';
                io.emit('reset_game'); io.emit('update_players', players);
            }, 15000);
        }
    });

    socket.on('force_reset', () => {
        players = []; gameState = 'WAITING'; votesReceived = 0;
        io.emit('reset_game'); io.emit('update_players', players);
    });

    socket.on('disconnect', () => {
        if (gameState === 'WAITING') {
            players = players.filter(p => p.id !== socket.id);
            io.emit('update_players', players);
        }
    });
});

server.listen(port, () => console.log(`Server running on port ${port}`));