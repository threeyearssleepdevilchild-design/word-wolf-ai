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
    model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
}

app.use(express.static('public'));

let players = []; 
let gameState = 'WAITING'; 
let votesReceived = 0; 

async function generateWords(difficulty) {
    if (!model) return { village: "うどん", wolf: "そば", fox: "パスタ" };

    let difficultyPrompt = "対象：一般向け。誰でも知っている一般的な単語。";
    if (difficulty === 'easy') difficultyPrompt = "対象：小学生向け。具体的でイメージしやすい単語。";
    if (difficulty === 'hard') difficultyPrompt = "対象：大人向け。抽象的な概念や価値観で意見が分かれる単語。";

    const prompt = `
        ワードウルフのお題を考えてください。
        【難易度】${difficultyPrompt}
        【条件】
        1. village_word: 多数派
        2. wolf_word: 少数派（villageと似ているが違う）
        3. fox_word: 第三勢力（villageと少し離れているが会話成立する）
        JSONのみ出力: {"village": "...", "wolf": "...", "fox": "..."}
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (error) {
        console.error("Gemini Error:", error);
        return { village: "犬", wolf: "猫", fox: "たぬき" };
    }
}

io.on('connection', (socket) => {
    console.log('接続:', socket.id);

    socket.on('join_game', (playerName) => {
        // ★修正ポイント1: 進行中でも「同じ名前」なら復帰させる
        if (gameState !== 'WAITING') {
            const existingPlayer = players.find(p => p.name === playerName);
            
            if (existingPlayer) {
                // 復帰処理
                existingPlayer.id = socket.id; // IDを新しい接続に更新
                socket.emit('game_started', { word: existingPlayer.word }); // お題を再送
                
                // 状況に合わせて画面を戻す
                if (gameState === 'VOTING') {
                    socket.emit('show_voting_screen', players);
                } else if (gameState === 'RESULT') {
                    socket.emit('game_result', players);
                }
                
                // 他の人に「〇〇が戻ってきた」と伝える（リスト更新）
                io.emit('update_players', players);
                return;
            } else {
                socket.emit('error_msg', '現在ゲーム進行中です');
                return;
            }
        }

        // 通常の参加処理
        // 同じ名前が既にいたら弾く（重複防止）
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

        const words = await generateWords(difficulty);
        
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

    // ★修正ポイント2: 強制リセット機能
    socket.on('force_reset', () => {
        console.log('強制リセット実行');
        resetGameVars();
        // プレイヤーリストもクリアするか、残すか。
        // 「バグって誰もいない判定になった」場合のために、一旦全員解散させます。
        players = []; 
        io.emit('reset_game'); // 全員ロビー画面へ
        io.emit('update_players', players); 
    });

    socket.on('disconnect', () => {
        // ★修正ポイント3: ゲーム中はリストから消さない（復帰できるようにするため）
        if (gameState === 'WAITING') {
            players = players.filter(p => p.id !== socket.id);
            io.emit('update_players', players);
        } else {
            // ゲーム中は「切断中」扱いにするだけでリストには残す
            // (今回は簡易実装なので何もしない＝リストに残る)
            console.log('ゲーム中に切断されましたが、復帰待ちのためリストに残します');
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