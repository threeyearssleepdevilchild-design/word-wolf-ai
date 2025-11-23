require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
// 念のため古い書き方でも読み込めるように調整
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

const apiKey = process.env.GEMINI_API_KEY;
let model = null;

// ★デバッグ: キーの確認（最初の3文字だけログに出す）
if(apiKey) {
    console.log(`API Key set: ${apiKey.substring(0,3)}...`);
} else {
    console.error("!!! API Key is MISSING !!!");
}

if (apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    // ★変更点1: モデルを 'gemini-pro' に変更（古いライブラリでも動く）
    model = genAI.getGenerativeModel({ 
        model: "gemini-pro",
        // ★変更点2: 安全フィルターを無効化（ブロック防止）
        safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ]
    });
}

app.use(express.static('public'));

let players = []; 
let gameState = 'WAITING'; 
let votesReceived = 0; 

async function generateWords(difficulty) {
    if (!model) {
        console.log("モデル未初期化のため固定ワードを使用");
        return { village: "うどん", wolf: "そば", fox: "パスタ" };
    }

    let diffText = "一般向け";
    if (difficulty === 'easy') diffText = "子供向け。簡単で具体的な単語";
    if (difficulty === 'hard') diffText = "大人向け。抽象的な単語";

    const prompt = `
        ワードウルフのお題を作成してください。
        難易度: ${diffText}
        
        【重要】以下のJSON形式のみを出力すること。余計なマークダウンや解説は禁止。
        {
            "village": "...",
            "wolf": "...",
            "fox": "..."
        }
    `;

    try {
        console.log("AIへリクエスト送信...");
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();
        
        console.log("AI生返答:", text); // 成功したらログに出る

        // 掃除（```json などを消す）
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        return JSON.parse(text);

    } catch (error) {
        // ★エラー理由を詳細にログに出す
        console.error("============ AI生成エラー詳細 ============");
        console.error(error);
        console.error("========================================");
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