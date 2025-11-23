require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

const rawApiKey = process.env.GEMINI_API_KEY || "";
const apiKey = rawApiKey.trim(); 

if(apiKey) console.log(`API Key set: ${apiKey.substring(0,3)}...`);

app.use(express.static('public'));

let players = []; 
let gameState = 'WAITING'; 
let votesReceived = 0; 

// 安全なお題生成
async function generateWords(difficulty) {
    const fallback = { village: "おにぎり", wolf: "サンドイッチ", fox: "ハンバーガー" };
    if (!apiKey) return fallback;

    let diffText = "一般向け";
    let themeText = "一般的な単語";
    if (difficulty === 'easy') { diffText = "子供向け"; themeText = "簡単で具体的"; }
    else if (difficulty === 'hard') { diffText = "大人向け"; themeText = "抽象的"; }
    else if (difficulty === 'sexy') { diffText = "R-18"; themeText = "アダルトグッズ、下ネタ"; }

    const prompt = `
        ワードウルフのお題を作成。
        ターゲット: ${diffText}, テーマ: ${themeText}
        JSON形式のみ出力(マークダウン禁止)。キー名は必ず小文字(village, wolf, fox)。
        { "village":"...", "wolf":"...", "fox":"..." }
    `;

    try {
        console.log(`AIリクエスト(Mode: ${difficulty})...`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                safetySettings: [
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
            })
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        const data = await response.json();
        if (!data.candidates || data.candidates.length === 0) return fallback;

        let text = data.candidates[0].content.parts[0].text;
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const json = JSON.parse(text);

        const v = json.village || json.Village || json.Village_word;
        const w = json.wolf || json.Wolf || json.Wolf_word;
        const f = json.fox || json.Fox || json.Fox_word;

        if (!v || !w || !f) return fallback;
        return { village: v, wolf: w, fox: f };

    } catch (error) {
        console.error("Generate Error:", error);
        return fallback;
    }
}

function calculateVoteResult() {
    const sorted = [...players].sort((a, b) => b.voteCount - a.voteCount);
    const maxVotes = sorted[0].voteCount;
    const candidates = sorted.filter(p => p.voteCount === maxVotes);
    return candidates[Math.floor(Math.random() * candidates.length)];
}

io.on('connection', (socket) => {
    socket.on('join_game', (playerName) => {
        const existing = players.find(p => p.name === playerName);
        
        // 新規プレイヤーオブジェクト（actionStatusを追加）
        const newPlayer = { 
            id: socket.id, 
            name: playerName, 
            role: '', 
            word: '', 
            voteCount: 0,
            // ★追加：議論状況のステータス
            status: { question: false, answer: false }
        };

        if (gameState === 'WAITING') {
            if (existing) { existing.id = socket.id; }
            else { players.push(newPlayer); }
            io.emit('update_players', players);
        } else {
            if (existing) {
                existing.id = socket.id;
                socket.emit('game_started', { word: existing.word });
                // 途中参加時も現在の状況を送る
                socket.emit('update_game_status', players); 
                if(gameState.startsWith('VOTING')) socket.emit('show_voting_screen', { players, phase: gameState });
                if(gameState === 'RESULT') socket.emit('game_result', { players, winner: 'unknown' });
                io.emit('update_players', players);
            } else {
                socket.emit('error_msg', 'ゲーム進行中です');
            }
        }
    });

    socket.on('start_game', async (diff) => {
        if (players.length < 3) return;
        io.emit('loading_start');

        gameState = 'PLAYING';
        votesReceived = 0;
        
        // 初期化（ステータスもリセット）
        players.forEach(p => { 
            p.voteCount = 0;
            p.status = { question: false, answer: false }; // リセット
        });

        const words = await generateWords(diff);
        const shuffled = [...players].sort(() => 0.5 - Math.random());
        
        shuffled.forEach((p, i) => {
            if (i === 0) { p.role = 'wolf'; p.word = words.wolf; }
            else if (i === 1) { p.role = 'fox'; p.word = words.fox; }
            else { p.role = 'villager'; p.word = words.village; }
            if (!p.word) p.word = "エラー";
            
            io.to(p.id).emit('game_started', { word: p.word });
        });
        players = shuffled;
        
        // ★ゲーム開始時に全員のステータスリストを配信
        io.emit('update_game_status', players);
    });

    // ★追加：質問・回答ボタンが押された時の処理
    socket.on('toggle_action', ({ targetId, type }) => {
        const target = players.find(p => p.id === targetId);
        if (target) {
            // true/false を反転させる
            if (type === 'question') target.status.question = !target.status.question;
            if (type === 'answer') target.status.answer = !target.status.answer;
            
            // 全員に新しい状態を配信
            io.emit('update_game_status', players);
        }
    });

    socket.on('start_voting', () => {
        gameState = 'VOTING_FOX';
        io.emit('show_voting_screen', { players, phase: 'FOX' });
    });

    socket.on('submit_vote', (targetId) => {
        const t = players.find(p => p.id === targetId);
        if(t) { t.voteCount++; votesReceived++; }

        if(votesReceived >= players.length) {
            const victim = calculateVoteResult();
            
            if (gameState === 'VOTING_FOX') {
                if (victim.role === 'fox') {
                    io.emit('fox_caught', { victimName: victim.name });
                    setTimeout(() => {
                        gameState = 'VOTING_WOLF';
                        votesReceived = 0;
                        players.forEach(p => p.voteCount = 0);
                        io.emit('show_voting_screen', { players, phase: 'WOLF' });
                    }, 4000); 
                } else {
                    gameState = 'RESULT';
                    io.emit('game_result', { players, winner: 'FOX', victimName: victim.name });
                }
            } 
            else if (gameState === 'VOTING_WOLF') {
                gameState = 'RESULT';
                if (victim.role === 'wolf') {
                    io.emit('game_result', { players, winner: 'VILLAGE', victimName: victim.name });
                } else {
                    io.emit('game_result', { players, winner: 'WOLF', victimName: victim.name });
                }
            }
        }
    });

    socket.on('trigger_next_game', () => {
        gameState = 'WAITING';
        votesReceived = 0;
        players.forEach(p => { 
            p.role=''; p.word=''; p.voteCount=0;
            p.status = { question: false, answer: false }; // ステータスリセット
        });
        io.emit('reset_game'); 
        io.emit('update_players', players);
    });

    socket.on('force_reset', () => {
        players = []; gameState = 'WAITING'; votesReceived = 0;
        io.emit('reset_to_login'); 
    });

    socket.on('disconnect', () => {
        if (gameState === 'WAITING') {
            players = players.filter(p => p.id !== socket.id);
            io.emit('update_players', players);
        }
    });
});

server.listen(port, () => console.log(`Server running on port ${port}`));