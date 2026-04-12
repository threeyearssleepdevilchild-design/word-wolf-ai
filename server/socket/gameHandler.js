const { generateTopics, generateQuestions } = require('../services/geminiService');

// ルーム管理
const rooms = new Map();

// プレイヤーセッション管理（sessionId -> { roomId, playerName, playerId }）
const playerSessions = new Map();

/**
 * ゲームハンドラー
 * @param {Server} io Socket.io サーバー
 */
function gameHandler(io) {
    io.on('connection', (socket) => {
        console.log(`✅ 接続: ${socket.id}`);

        // ルーム作成
        socket.on('createRoom', async ({ playerName, wolfCount, wordMode, sessionId }) => {
            const roomId = generateRoomId();
            const room = {
                id: roomId,
                host: socket.id,
                players: [{
                    id: socket.id,
                    name: playerName,
                    sessionId: sessionId || socket.id,
                    role: null,
                    word: null,
                    hasAsked: false,
                    hasAnswered: false,
                    isReady: false,
                    isConnected: true
                }],
                wolfCount: wolfCount || 1,
                wordMode: wordMode || 'adult',
                topics: null,
                gameState: 'waiting', // waiting, playing, voting-fox, voting-wolf, result
                timer: null,
                timerSeconds: 0,
                noTimeLimit: false,
                votes: {
                    fox: {},
                    wolf: {}
                }
            };

            rooms.set(roomId, room);
            socket.join(roomId);
            socket.roomId = roomId;
            socket.sessionId = sessionId || socket.id;

            // セッション保存
            if (sessionId) {
                playerSessions.set(sessionId, { roomId, playerName, playerId: socket.id });
            }

            socket.emit('roomCreated', { roomId, players: room.players, sessionId: socket.sessionId });
            console.log(`🏠 ルーム作成: ${roomId}`);
        });

        // セッション復旧（再接続）
        socket.on('rejoinRoom', ({ roomId, sessionId, playerName }) => {
            const room = rooms.get(roomId);

            if (!room) {
                socket.emit('rejoinFailed', { message: 'ルームが見つかりません。ルームが終了した可能性があります。' });
                return;
            }

            // セッションIDで既存プレイヤーを検索
            let existingPlayer = room.players.find(p => p.sessionId === sessionId);

            // 名前でも検索（セッションIDがない場合のフォールバック）
            if (!existingPlayer) {
                existingPlayer = room.players.find(p => p.name === playerName && !p.isConnected);
            }

            if (existingPlayer) {
                // 既存プレイヤーのIDを更新（再接続）
                const oldId = existingPlayer.id;
                existingPlayer.id = socket.id;
                existingPlayer.isConnected = true;

                // 投票データのIDも更新
                if (room.votes.fox[oldId]) {
                    room.votes.fox[socket.id] = room.votes.fox[oldId];
                    delete room.votes.fox[oldId];
                }
                if (room.votes.wolf[oldId]) {
                    room.votes.wolf[socket.id] = room.votes.wolf[oldId];
                    delete room.votes.wolf[oldId];
                }

                // ホストだった場合も更新
                if (room.host === oldId) {
                    room.host = socket.id;
                }

                socket.join(roomId);
                socket.roomId = roomId;
                socket.sessionId = sessionId;

                // セッション更新
                playerSessions.set(sessionId, { roomId, playerName, playerId: socket.id });

                // 現在のゲーム状態を送信
                socket.emit('rejoinSuccess', {
                    roomId,
                    gameState: room.gameState,
                    role: existingPlayer.role,
                    word: existingPlayer.word,
                    timerSeconds: room.timerSeconds,
                    players: room.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        hasAsked: p.hasAsked,
                        hasAnswered: p.hasAnswered,
                        isConnected: p.isConnected
                    })),
                    topics: room.gameState === 'result' ? room.topics : null,
                    votes: room.gameState === 'result' ? room.votes : null
                });

                // 他のプレイヤーに通知
                socket.to(roomId).emit('playerReconnected', {
                    playerId: socket.id,
                    playerName: existingPlayer.name,
                    players: room.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        hasAsked: p.hasAsked,
                        hasAnswered: p.hasAnswered,
                        isConnected: p.isConnected
                    }))
                });

                console.log(`🔄 再接続: ${playerName} がルーム ${roomId} に復帰`);
            } else {
                // 新規参加として処理
                if (room.gameState !== 'waiting') {
                    socket.emit('rejoinFailed', { message: 'ゲーム中のため参加できません。' });
                    return;
                }

                if (room.players.length >= 10) {
                    socket.emit('rejoinFailed', { message: 'ルームが満員です。' });
                    return;
                }

                // 新規プレイヤーとして追加
                room.players.push({
                    id: socket.id,
                    name: playerName,
                    sessionId: sessionId,
                    role: null,
                    word: null,
                    hasAsked: false,
                    hasAnswered: false,
                    isReady: false,
                    isConnected: true
                });

                socket.join(roomId);
                socket.roomId = roomId;
                socket.sessionId = sessionId;

                playerSessions.set(sessionId, { roomId, playerName, playerId: socket.id });

                socket.emit('rejoinSuccess', {
                    roomId,
                    gameState: room.gameState,
                    role: null,
                    word: null,
                    timerSeconds: room.timerSeconds,
                    players: room.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        hasAsked: p.hasAsked,
                        hasAnswered: p.hasAnswered,
                        isConnected: p.isConnected
                    }))
                });

                io.to(roomId).emit('playerJoined', { players: room.players });
                console.log(`👤 ${playerName} がルーム ${roomId} に参加（再接続試行からの新規参加）`);
            }
        });

        // ルーム参加
        socket.on('joinRoom', ({ roomId, playerName, sessionId }) => {
            const room = rooms.get(roomId);

            if (!room) {
                socket.emit('error', { message: 'ルームが見つかりません' });
                return;
            }

            if (room.players.length >= 10) {
                socket.emit('error', { message: 'ルームが満員です' });
                return;
            }

            if (room.gameState !== 'waiting') {
                socket.emit('error', { message: 'ゲーム中は参加できません' });
                return;
            }

            room.players.push({
                id: socket.id,
                name: playerName,
                sessionId: sessionId || socket.id,
                role: null,
                word: null,
                hasAsked: false,
                hasAnswered: false,
                isReady: false,
                isConnected: true
            });

            socket.join(roomId);
            socket.roomId = roomId;
            socket.sessionId = sessionId || socket.id;

            // セッション保存
            if (sessionId) {
                playerSessions.set(sessionId, { roomId, playerName, playerId: socket.id });
            }

            io.to(roomId).emit('playerJoined', { players: room.players });
            console.log(`👤 ${playerName} がルーム ${roomId} に参加`);
        });

        // ゲーム開始（誰でも開始可能）
        socket.on('startGame', async ({ secondsPerPlayer } = {}) => {
            const room = rooms.get(socket.roomId);
            if (!room) return;

            if (room.players.length < 4) {
                socket.emit('error', { message: '4人以上必要です' });
                return;
            }

            // お題生成
            room.topics = await generateTopics(room.wordMode);

            // 役職割り当て
            assignRoles(room);

            // ゲーム状態更新
            room.gameState = 'playing';

            // タイマー設定（人数 × 秒/人）
            const spp = secondsPerPlayer || 90; // デフォルト: 1分30秒/人
            room.noTimeLimit = spp === 0;

            if (room.noTimeLimit) {
                room.timerSeconds = -1;
            } else {
                room.timerSeconds = room.players.length * spp;
            }

            // 各プレイヤーに個別の情報を送信
            room.players.forEach(player => {
                io.to(player.id).emit('gameStarted', {
                    role: player.role,
                    word: player.word,
                    timerSeconds: room.timerSeconds,
                    noTimeLimit: room.noTimeLimit,
                    players: room.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        hasAsked: p.hasAsked,
                        hasAnswered: p.hasAnswered
                    }))
                });
            });

            // タイマー開始（制限時間ありの場合のみ）
            if (!room.noTimeLimit) {
                startTimer(io, room);
            }
            console.log(`🎮 ゲーム開始: ルーム ${room.id}`);
        });

        // お題リロール
        socket.on('rerollTopics', async () => {
            const room = rooms.get(socket.roomId);
            if (!room || room.gameState !== 'playing') return;

            room.topics = await generateTopics(room.wordMode);
            assignRoles(room);

            room.players.forEach(player => {
                io.to(player.id).emit('topicsRerolled', {
                    role: player.role,
                    word: player.word
                });
            });
            console.log(`🔄 お題リロール: ルーム ${room.id}`);
        });

        // ナイス/怪しいボタン
        socket.on('reaction', ({ type }) => {
            const room = rooms.get(socket.roomId);
            if (!room) return;

            const player = room.players.find(p => p.id === socket.id);
            io.to(socket.roomId).emit('showReaction', {
                type,
                playerName: player?.name || '不明'
            });
        });

        // 質問案リクエスト
        socket.on('requestQuestions', async () => {
            const room = rooms.get(socket.roomId);
            if (!room) return;

            const player = room.players.find(p => p.id === socket.id);
            if (!player) return;

            const questions = await generateQuestions(player.word);
            socket.emit('questionsGenerated', { questions });
        });

        // 質問者指名（チェックなしの質問者からランダム、10%で全員回答）
        socket.on('selectQuestioner', () => {
            const room = rooms.get(socket.roomId);
            if (!room) return;

            // 回答順序をリセット
            room.answerOrder = null;
            room.currentAnswerIndex = 0;

            const availableForQuestion = room.players.filter(p => !p.hasAsked);
            if (availableForQuestion.length === 0) {
                socket.emit('error', { message: '指名できる質問者がいません' });
                return;
            }

            const questioner = availableForQuestion[Math.floor(Math.random() * availableForQuestion.length)];
            const isAllAnswerMode = Math.random() < 0.1;

            if (isAllAnswerMode) {
                room.allAnswers = [];
            }

            io.to(socket.roomId).emit('questionerSelected', {
                questioner: { id: questioner.id, name: questioner.name },
                isAllAnswerMode
            });
        });

        // 回答者指名（チェックなしの回答者からランダム、20%で全員回答）
        socket.on('selectAnswerer', () => {
            const room = rooms.get(socket.roomId);
            if (!room) return;

            const availableForAnswer = room.players.filter(p => !p.hasAnswered);
            if (availableForAnswer.length === 0) {
                socket.emit('error', { message: '指名できる回答者がいません' });
                return;
            }

            const answerer = availableForAnswer[Math.floor(Math.random() * availableForAnswer.length)];
            const isAllAnswerMode = Math.random() < 0.1;

            if (isAllAnswerMode) {
                room.allAnswers = [];
            }

            io.to(socket.roomId).emit('answererSelected', {
                answerer: { id: answerer.id, name: answerer.name },
                isAllAnswerMode
            });
        });

        // 全員回答の結果を共有（全員出揃ったら一斉公開）
        socket.on('submitAllAnswer', ({ answer }) => {
            const room = rooms.get(socket.roomId);
            if (!room) return;

            const player = room.players.find(p => p.id === socket.id);
            if (!player) return;

            // 回答を保存
            if (!room.allAnswers) {
                room.allAnswers = [];
            }

            // 既に回答済みなら更新、なければ追加
            const existingIndex = room.allAnswers.findIndex(a => a.playerId === socket.id);
            if (existingIndex !== -1) {
                room.allAnswers[existingIndex] = { playerId: socket.id, playerName: player.name, answer };
            } else {
                room.allAnswers.push({ playerId: socket.id, playerName: player.name, answer });
            }

            // 接続中のプレイヤー数をカウント
            const connectedPlayersCount = room.players.filter(p => p.isConnected).length;

            // 全員の回答が出揃ったか確認
            if (room.allAnswers.length >= connectedPlayersCount) {
                io.to(socket.roomId).emit('allAnswersRevealed', {
                    answers: room.allAnswers
                });
                // 回答リセット (次回のためにクリアするか、そのまま保持するかは仕様次第だが、ここではクリアしないでおく。
                // 次の質問フェーズで room.allAnswers が再初期化されるため)
            } else {
                // まだ全員揃っていないことを通知（必要であれば）
                // クライアント側で「他待機中」を表示するので、ここでは特に何もしなくてOK
                // ただし、誰が回答完了したかを知りたい場合はイベントを送る
                io.to(socket.roomId).emit('answerSubmittedProgress', {
                    answeredCount: room.allAnswers.length,
                    totalCount: connectedPlayersCount
                });
            }
        });

        // 回答順序設定（質問者から）
        socket.on('setAnswerOrder', ({ order }) => {
            const room = rooms.get(socket.roomId);
            if (!room) return;

            room.answerOrder = order;
            room.currentAnswerIndex = 0;

            const orderWithNames = order.map(id => {
                const p = room.players.find(pl => pl.id === id);
                return { id, name: p ? p.name : '???' };
            });

            io.to(socket.roomId).emit('answerOrderSet', {
                order: orderWithNames,
                currentIndex: 0
            });

            // 最初の回答者に通知
            if (order.length > 0) {
                io.to(order[0]).emit('promptAnswerer', {
                    playerName: orderWithNames[0].name
                });
            }

            console.log(`📋 回答順序設定: ルーム ${room.id}`);
        });

        // 質問/回答チェック更新
        socket.on('updateCheck', ({ playerId, type, checked }) => {
            const room = rooms.get(socket.roomId);
            if (!room) return;

            const player = room.players.find(p => p.id === playerId);
            if (!player) return;

            if (type === 'asked') {
                player.hasAsked = checked;
            } else if (type === 'answered') {
                player.hasAnswered = checked;
            }

            io.to(socket.roomId).emit('checkUpdated', {
                playerId,
                type,
                checked
            });

            // 回答順序がある場合、次の回答者に通知
            if (type === 'answered' && checked && room.answerOrder) {
                const currentIdx = room.currentAnswerIndex;
                if (currentIdx < room.answerOrder.length && room.answerOrder[currentIdx] === playerId) {
                    room.currentAnswerIndex++;
                    const nextIdx = room.currentAnswerIndex;

                    io.to(socket.roomId).emit('answerOrderUpdate', { currentIndex: nextIdx });

                    if (nextIdx < room.answerOrder.length) {
                        const nextPlayer = room.players.find(p => p.id === room.answerOrder[nextIdx]);
                        io.to(room.answerOrder[nextIdx]).emit('promptAnswerer', {
                            playerName: nextPlayer ? nextPlayer.name : '???'
                        });
                    }
                }
            }
        });

        // 投票画面への移行
        socket.on('goToVoting', () => {
            const room = rooms.get(socket.roomId);
            if (!room) return;

            if (room.timer) {
                clearInterval(room.timer);
                room.timer = null;
            }

            room.gameState = 'voting-fox';
            room.votes = { fox: {}, wolf: {} };

            io.to(socket.roomId).emit('votingStarted', {
                phase: 'fox',
                players: room.players.map(p => ({ id: p.id, name: p.name }))
            });
        });

        // 投票
        socket.on('vote', ({ phase, targetId }) => {
            const room = rooms.get(socket.roomId);
            if (!room) return;

            if (phase === 'fox') {
                room.votes.fox[socket.id] = targetId;

                // 接続中のプレイヤー全員が投票したか確認
                const activePlayers = room.players.filter(p => p.isConnected);
                const allActiveVoted = activePlayers.every(p => room.votes.fox[p.id]);

                if (allActiveVoted) {
                    const foxResult = countVotes(room.votes.fox, room.players);
                    const fox = room.players.find(p => p.role === 'fox');

                    if (foxResult.targetId === fox.id) {
                        // 狐が吊られた → 狼投票へ
                        room.gameState = 'voting-wolf';
                        io.to(socket.roomId).emit('foxVoteResult', {
                            foxCaught: true,
                            foxId: fox.id,
                            foxName: fox.name
                        });

                        // 狼投票開始（狐を除外）
                        setTimeout(() => {
                            io.to(socket.roomId).emit('votingStarted', {
                                phase: 'wolf',
                                players: room.players.filter(p => p.role !== 'fox').map(p => ({ id: p.id, name: p.name }))
                            });
                        }, 2000);
                    } else {
                        // 狐が生き残った → 狐の勝利
                        room.gameState = 'result';
                        io.to(socket.roomId).emit('gameResult', {
                            winner: 'fox',
                            players: room.players,
                            topics: room.topics,
                            votes: room.votes
                        });
                    }
                }
            } else if (phase === 'wolf') {
                room.votes.wolf[socket.id] = targetId;

                // 狐以外かつ接続中のプレイヤー全員が投票したか確認
                const activeNonFoxPlayers = room.players.filter(p => p.role !== 'fox' && p.isConnected);
                const allActiveVoted = activeNonFoxPlayers.every(p => room.votes.wolf[p.id]);

                if (allActiveVoted) {
                    // 集計は全プレイヤー（切断者含む）の票を含める
                    const nonFoxPlayers = room.players.filter(p => p.role !== 'fox');
                    const wolfResult = countVotes(room.votes.wolf, nonFoxPlayers);
                    const wolves = room.players.filter(p => p.role === 'wolf');
                    const wolfIds = wolves.map(w => w.id);

                    if (wolfIds.includes(wolfResult.targetId)) {
                        // 狼が吊られた → 村の勝利
                        room.gameState = 'result';
                        io.to(socket.roomId).emit('gameResult', {
                            winner: 'village',
                            players: room.players,
                            topics: room.topics,
                            votes: room.votes
                        });
                    } else {
                        // 狼が生き残った → 狼の勝利
                        room.gameState = 'result';
                        io.to(socket.roomId).emit('gameResult', {
                            winner: 'wolf',
                            players: room.players,
                            topics: room.topics,
                            votes: room.votes
                        });
                    }
                }
            }
        });

        // もう一度遊ぶ（誰でも可能）
        socket.on('playAgain', () => {
            const room = rooms.get(socket.roomId);
            if (!room) return;

            // リセット
            room.gameState = 'waiting';
            room.topics = null;
            room.votes = { fox: {}, wolf: {} };
            room.answerOrder = null;
            room.currentAnswerIndex = 0;
            room.players.forEach(p => {
                p.role = null;
                p.word = null;
                p.hasAsked = false;
                p.hasAnswered = false;
            });

            io.to(socket.roomId).emit('gameReset', { players: room.players });
        });

        // 切断（ゲーム中は即座に削除しない）
        socket.on('disconnect', () => {
            const room = rooms.get(socket.roomId);
            if (!room) return;

            const player = room.players.find(p => p.id === socket.id);

            if (room.gameState === 'waiting') {
                // 待機中は即座に削除
                room.players = room.players.filter(p => p.id !== socket.id);

                if (room.players.length === 0) {
                    if (room.timer) clearInterval(room.timer);
                    rooms.delete(socket.roomId);
                    console.log(`🗑️ ルーム削除: ${socket.roomId}`);
                } else {
                    if (room.host === socket.id) {
                        room.host = room.players[0].id;
                    }
                    io.to(socket.roomId).emit('playerLeft', {
                        players: room.players,
                        newHost: room.host
                    });
                }
            } else {
                // ゲーム中は接続フラグをオフにして一定時間待機
                if (player) {
                    player.isConnected = false;
                    io.to(socket.roomId).emit('playerDisconnected', {
                        playerId: socket.id,
                        playerName: player.name,
                        players: room.players.map(p => ({
                            id: p.id,
                            name: p.name,
                            hasAsked: p.hasAsked,
                            hasAnswered: p.hasAnswered,
                            isConnected: p.isConnected
                        }))
                    });

                    // 60秒後に完全削除（再接続がなければ）
                    setTimeout(() => {
                        const currentRoom = rooms.get(socket.roomId);
                        if (currentRoom) {
                            const currentPlayer = currentRoom.players.find(p => p.sessionId === socket.sessionId);
                            if (currentPlayer && !currentPlayer.isConnected) {
                                currentRoom.players = currentRoom.players.filter(p => p.sessionId !== socket.sessionId);
                                console.log(`⏰ タイムアウト削除: ${player.name}`);

                                if (currentRoom.players.length === 0) {
                                    if (currentRoom.timer) clearInterval(currentRoom.timer);
                                    rooms.delete(socket.roomId);
                                    console.log(`🗑️ ルーム削除: ${socket.roomId}`);
                                }
                            }
                        }
                    }, 60000);
                }
            }
            console.log(`❌ 切断: ${socket.id}`);
        });
    });
}

