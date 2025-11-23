require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

// Gemini API設定
// キーが設定されていない場合のエラー回避
const apiKey = process.env.GEMINI_API_KEY;
let model = null;
if (apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
}

app.use(express.static('public'));

let players = []; 
let gameState = 'WAITING'; 

// Geminiにお題を生成してもらう関数
async function generateWords() {
    if (!model) {
        console.log("APIキーがないため、固定のお題を使います");
        return { village: "りんご", wolf: "なし", fox: "トマト" };
    }

    const prompt = `
        ワードウルフのお題を考えて。
        1. village_word: 一般的な単語
        2. wolf_word: villageと似ているが違う単語
        3. fox_word: villageと少し離れているが会話に混ざれそうな単語
        出力はJSON形式のみ: {"village": "...", "wolf": "...", "fox": "..."}
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();
        // 余計な記号を消す処理
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (error) {
        console.error("Gemini Error:", error);
        return { village: "うどん", wolf: "そば", fox: "パスタ" };
    }
}

io.on('connection', (socket) => {
    console.log('誰かが接続しました:', socket.id);

    socket.on('join_game', (playerName) => {
        players.push({ id: socket.id, name: playerName, role: '', word: '', voteCount: 0 });
        io.emit('update_players', players);
    });

    socket.on('start_game', async () => {
        // 本番は3人以上必要ですが、テスト用に1人でも動くようにしておきます
        if (players.length < 1) return; 
        
        gameState = 'PLAYING';
        const words = await generateWords();
        console.log("今回のお題:", words);

        // 役職をシャッフルして割り当て
        const shuffled = [...players].sort(() => 0.5 - Math.random());
        
        // 人数に合わせて役職を配るロジック（簡易版）
        // 1人目: 狼, 2人目: 狐, 3人目以降: 村人
        shuffled.forEach((p, index) => {
            if (index === 0) {
                p.role = 'wolf'; p.word = words.wolf;
            } else if (index === 1) {
                p.role = 'fox'; p.word = words.fox;
            } else {
                p.role = 'villager'; p.word = words.village;
            }
            // 個別に通知
            io.to(p.id).emit('game_started', { word: p.word });
        });
        
        players = shuffled; // 順番を更新
    });

    socket.on('start_voting', () => {
        gameState = 'VOTING';
        io.emit('show_voting_screen', players);
    });

    socket.on('submit_vote', (targetId) => {
        const target = players.find(p => p.id === targetId);
        if (target) target.voteCount++;
    });

    socket.on('show_result', () => {
        gameState = 'RESULT';
        io.emit('game_result', players);
        // リセット処理
        setTimeout(() => {
            players.forEach(p => { p.role=''; p.word=''; p.voteCount=0; });
            gameState = 'WAITING';
            io.emit('reset_game');
            io.emit('update_players', players);
        }, 10000);
    });

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('update_players', players);
    });
});

server.listen(port, () => {
    console.log(`準備OK！ブラウザで http://localhost:${port} を開いてください`);
});