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
const apiKey = process.env.GEMINI_API_KEY;
let model = null;
if (apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
}

app.use(express.static('public'));

let players = []; 
let gameState = 'WAITING'; 
let votesReceived = 0; // 投票した人数を数える変数

// Geminiにお題を生成してもらう関数
async function generateWords(difficulty) {
    if (!model) {
        return { village: "うどん", wolf: "そば", fox: "パスタ" };
    }

    // 難易度に応じた指示を作成
    let difficultyPrompt = "";
    if (difficulty === 'easy') {
        difficultyPrompt = "対象：小学生向け。身近な食べ物や動物など、具体的でイメージしやすい単語。";
    } else if (difficulty === 'hard') {
        difficultyPrompt = "対象：大人向け。抽象的な概念（例：愛と恋、才能と努力）や、価値観によって意見が分かれる難しい単語。";
    } else {
        difficultyPrompt = "対象：一般向け。誰でも知っている一般的な単語。";
    }

    const prompt = `
        ワードウルフのお題を考えてください。
        【難易度設定】
        ${difficultyPrompt}

        【出力条件】
        1. village_word: 多数派のワード
        2. wolf_word: village_wordと非常に似ているが、微妙に違うワード（対立概念など）
        3. fox_word: village_wordとは少し離れているが、会話には混ざれそうなワード
        
        JSON形式のみ出力してください: {"village": "...", "wolf": "...", "fox": "..."}
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (error) {
        console.error("Gemini Error:", error);
        return { village: "犬", wolf: "猫", fox: "ハムスター" }; // エラー時の避難用
    }
}

io.on('connection', (socket) => {
    console.log('接続:', socket.id);

    socket.on('join_game', (playerName) => {
        if (gameState !== 'WAITING') {
            socket.emit('error_msg', '現在ゲーム進行中です');
            return;
        }
        // 既に同じ名前がいないか簡易チェック（IDは別でも名前被りは混乱の元なので）
        // ※今回は簡易的にそのまま通します
        players.push({ id: socket.id, name: playerName, role: '', word: '', voteCount: 0 });
        io.emit('update_players', players);
    });

    // ゲーム開始（難易度を受け取る）
    socket.on('start_game', async (difficulty) => {
        if (players.length < 1) return; // テスト用
        
        gameState = 'PLAYING';
        votesReceived = 0; // 投票数リセット
        players.forEach(p => p.voteCount = 0); // 得票数リセット

        const words = await generateWords(difficulty);
        console.log(`お題(${difficulty}):`, words);

        const shuffled = [...players].sort(() => 0.5 - Math.random());
        
        shuffled.forEach((p, index) => {
            if (index === 0) {
                p.role = 'wolf'; p.word = words.wolf;
            } else if (index === 1 && players.length >= 4) { 
                // 4人以上の時だけ狐を入れる（人数が少ないと狐がすぐバレるため）
                // もし3人でも狐を入れたければここを調整
                p.role = 'fox'; p.word = words.fox;
            } else {
                p.role = 'villager'; p.word = words.village;
            }
            io.to(p.id).emit('game_started', { word: p.word });
        });
        players = shuffled;
    });

    socket.on('start_voting', () => {
        gameState = 'VOTING';
        io.emit('show_voting_screen', players);
    });

    // 投票受付
    socket.on('submit_vote', (targetId) => {
        const target = players.find(p => p.id === targetId);
        if (target) {
            target.voteCount++;
            votesReceived++;
        }

        // 全員（または生きている人全員）が投票したら結果発表
        if (votesReceived >= players.length) {
            gameState = 'RESULT';
            io.emit('game_result', players);
            
            // 15秒後にロビーに戻す
            setTimeout(() => {
                players.forEach(p => { p.role=''; p.word=''; p.voteCount=0; });
                votesReceived = 0;
                gameState = 'WAITING';
                io.emit('reset_game');
                io.emit('update_players', players);
            }, 15000);
        }
    });

    // 強制リセット（バグった時用）
    socket.on('force_reset', () => {
        gameState = 'WAITING';
        players = [];
        votesReceived = 0;
        io.emit('reset_game');
        io.emit('update_players', players);
    });

    socket.on('disconnect', () => {
        players = players.filter(p => p.id !== socket.id);
        io.emit('update_players', players);
        // 投票中に誰か落ちると進まなくなるので、人数チェックを入れるべきですが、
        // 今回は簡易版としてそのままにします
    });
});

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});