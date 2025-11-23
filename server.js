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
let gameState = 'WAITING'; // WAITING, PLAYING, VOTING_FOX, VOTING_WOLF, RESULT
let votesReceived = 0; 

// お題生成（セクシー対応版）
async function generateWords(difficulty) {
    if (!apiKey) return { village: "うどん", wolf: "そば", fox: "パスタ" };

    let diffText = "一般向け";
    let themeText = "一般的な単語";
    if (difficulty === 'easy') { diffText = "子供向け"; themeText = "簡単で具体的"; }
    else if (difficulty === 'hard') { diffText = "大人向け"; themeText = "抽象的"; }
    else if (difficulty === 'sexy') { diffText = "R-18"; themeText = "アダルトグッズ、下ネタ、SEXネタ、フェチ"; }

    const prompt = `
        ワードウルフのお題を作成。
        ターゲット: ${diffText}, テーマ: ${themeText}
        JSON形式のみ出力(マークダウン禁止): {"village":"...","wolf":"...","fox":"..."}
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

        if (!response.ok) throw new Error(response.status);
        const data = await response.json();
        if (!data.candidates || data.candidates.length === 0) return { village: "バナナ", wolf: "ナス", fox: "きゅうり" };

        let text = data.candidates[0].content.parts[0].text;
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (error) {
        console.error("AI Error:", error);
        return { village: "犬", wolf: "猫", fox: "たぬき" };
    }
}

// 投票結果を集計する関数
function calculateVoteResult() {
    // 得票数が多い順にソート
    const sorted = [...players].sort((a, b) => b.voteCount - a.voteCount);
    const maxVotes = sorted[0].voteCount;
    // 最多得票者が複数の場合の処理（今回はランダムで1人選ぶ簡易実装）
    const candidates = sorted.filter(p => p.voteCount === maxVotes);
    const victim = candidates[Math.floor(Math.random() * candidates.length)];
    return victim;
}

io.on('connection', (socket) => {
    socket.on('join_game', (playerName) => {
        // ★修正：ロビー待機中なら、既存プレイヤーの復帰ではなく新規として扱う(名前被りチェックは必要)
        // ただし、既にリストにいてIDが違う（再接続）場合はID更新
        const existing = players.find(p => p.name === playerName);
        
        if (gameState === 'WAITING') {
            if (existing) {
                // ロビーで同じ名前は弾く（あるいは上書き）
                // 簡易的に上書きします
                existing.id = socket.id;
            } else {
                players.push({ id: socket.id, name: playerName, role: '', word: '', voteCount: 0 });
            }
            io.emit('update_players', players);
        } else {
            // ゲーム進行中の復帰処理
            if (existing) {
                existing.id = socket.id;
                socket.emit('game_started', { word: existing.word });
                if(gameState.startsWith('VOTING')) socket.emit('show_voting_screen', { players, phase: gameState });
                if(gameState === 'RESULT') socket.emit('game_result', { players, winner: 'unknown' }); // 結果画面復帰は簡易
                io.emit('update_players', players);
            } else {
                socket.emit('error_msg', 'ゲーム進行中です');
            }
        }
    });

    socket.on('start_game', async (diff) => {
        if (players.length < 3) return; // 狐ルールは3人以上必須
        gameState = 'PLAYING';
        votesReceived = 0;
        players.forEach(p => p.voteCount = 0);

        const words = await generateWords(diff);
        const shuffled = [...players].sort(() => 0.5 - Math.random());
        
        // 配役：1人目狼、2人目狐、残り村人
        shuffled.forEach((p, i) => {
            if (i === 0) { p.role = 'wolf'; p.word = words.wolf; }
            else if (i === 1) { p.role = 'fox'; p.word = words.fox; }
            else { p.role = 'villager'; p.word = words.village; }
            io.to(p.id).emit('game_started', { word: p.word });
        });
        players = shuffled;
    });

    // 最初の投票（狐探し）開始
    socket.on('start_voting', () => {
        gameState = 'VOTING_FOX';
        io.emit('show_voting_screen', { players, phase: 'FOX' });
    });

    socket.on('submit_vote', (targetId) => {
        const t = players.find(p => p.id === targetId);
        if(t) { t.voteCount++; votesReceived++; }

        // 全員投票完了
        if(votesReceived >= players.length) {
            const victim = calculateVoteResult();
            
            // --- 第1フェーズ：狐投票の結果判定 ---
            if (gameState === 'VOTING_FOX') {
                if (victim.role === 'fox') {
                    // 狐が吊られた -> 狼投票へ続く
                    io.emit('fox_caught', { victimName: victim.name });
                    
                    // 投票リセットして第2ラウンドへ
                    setTimeout(() => {
                        gameState = 'VOTING_WOLF';
                        votesReceived = 0;
                        players.forEach(p => p.voteCount = 0);
                        io.emit('show_voting_screen', { players, phase: 'WOLF' });
                    }, 3000); // 3秒後に次の投票へ
                    
                } else {
                    // 狐以外が吊られた -> 狐の勝利（即終了）
                    gameState = 'RESULT';
                    io.emit('game_result', { players, winner: 'FOX', victimName: victim.name });
                }
            } 
            // --- 第2フェーズ：狼投票の結果判定 ---
            else if (gameState === 'VOTING_WOLF') {
                gameState = 'RESULT';
                if (victim.role === 'wolf') {
                    // 狼が吊られた -> 村人の勝利
                    io.emit('game_result', { players, winner: 'VILLAGE', victimName: victim.name });
                } else {
                    // 狼以外が吊られた -> 狼の勝利
                    io.emit('game_result', { players, winner: 'WOLF', victimName: victim.name });
                }
            }
        }
    });

    // ★重要：次のゲームへ（ロビーに戻るが名前は消さない）
    socket.on('trigger_next_game', () => {
        gameState = 'WAITING';
        votesReceived = 0;
        // プレイヤー情報は残すが、ゲームデータは初期化
        players.forEach(p => { p.role=''; p.word=''; p.voteCount=0; });
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