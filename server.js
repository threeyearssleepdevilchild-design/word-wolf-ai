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

if (apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    // ★ここを変更：JSONモードを強制する設定を追加
    model = genAI.getGenerativeModel({ 
        model: "gemini-pro",
        generationConfig: { responseMimeType: "application/json" }
    });
} else {
    console.error("★重要★ APIキーが設定されていません！RenderのEnvironment Variablesを確認してください。");
}

app.use(express.static('public'));

let players = []; 
let gameState = 'WAITING'; 
let votesReceived = 0; 

async function generateWords(difficulty) {
    // APIキーがない場合（うどんループ）
    if (!model) {
        console.log("APIキーがないため、固定ワード（うどん）を使います");
        return { village: "うどん", wolf: "そば", fox: "パスタ" };
    }

    let difficultyPrompt = "対象：一般向け。誰でも知っている一般的な単語。";
    if (difficulty === 'easy') difficultyPrompt = "対象：小学生向け。具体的でイメージしやすい単語。";
    if (difficulty === 'hard') difficultyPrompt = "対象：大人向け。抽象的な概念や価値観で意見が分かれる単語。";

    const prompt = `
        ワードウルフのお題を考えてください。
        難易度設定：${difficultyPrompt}
        
        出力フォーマット（JSON）:
        {
            "village": "多数派の単語",
            "wolf": "少数派の単語（villageと似ている）",
            "fox": "第三勢力の単語（villageと離れているが会話可能）"
        }
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        // JSONとして解析
        const json = JSON.parse(text);
        return json;

    } catch (error) {
        // エラーが出た場合（犬ループ）
        console.error("Gemini生成エラー詳細:", error); 
        return { village: "犬", wolf: "猫", fox: "たぬき" };
    }
}

io.on('connection', (socket) => {
    console.log('接続:', socket.id);

    socket.on('join_game', (playerName) => {
        if (gameState !== 'WAITING') {
            const existingPlayer = players.find(p => p.name === playerName);
            if (existingPlayer) {
                existingPlayer.id = socket.id;
                socket.emit('game_started', { word: existingPlayer.word });
                if (gameState === 'VOTING') socket.emit('show_voting_screen', players);
                if (gameState === 'RESULT') socket.emit('game_result', players);
                io.emit('update_players', players);
                return;
            } else {
                socket.emit('error_msg', '現在ゲーム進行中です');
                return;
            }
        }

        if (players.find(p => p.name === playerName)) {
            socket.emit('error_msg', 'その名前は既に使われています');
            return;
        }

        players.push({ id: socket.id, name: playerName, role: '', word: '', voteCount: 0 });
        io.emit('update_players', players);
    });

    socket.on('start_game', async (difficulty) => {
        if (players.length < 1) return;
        
        gameState = 'PLAYING';
        votesReceived = 0;
        players.forEach(p => p.voteCount = 0);

        // 難易度を渡して生成
        const words = await generateWords(difficulty);
        console.log("生成されたお題:", words); // Renderのログで確認用
        
        const shuffled = [...players].sort(() => 0.5 - Math.random());
        shuffled.forEach((p, index) => {
            if (index === 0) {
                p.role = 'wolf'; p.word = words.wolf;
            } else if (index === 1 && players.length >= 4) { 
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

    socket.on('submit_vote', (targetId) => {
        const target = players.find(p => p.id === targetId);
        if (target) {
            target.voteCount++;
            votesReceived++;
        }

        if (votesReceived >= players.length) {
            gameState = 'RESULT';
            io.emit('game_result', players);
            setTimeout(() => {
                resetGameVars();
                io.emit('reset_game');
                io.emit('update_players', players);
            }, 15000);
        }
    });

    socket.on('force_reset', () => {
        resetGameVars();
        players = []; 
        io.emit('reset_game');
        io.emit('update_players', players); 
    });

    socket.on('disconnect', () => {
        if (gameState === 'WAITING') {
            players = players.filter(p => p.id !== socket.id);
            io.emit('update_players', players);
        }
    });

    function resetGameVars() {
        players.forEach(p => { p.role=''; p.word=''; p.voteCount=0; });
        votesReceived = 0;
        gameState = 'WAITING';
    }
});

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});