// ルームID生成（数字4桁）
function generateRoomId() {
    let roomId;
    do {
        roomId = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    } while (rooms.has(roomId)); // 重複チェック
    return roomId;
}

// 役職割り当て
function assignRoles(room) {
    const shuffled = [...room.players].sort(() => Math.random() - 0.5);

    // 狐は1人
    shuffled[0].role = 'fox';
    shuffled[0].word = room.topics.fox;

    // 狼は指定人数
    for (let i = 1; i <= room.wolfCount && i < shuffled.length; i++) {
        shuffled[i].role = 'wolf';
        shuffled[i].word = room.topics.wolf;
    }

    // 残りは村人
    for (let i = room.wolfCount + 1; i < shuffled.length; i++) {
        shuffled[i].role = 'village';
        shuffled[i].word = room.topics.village;
    }
}

// タイマー開始
function startTimer(io, room) {
    // 既存のタイマーがあればクリア（二重起動防止）
    if (room.timer) {
        clearInterval(room.timer);
        room.timer = null;
    }

    room.timer = setInterval(() => {
        room.timerSeconds--;
        io.to(room.id).emit('timerUpdate', { seconds: room.timerSeconds });

        if (room.timerSeconds <= 0) {
            clearInterval(room.timer);
            room.timer = null;
            room.gameState = 'voting-fox';
            room.votes = { fox: {}, wolf: {} };

            io.to(room.id).emit('votingStarted', {
                phase: 'fox',
                players: room.players.map(p => ({ id: p.id, name: p.name }))
            });
        }
    }, 1000);
}

// 投票集計
function countVotes(votes, players) {
    const counts = {};
    Object.values(votes).forEach(targetId => {
        counts[targetId] = (counts[targetId] || 0) + 1;
    });

    let maxVotes = 0;
    let targetId = null;
    Object.entries(counts).forEach(([id, count]) => {
        if (count > maxVotes) {
            maxVotes = count;
            targetId = id;
        }
    });

    return { targetId, counts };
}

module.exports = gameHandler;
