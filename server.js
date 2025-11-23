require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

// ★修正点1: APIキーの「改行」や「空白」を自動で削除する
const rawApiKey = process.env.GEMINI_API_KEY || "";
const apiKey = rawApiKey.trim(); 

// デバッグ: キーの状態確認（改行がないかチェック）
if(apiKey) {
    console.log(`API Key is set (Length: ${apiKey.length}): ${apiKey.substring(0,3)}...`);
} else {
    console.error("!!! API Key is MISSING !!!");
}

app.use(express.static('public'));

let players = []; 
let gameState = 'WAITING'; 
let votesReceived = 0; 

async function generateWords(difficulty) {
    if (!apiKey) {
        console.log("APIキーがないため固定ワードを使用");
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
        console.log("AIへリクエスト送信(Direct Fetch)...");
        
        // ★修正点2: URLは gemini-1.5-flash で固定（これが一番速くて安いため）
        // もし将来 gemini-2.0 などが出たらここを変えるだけでOKです
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        // ★修正点3: エラーなら、その詳細をログに出す
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Google API Error details: ${errorText}`);
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        // 返答を取り出す
        let text = data.candidates[0].content.parts[0].text;
        console.log("AI生返答:", text);

        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);

    } catch (error) {
        console.error("============ AI生成エラー詳細 ============");
        console.error(error);
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