require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

// APIキーの改行削除
const rawApiKey = process.env.GEMINI_API_KEY || "";
const apiKey = rawApiKey.trim(); 

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
        return { village: "うどん", wolf: "そば", fox: "パスタ" };
    }

    // ★難易度・ジャンル設定
    let diffText = "一般向け";
    let themeText = "一般的な単語";
    
    if (difficulty === 'easy') {
        diffText = "子供向け";
        themeText = "簡単で具体的";
    } else if (difficulty === 'hard') {
        diffText = "大人向け";
        themeText = "抽象的・価値観";
    } else if (difficulty === 'sexy') {
        // ★セクシーモードの設定
        diffText = "成人向け(R-18)";
        themeText = "アダルトグッズ、下ネタ、夜の生活に関する単語（例：バイブ、ローター、TENGAなど）。露骨な表現を許可します。";
    }

    const prompt = `
        ワードウルフのお題を作成してください。
        ターゲット層: ${diffText}
        テーマ: ${themeText}
        
        【重要】以下のJSON形式のみを出力すること。マークダウン禁止。
        {
            "village": "...",
            "wolf": "...",
            "fox": "..."
        }
    `;

    try {
        console.log(`AIへリクエスト送信(Gemini 2.5 Flash / Mode: ${difficulty})...`);
        
        // ★Gemini 2.5 Flash に変更
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                // ★重要：セクシーワードを通すために安全フィルターを無効化する
                safetySettings: [
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Google API Error details: ${errorText}`);
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        // 候補がない場合（ブロックされた場合など）の対策
        if (!data.candidates || data.candidates.length === 0) {
            console.error("AIが回答を拒否しました（安全フィルター等）");
            return { village: "バナナ", wolf: "ナス", fox: "きゅうり" }; // 拒否された時のマイルドな下ネタ
        }

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
            // ★以前あった setTimeout (自動リセット) を削除しました
        }
    });

    // ★手動で「次のゲームへ」ボタンが押された時の処理
    socket.on('trigger_next_game', () => {
        players = []; 
        gameState = 'WAITING'; 
        votesReceived = 0;
        // 全員の画面をロビーに戻す
        io.emit('reset_game'); 
        io.emit('update_players', players);
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