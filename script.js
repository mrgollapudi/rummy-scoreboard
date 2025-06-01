        var gk_isXlsx = false;
        var gk_xlsxFileLookup = {};
        var gk_fileData = {};

        function filledCell(cell) {
            return cell !== '' && cell != null;
        }

        function loadFileData(filename) {
            if (gk_isXlsx && gk_xlsxFileLookup[filename]) {
                try {
                    var workbook = XLSX.read(gk_fileData[filename], {
                        type: 'base64'
                    });
                    var firstSheetName = workbook.SheetNames[0];
                    var worksheet = workbook.Sheets[firstSheetName];
                    var jsonData = XLSX.utils.sheet_to_json(worksheet, {
                        header: 1,
                        blankrows: false,
                        defval: ''
                    });
                    var filteredData = jsonData.filter(row => row.some(filledCell));
                    var headerRowIndex = filteredData.findIndex((row, index) =>
                        row.filter(filledCell).length >= filteredData[index + 1]?.filter(filledCell).length
                    );
                    if (headerRowIndex === -1 || headerRowIndex > 25) {
                        headerRowIndex = 0;
                    }
                    var csv = XLSX.utils.aoa_to_sheet(filteredData.slice(headerRowIndex));
                    csv = XLSX.utils.sheet_to_csv(csv);
                    return csv;
                } catch (e) {
                    console.error(e);
                    return "";
                }
            }
            return gk_fileData[filename] || "";
        }

        let players = [];
        let round = 1;
        let gameStarted = false;
        let roundScores = [];
        let TARGET_SCORE = null;
        let REJOIN_THRESHOLD = null;
        let gameName = '';
        let startDateTime = null;
        let isEditing = false;
        let gameHistory = [];
        let isReadOnly = false;
        let gameEnded = false;
        const MAX_PLAYERS = 10;
        const MAX_SHARED_GAMES = 100;

        // Cached DOM elements
        const els = {
            playerSetup: document.getElementById('playerSetup'),
            scoreInput: document.getElementById('scoreInput'),
            extraPlayerControls: document.getElementById('extraPlayerControls'),
            gameOver: document.getElementById('gameOver'),
            targetScore: document.getElementById('targetScore'),
            targetDisplay: document.getElementById('targetDisplay'),
            targetValue: document.getElementById('targetValue'),
            targetError: document.getElementById('targetError'),
            playerName: document.getElementById('playerName'),
            betAmount: document.getElementById('betAmount'),
            playerError: document.getElementById('playerError'),
            playerList: document.getElementById('playerList'),
            scoreForm: document.getElementById('scoreForm'),
            scoreInputTitle: document.getElementById('scoreInputTitle'),
            errorMessage: document.getElementById('errorMessage'),
            scoreButtons: document.getElementById('scoreButtons'),
            leaderboardHead: document.getElementById('leaderboardHead'),
            leaderboardTable: document.getElementById('leaderboardTable'),
            leaderboardGameName: document.getElementById('leaderboardGameName'),
            totalBetAmount: document.getElementById('totalBetAmount'),
            shareLeaderboard: document.getElementById('shareLeaderboard'),
            winnerText: document.getElementById('winnerText'),
            winningsText: document.getElementById('winningsText'),
            historyTable: document.getElementById('historyTable'),
            gameOverButtons: document.getElementById('gameOverButtons')
        };

        function formatName(name) {
            return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
        }

        function getPlayerDisplayName(player) {
            const formattedName = formatName(player.name);
            return player.rejoinCount > 0 ? `${formattedName} (R${player.rejoinCount})` : formattedName;
        }

        function calculateTotalBetAmount() {
            return players.reduce((sum, player) => sum + player.betAmount, 0);
        }

        function calculateWinnings() {
            const activePlayers = players.filter(p => !p.eliminated);
            const totalBetAmount = parseFloat(calculateTotalBetAmount());
            const initialBet = players.length > 0 ? players[0].initialBetAmount : 0;
            const winnings = [];

            // Initialize winnings: each player loses their bet amount
            players.forEach(player => {
                winnings.push({
                    name: getPlayerDisplayName(player),
                    winnings: -player.betAmount
                });
            });

            // Check if any active players have drops
            const hasDrops = activePlayers.some(player =>
                Math.floor((TARGET_SCORE - player.totalScore) / 24) > 0
            );

            if (!hasDrops && activePlayers.length > 0) {
                // No drops: equally distribute total bet amount among active players
                const equalShare = totalBetAmount / activePlayers.length;
                activePlayers.forEach(player => {
                    const playerWinnings = winnings.find(w => w.name === getPlayerDisplayName(player));
                    playerWinnings.winnings += equalShare;
                });
            } else {
                // Existing logic: 40% elimination rule
                const eliminatedPlayers = players.filter(p => p.eliminated);
                if (eliminatedPlayers.length / players.length < 0.4) {
                    return null;
                }

                const playerDrops = activePlayers.map(player => ({
                    name: getPlayerDisplayName(player),
                    drops: Math.max(0, Math.round(Math.floor((TARGET_SCORE - player.totalScore) / 24)))
                }));
                const totalNonZeroDrops = playerDrops.reduce((sum, p) => sum + p.drops, 0);

                if (activePlayers.length > 0) {
                    const remainingPool = totalBetAmount - (initialBet * activePlayers.length);
                    activePlayers.forEach(player => {
                        const playerWinnings = winnings.find(w => w.name === getPlayerDisplayName(player));
                        playerWinnings.winnings += initialBet;
                        if (totalNonZeroDrops > 0 && remainingPool > 0) {
                            const playerDrop = playerDrops.find(p => p.name === getPlayerDisplayName(player)).drops;
                            playerWinnings.winnings += (playerDrop / totalNonZeroDrops) * remainingPool;
                        }
                    });
                }
            }

            winnings.forEach(w => {
                w.winnings = parseFloat(w.winnings.toFixed(2));
            });

            return winnings;
        }

        function generateRandomId() {
            const sharedGames = JSON.parse(localStorage.getItem('rummySharedGames') || '{}');
            let id;
            do {
                id = Math.floor(100000 + Math.random() * 9000000).toString(); // 6-7 digits
            } while (sharedGames[id]);
            return id;
        }

        function saveSharedGame(gameData) {
            let sharedGames = JSON.parse(localStorage.getItem('rummySharedGames') || '{}');
            const id = generateRandomId();

            // Limit to MAX_SHARED_GAMES
            const keys = Object.keys(sharedGames);
            if (keys.length >= MAX_SHARED_GAMES) {
                const oldestKey = keys[0];
                delete sharedGames[oldestKey];
            }

            sharedGames[id] = gameData;
            try {
                localStorage.setItem('rummySharedGames', JSON.stringify(sharedGames));
            } catch (e) {
                console.error('Storage error:', e);
                alert('Storage limit reached. Clear history or try again.');
                return null;
            }
            return id;
        }

        function generateShareLink() {
            const leaderboardElement = document.getElementById('leaderboard');
            if (!leaderboardElement) {
                alert('Leaderboard not found.');
                return;
            }

            html2canvas(leaderboardElement).then(canvas => {
                // Create a downloadable image
                const link = document.createElement('a');
                link.download = `${gameName || 'Rummy_Leaderboard'}.png`;
                link.href = canvas.toDataURL();
                link.click();
            }).catch(err => {
                console.error('Screenshot failed:', err);
                alert('Failed to capture the leaderboard. Try again.');
            });
        }

        function generateHistoryShareLink(startDateTime) {
            localStorage.setItem("rummyTempGameBackup", localStorage.getItem("rummyGameState"));
    const game = gameHistory.find(g => g.startDateTime === startDateTime);
            if (!game) {
                alert('Game not found.');
                return;
            }
            const id = saveSharedGame(game);
            if (!id) return;
            const shareUrl = `${window.location.href.split('?')[0]}?id=${id}`;
            if (navigator.clipboard && navigator.clipboard.write) {
                navigator.clipboard.write(shareUrl).then(() => {
                    alert('Shareable link copied to clipboard: ' + shareUrl);
                }).catch(() => {
                    showCopyPrompt(shareUrl);
                });
            } else {
                showCopyPrompt(shareUrl);
            }
        }

        function makeUniqueGameName(name) {
            let baseName = name;
            let counter = 1;
            let uniqueName = name;
            while (gameHistory.some(h => h.gameName === uniqueName)) {
                uniqueName = `${baseName} (${counter})`;
                counter++;
            }
            return uniqueName;
        }

        function saveGameState() {
            if (!isReadOnly) {
                localStorage.setItem('rummyGameState', JSON.stringify({
                    players,
                    round,
                    gameStarted,
                    roundScores,
                    TARGET_SCORE,
                    REJOIN_THRESHOLD,
                    gameName,
                    startDateTime,
                    isEditing
                }));
            }
        }

        function loadGameState() {
            const urlParams = new URLSearchParams(window.location.search);
            const id = urlParams.get('id');
            if (id) {
                const sharedGames = JSON.parse(localStorage.getItem('rummySharedGames') || '{}');
                const gameData = sharedGames[id];
                if (gameData) {
                    isReadOnly = true;
                    document.body.classList.add('read-only');
                    gameName = gameData.gameName || 'Untitled';
                    startDateTime = gameData.startDateTime || new Date().toISOString();
                    TARGET_SCORE = gameData.targetScore || 100;
                    players = gameData.players || [];
                    roundScores = gameData.roundScores || [];
                    els.leaderboardGameName.textContent = gameName;
                    els.totalBetAmount.textContent = gameData.totalBetAmount || '0.00';
                    els.playerSetup.classList.add('hidden');
                    els.scoreInput.classList.add('hidden');
                    els.gameOver.classList.add('hidden');
                    els.shareLeaderboard.classList.add('hidden');
                    updateLeaderboard();
                    updateGameHistory();
                } else {
                    alert('Invalid or expired share link.');
                    loadLocalGameState();
                }
            } else {
                loadLocalGameState();
            }
        }

        function loadLocalGameState() {
            const state = JSON.parse(localStorage.getItem('rummyGameState') || '{}');
            if (state.players) {
                players = state.players;
                round = state.round || 1;
                gameStarted = state.gameStarted || false;
                roundScores = state.roundScores || [];
                TARGET_SCORE = state.TARGET_SCORE || null;
                REJOIN_THRESHOLD = state.REJOIN_THRESHOLD || null;
                gameName = state.gameName || '';
                startDateTime = state.startDateTime || null;
                isEditing = state.isEditing || false;

                if (TARGET_SCORE) {
                    els.targetScore.value = TARGET_SCORE;
                    els.targetScore.disabled = true;
                    els.targetValue.textContent = TARGET_SCORE;
                    els.targetDisplay.classList.remove('hidden');
                }
                updatePlayerList();
                if (gameStarted) {
                    els.playerSetup.classList.add('hidden');
                    els.scoreInput.classList.remove('hidden');
                    if (els.gameOver && players.filter(p => !p.eliminated).length <= 1) {
                        els.scoreInput.classList.add('hidden');
                        els.gameOver.classList.remove('hidden');
                        endGame();
                    } else {
                        updateScoreForm();
                    }
                }
                updateLeaderboard();
            }
            updateGameHistory();
        }

        function saveGameHistory() {
            if (isReadOnly) return;

            const existingHistory = JSON.parse(localStorage.getItem('rummyGameHistory') || '[]');

            // Remove existing entry with same startDateTime (if any)
            const filteredHistory = existingHistory.filter(g => g.startDateTime !== startDateTime);

            const activePlayers = players.filter(p => !p.eliminated);
            const winnings = calculateWinnings();
            let result = winnings ?
                winnings.filter(w => w.winnings !== 0).map(w => `${w.name}: $${w.winnings > 0 ? '+' : ''}${w.winnings}`).join(', ') :
                'NO Winnings, not even 40% of the players eliminated';

            if (els.winnerText.textContent.includes('manually')) {
                result = `Manual End: ${result}`;
            } else if (!activePlayers.some(p => Math.floor((TARGET_SCORE - p.totalScore) / 24) > 0)) {
                result = `No Drops: ${result}`;
            }

            const gameData = {
                gameName: gameName || 'Untitled',
                startDateTime: startDateTime || new Date().toISOString(),
                targetScore: TARGET_SCORE || 100,
                totalBetAmount: calculateTotalBetAmount(),
                players: players.map(p => ({
                    name: p.name,
                    initialBetAmount: p.initialBetAmount,
                    betAmount: p.betAmount,
                    totalScore: p.totalScore,
                    roundsWon: p.roundsWon,
                    eliminated: p.eliminated,
                    rejoinCount: p.rejoinCount,
                    lastEliminatedRound: p.lastEliminatedRound,
                    rejoinRounds: p.rejoinRounds
                })),
                roundScores: roundScores.map(round => ({
                    ...round
                })),
                result
            };

            // Push the new, unique entry
            filteredHistory.push(gameData);
            localStorage.setItem('rummyGameHistory', JSON.stringify(filteredHistory));
            updateGameHistory();
        }


        function updateGameHistory() {
            gameHistory = JSON.parse(localStorage.getItem('rummyGameHistory') || '[]');
            els.historyTable.innerHTML = gameHistory.length === 0 ?
                '<tr><td colspan="5" class="text-gray-600">No games found.</td></tr>' :
                gameHistory.map((game) => `
                    <tr>
                        <td class="p-1">${game.gameName}</td>
                        <td class="p-1">${new Date(game.startDateTime).toLocaleString()}</td>
                        <td class="p-1">${game.targetScore}</td>
                        <td class="p-1">${game.result}</td>
                        <td class="p-1 text-center">
                            <button onclick="viewGameHistory('${game.startDateTime}')" class="bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600 ${isReadOnly ? 'hidden' : ''}">View</button>
                         <!--   <button onclick="generateHistoryShareLink('${game.startDateTime}')" class="bg-purple-500 text-white px-2 py-1 rounded hover:bg-purple-600">Share</button> -->
                        </td>
                    </tr>
                `).join('');
        }

        function viewGameHistory(startDateTime) {
            if (isReadOnly) return;
            localStorage.setItem("rummyTempGameBackup", localStorage.getItem("rummyGameState"));
    const game = gameHistory.find(g => g.startDateTime === startDateTime);
            if (!game) {
                els.leaderboardTable.innerHTML = '<tr><td colspan="100" class="text-red-500">Game not found.</td></tr>';
                return;
            }

            els.leaderboardGameName.textContent = game.gameName || 'Untitled';
            els.totalBetAmount.textContent = game.totalBetAmount || '0.00';
            els.leaderboardHead.innerHTML = `<tr class="bg-gray-200"><th class="p-1">Round</th>${game.players.map(p => `<th class="p-1 ${p.eliminated ? 'text-red-500 eliminated-column' : ''}">${getPlayerDisplayName(p)}</th>`).join('')}</tr>`;
            let tableHTML = '';

            game.roundScores.forEach((roundData, index) => {
                tableHTML += `<tr><td class="p-1">${index + 1}</td>`;
                game.players.forEach(player => {
                    const score = roundData[player.name] !== undefined ? roundData[player.name] : '-';
                    const displayScore = score === 0 ? 'R' : score;
                    const isRejoinRound = player.rejoinRounds.includes(index + 1);
                    const isWinner = score === 0;
                    const isEliminationRound = player.lastEliminatedRound === index && score !== '-';
                    const cellClass = [
                        'text-center',
                        isWinner ? 'bg-green-800 text-white' : '',
                        isRejoinRound ? 'bg-amber-800 text-white' : '',
                        player.eliminated && !isWinner && !isRejoinRound ? 'eliminated-score' : ''
                    ].filter(Boolean).join(' ');
                    const eliminationMark = isEliminationRound ? '<sup class="text-red-500">E</sup>' : '';
                    tableHTML += `<td class="p-1 ${cellClass}">${displayScore}${eliminationMark}</td>`;
                });
                tableHTML += '</tr>';
            });

            // Total row with lowest/highest styling
            const activeTotals = game.players.filter(p => !p.eliminated).map(p => p.totalScore);
            const minTotal = activeTotals.length > 0 ? Math.min(...activeTotals) : null;
            const maxTotal = activeTotals.length > 0 ? Math.max(...activeTotals) : null;

            tableHTML += `<tr class="bg-gray-200"><td class="p-1 font-bold">Total</td>${game.players.map(player => {
                const pointsToTarget = game.targetScore - player.totalScore;
                const isLowest = !player.eliminated && player.totalScore === minTotal;
                const isHighest = !player.eliminated && player.totalScore === maxTotal;
                const totalCellClass = [
                    'text-center',
                    pointsToTarget === 24 ? 'bg-amber-500 text-white' : '',
                    pointsToTarget < 24 && player.totalScore <= game.targetScore ? 'bg-red-500 text-white' : '',
                    player.eliminated && pointsToTarget !== 24 && !(pointsToTarget < 24 && player.totalScore <= game.targetScore) ? 'eliminated-score' : '',
                    isLowest ? 'lowest-total' : '',
                    isHighest ? 'highest-total' : ''
                ].filter(Boolean).join(' ');
                return `<td class="p-1 ${totalCellClass}">${player.totalScore}</td>`;
            }).join('')}</tr>`;

            // Drops row
            tableHTML += `<tr class="bg-white-leaderboard"><td class="p-1 font-bold">Drops:</td>${game.players.map(player => {
                const drops = player.eliminated ? '-' : Math.round(Math.floor((game.targetScore - player.totalScore) / 24));
                const dropsCellClass = player.eliminated ? 'text-center eliminated-score' : 'text-center';
                return `<td class="p-1 ${dropsCellClass}">${drops}</td>`;
            }).join('')}</tr>`;

            // To Eliminate row
            tableHTML += `<tr class="bg-light-purple"><td class="p-1 font-bold">Oaks Rem:</td>${game.players.map(player => {
                const toEliminate = player.eliminated ? '-' : game.targetScore - player.totalScore ;
                const toEliminateCellClass = player.eliminated ? 'text-center eliminated-score' : 'text-center';
                return `<td class="p-1 ${toEliminateCellClass}">${toEliminate}</td>`;
            }).join('')}</tr>`;

            els.leaderboardTable.innerHTML = tableHTML;
        }

        function addPlayer() {
            if (isReadOnly) return;

            const input = els.playerName.value.trim();
            const betInput = parseFloat(els.betAmount.value) || 0;

            if (!input) {
                els.playerError.textContent = 'Player names are required.';
                els.playerError.classList.remove('hidden');
                return;
            }

            if (betInput < 0) {
                els.playerError.textContent = 'Bet amount must be non-negative.';
                els.playerError.classList.remove('hidden');
                return;
            }

            if (players.length > 0 && betInput !== players[0].initialBetAmount) {
                els.playerError.textContent = 'All players must have the same initial bet amount.';
                els.playerError.classList.remove('hidden');
                return;
            }

            // Prepare names
            const inputNames = input.split(',').map(name => name.trim()).filter(Boolean);
            const existingNamesLower = players.map(p => p.name.toLowerCase());

            const newNames = [];
            const duplicates = [];

            inputNames.forEach(name => {
                const formatted = formatName(name);
                if (existingNamesLower.includes(formatted.toLowerCase()) || newNames.map(n => n.toLowerCase()).includes(formatted.toLowerCase())) {
                    duplicates.push(formatted);
                } else {
                    newNames.push(formatted);
                }
            });

            if (duplicates.length > 0) {
                els.playerError.textContent = `Duplicate name(s): ${duplicates.join(', ')}. Please use unique names.`;
                els.playerError.classList.remove('hidden');
                return;
            }

            // Add unique players
            newNames.forEach(name => {
                players.push({
                    name,
                    initialBetAmount: betInput,
                    betAmount: betInput,
                    totalScore: 0,
                    roundsWon: 0,
                    eliminated: false,
                    rejoinCount: 0,
                    lastEliminatedRound: null,
                    rejoinRounds: []
                });
            });

            els.playerName.value = '';
            els.betAmount.value = '10';
            els.playerError.classList.add('hidden');
            updatePlayerList();
            saveGameState();
        }


        function updatePlayerList() {
            if (isReadOnly) return;
            els.playerList.innerHTML = players.map(player => `
                <div class="bg-gray-100 p-1 rounded flex justify-between items-center">
                    <span>${getPlayerDisplayName(player)} ($${player.betAmount})</span>
                    <button onclick="removePlayer('${player.name}')" class="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600">Remove</button>
                </div>
            `).join('');
        }

        function removePlayer(name) {
            if (isReadOnly) return;
            players = players.filter(p => p.name !== name);
            updatePlayerList();
            updateLeaderboard();
            saveGameState();
        }

        function startGame() {
            if (isReadOnly) return;
            const target = parseInt(els.targetScore.value) || 0;
            if (target < 100) {
                els.targetError.textContent = 'Target score must be at least 100.';
                els.targetError.classList.remove('hidden');
                return;
            }
            if (players.length < 2) {
                els.targetError.textContent = 'At least 2 players are required to start the game.';
                els.targetError.classList.remove('hidden');
                return;
            }
            TARGET_SCORE = target;
            REJOIN_THRESHOLD = target - 24;
            els.targetError.classList.add('hidden');
            els.targetScore.disabled = true;
            els.targetValue.textContent = TARGET_SCORE;
            els.targetDisplay.classList.remove('hidden');

            let inputName = window.prompt('Enter a name for this game (optional):', '');
            if (inputName === null || inputName.trim() === '') {
                const now = new Date();
                inputName = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
            }
            gameName = makeUniqueGameName(inputName);
            startDateTime = new Date().toISOString();
            gameStarted = true;
            els.playerSetup.classList.add('hidden');
            els.scoreInput.classList.remove('hidden');
            updateScoreForm();
            updateLeaderboard();
            saveGameState();
            // ✅ Show Add Extra Player input
            els.extraPlayerControls.classList.remove('hidden');

        }

        function updateScoreForm() {
            if (isReadOnly) return;

            const isGameOver = !els.gameOver.classList.contains('hidden');

            els.scoreInputTitle.innerHTML = isEditing ?
                `Edit Scores for Round <span id="roundNumber">${round - 1}</span>` :
                `Enter Scores for Round <span id="roundNumber">${round}</span>`;

            const playersToShow = isEditing ?
                players.filter(p => roundScores[roundScores.length - 1] && roundScores[roundScores.length - 1].hasOwnProperty(p.name)) :
                players.filter(p => !p.eliminated);

            // Generate HTML for score inputs
            els.scoreForm.innerHTML = playersToShow.map(player => {
                let selectedValue = isEditing && roundScores.length > 0 ?
                    roundScores[roundScores.length - 1][player.name] :
                    24;
                let isEntry = isEditing && ![0, 24, 40, 80].includes(selectedValue);
                if (isEntry && selectedValue === undefined) selectedValue = '';
                return `
                  <div class="flex flex-col gap-1 w-10">
                    <label for="score_${player.name}" class="font-medium text-sm" title="${getPlayerDisplayName(player)}">
                      ${getPlayerDisplayName(player)}
                    </label>
                    <select id="score_${player.name}" class="border rounded p-1 text-sm">
                      <option value="0" ${selectedValue === 0 ? 'selected' : ''}>R (0)</option>
                      <option value="24" ${selectedValue === 24 ? 'selected' : ''}>D (24)</option>
                      <option value="40" ${selectedValue === 40 ? 'selected' : ''}>MD (40)</option>
                      <option value="80" ${selectedValue === 80 ? 'selected' : ''}>FC (80)</option>
                      <option value="entry" ${isEntry ? 'selected' : ''}>Input:</option>
                    </select>
                    <label for="entry_${player.name}" class="sr-only">Custom Score for ${getPlayerDisplayName(player)}</label>
                    <input id="entry_${player.name}" type="number" placeholder="2-80" value="${isEntry ? selectedValue : ''}"
                      class="border rounded p-1 text-sm w-10 ${isEntry ? '' : 'hidden'}"
                      min="2" max="80">
                  </div>
                `;
            }).join('');

            // ✅ Now add event listeners after the DOM elements exist
            playersToShow.forEach(player => {
                const select = document.getElementById(`score_${player.name}`);
                const entryInput = document.getElementById(`entry_${player.name}`);

                if (select && entryInput) {
                    select.addEventListener('change', () => {
                        entryInput.classList.toggle('hidden', select.value !== 'entry');
                    });
                }
            });

            // Show/hide buttons
            if (isGameOver) {
                els.scoreButtons.innerHTML = '';
            } else {
                els.scoreButtons.innerHTML = `
                    <button onclick="submitScores()" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
                        ${isEditing ? 'Save Changes' : 'Submit Scores'}
                    </button>
                    ${(!isEditing && roundScores.length > 0) ? `
                        <button onclick="editLastRound()" class="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600">
                            Edit Last Round
                        </button>
                    ` : ''}
                `;
            }

            els.errorMessage.classList.add('hidden');
        }


        function editLastRound() {
            if (isReadOnly || roundScores.length === 0 || !els.gameOver.classList.contains('hidden')) return;

            isEditing = true;

            const lastRoundIndex = roundScores.length - 1;
            const lastRoundScores = roundScores[lastRoundIndex];

            players.forEach(player => {
                const lastScore = lastRoundScores[player.name];

                if (typeof lastScore === 'number') {
                    player.totalScore -= lastScore;

                    if (lastScore === 0) {
                        player.roundsWon -= 1;
                    }

                    if (player.eliminated && player.lastEliminatedRound === round - 1) {
                        player.eliminated = false;
                        player.lastEliminatedRound = null;
                    }
                }
            });

            // ✅ Do NOT pop or modify roundScores or round
            // Form will overwrite roundScores[lastRoundIndex] directly

            updateScoreForm();
            updateLeaderboard();
            saveGameState();
        }


        function submitScores() {
            if (isReadOnly) return;
            const scores = [];
            const errors = [];
            const currentRoundScores = {};
            let winnerCount = 0;

            const playersToScore = isEditing ?
                players.filter(p => roundScores[roundScores.length - 1]?.hasOwnProperty(p.name)) :
                players.filter(p => !p.eliminated);

            playersToScore.forEach(player => {

                const select = document.getElementById(`score_${player.name}`);
                let score;
                // Fix: Check if select exists
                if (!select) {
                    errors.push(`Score input for ${getPlayerDisplayName(player)} not found.`);
                    return;
                }
                if (select.value === 'entry') {
                    const entryInput = document.getElementById(`entry_${player.name}`);
                    score = parseInt(entryInput.value) || 0;
                    if (score < 2 || score > 80) {
                        errors.push(`${getPlayerDisplayName(player)}'s entry score must be 2-80.`);
                        entryInput.classList.add('border-red-500');
                        return;
                    }
                    entryInput.classList.remove('border-red-500');
                } else {
                    score = parseInt(select.value);
                }
                scores.push({
                    player,
                    score
                });
                currentRoundScores[player.name] = score;
                if (score === 0) winnerCount++;
            });

            if (winnerCount !== 1) errors.push('Exactly one player must be the winner (R).');

            if (errors.length) {
                els.errorMessage.innerHTML = errors.join('<br>');
                els.errorMessage.classList.remove('hidden');
                return;
            }
            els.errorMessage.classList.add('hidden');

            if (isEditing) {
                const lastRoundIndex = roundScores.length - 1;
                const lastRoundScores = roundScores[lastRoundIndex];

                players.forEach(player => {
                    const newScore = currentRoundScores[player.name] || 0;
                    //oldScore was already subtracted in editLastRound
                    player.totalScore += newScore;
                    if (newScore === 0) player.roundsWon += 1;

                    const wasEliminated = player.eliminated;
                    player.eliminated = player.totalScore > TARGET_SCORE;

                    if (!wasEliminated && player.eliminated) {
                        player.lastEliminatedRound = round - 1;
                    } else if (wasEliminated && !player.eliminated) {
                        player.lastEliminatedRound = null;
                    }
                });

                // ✅ This line updates the last round — not adds a new one
                roundScores[lastRoundIndex] = currentRoundScores;

                isEditing = false;
            } else {
                roundScores.push(currentRoundScores);
                round++;
                scores.forEach(({
                    player,
                    score
                }) => {
                    player.totalScore += score;
                    if (score === 0) player.roundsWon += 1;
                    const wasEliminated = player.eliminated;
                    player.eliminated = player.totalScore > TARGET_SCORE;
                    if (!wasEliminated && player.eliminated) {
                        player.lastEliminatedRound = round - 1;
                    } else if (wasEliminated && !player.eliminated) {
                        player.lastEliminatedRound = null;
                    }
                });
            }

            const activePlayersAfter = players.filter(p => !p.eliminated);
            const canAnyoneRejoin = players.some(p =>
                p.eliminated &&
                p.lastEliminatedRound !== null &&
                round === p.lastEliminatedRound + 1 &&
                Math.max(...players.filter(p => !p.eliminated).map(p => p.totalScore)) <= REJOIN_THRESHOLD
            );

            if (activePlayersAfter.length <= 1) {
                updateLeaderboard();
                updateGameHistory();
                endGame();
            } else {
                updateScoreForm();
                updateLeaderboard();
                updateGameHistory();
            }
            saveGameState();
        }

        function rejoinPlayer(name) {
            if (isReadOnly) return;
            const player = players.find(p => p.name === name);
            if (!player || !player.eliminated) return;

            const scores = players.filter(p => !p.eliminated).map(p => p.totalScore);
            const maxScore = scores.length ? Math.max(...scores) : 0;

            if (maxScore <= REJOIN_THRESHOLD && player.lastEliminatedRound !== null && round === player.lastEliminatedRound + 1) {
                player.eliminated = false;
                player.rejoinCount += 1;
                player.betAmount += player.initialBetAmount;
                player.totalScore = maxScore;
                player.lastEliminatedRound = null;
                player.rejoinRounds.push(round);
                roundScores.forEach(round => {
                    if (!round[player.name]) round[player.name] = '-';
                });
                updateScoreForm();
                updateLeaderboard();
                saveGameState();
            } else {
                alert(`${getPlayerDisplayName(player)} cannot rejoin. Rejoin is only allowed in the next round after elimination, and the highest score (${maxScore}) must not exceed ${REJOIN_THRESHOLD}.`);
            }
        }

        function updateLeaderboard() {
            els.leaderboardGameName.textContent = gameName || 'Untitled';
            els.totalBetAmount.textContent = calculateTotalBetAmount();
            els.leaderboardHead.innerHTML = `<tr class="bg-gray-200"><th class="p-1">Round</th>${players.map(p => `<th class="p-1 ${p.eliminated ? 'text-red-500 eliminated-column' : ''}">${getPlayerDisplayName(p)}</th>`).join('')}</tr>`;
            let tableHTML = '';

            roundScores.forEach((roundData, index) => {
                tableHTML += `<tr><td class="p-1 text-center font-bold">${index + 1}</td>`;
                players.forEach(player => {
                    const score = roundData[player.name] !== undefined ? roundData[player.name] : '-';
                    const displayScore = score === 0 ? 'R' : score;
                    const isRejoinRound = player.rejoinRounds.includes(index + 1);
                    const isWinner = score === 0;
                    const isEliminationRound = player.lastEliminatedRound === index && score !== '-';
                    const cellClass = [
                        'text-center',
                        isWinner ? 'bg-green-500 font-bold text-black' : '',
                        isRejoinRound ? 'bg-amber-500 text-white' : '',
                        player.eliminated && !isWinner && !isRejoinRound ? 'eliminated-score' : ''
                    ].filter(Boolean).join(' ');
                    const eliminationMark = isEliminationRound ? '<sup class="text-red-500">E</sup>' : '';
                    tableHTML += `<td class="p-1 ${cellClass}">${displayScore}${eliminationMark}</td>`;
                });
                tableHTML += '</tr>';
            });

            // Total row with lowest/highest styling
            const activeTotals = players.filter(p => !p.eliminated).map(p => p.totalScore);
            const minTotal = activeTotals.length > 0 ? Math.min(...activeTotals) : null;
            const maxTotal = activeTotals.length > 0 ? Math.max(...activeTotals) : null;

            tableHTML += `<tr class="bg-gray-200"><td class="p-1 font-bold">Total</td>${players.map(player => {
                const pointsToTarget = TARGET_SCORE - player.totalScore;
                const isLowest = !player.eliminated && player.totalScore === minTotal;
                const isHighest = !player.eliminated && player.totalScore === maxTotal;
                const totalCellClass = [
                    'text-center',
                    pointsToTarget === 24 ? 'bg-amber-500 text-white' : '',
                    pointsToTarget < 24 && player.totalScore <= TARGET_SCORE ? 'bg-red-500 text-white' : '',
                    player.eliminated && pointsToTarget !== 24 && !(pointsToTarget < 24 && player.totalScore <= TARGET_SCORE) ? 'eliminated-score' : '',
                    isLowest ? 'lowest-total' : '',
                    isHighest ? 'highest-total' : ''
                ].filter(Boolean).join(' ');
                return `<td class="p-1 ${totalCellClass}">${player.totalScore}</td>`;
            }).join('')}</tr>`;

            // Drops row
            tableHTML += `<tr class="bg-white-leaderboard"><td class="p-1 font-bold">Drops:</td>${players.map(player => {
                const drops = player.eliminated ? '-' : Math.round(Math.floor((TARGET_SCORE - player.totalScore) / 24));
                const dropsCellClass = player.eliminated ? 'text-center eliminated-score' : 'text-center';
                return `<td class="p-1 ${dropsCellClass}">${drops}</td>`;
            }).join('')}</tr>`;

            // To Eliminate row
            tableHTML += `<tr class="bg-light-purple"><td class="p-1 font-bold">Oaks Rem:</td>${players.map(player => {
                const toEliminate = player.eliminated ? '-' : TARGET_SCORE - player.totalScore;
                const toEliminateCellClass = player.eliminated ? 'text-center eliminated-score' : 'text-center';
                return `<td class="p-1 ${toEliminateCellClass}">${toEliminate}</td>`;
            }).join('')}</tr>`;

            // Rejoin actions (hidden in read-only mode)
            if (!isReadOnly && !gameEnded) {
                tableHTML += `<tr><td class="p-1"> Action </td>${players.map(player => {
                    const activePlayersCount = players.filter(p => !p.eliminated).length;
                const scores = players.filter(p => !p.eliminated).map(p => p.totalScore);
                const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
                const canRejoin = player.eliminated &&
                    player.lastEliminatedRound !== null &&
                    round === player.lastEliminatedRound + 1 &&
                    maxScore <= REJOIN_THRESHOLD;

                    return `<td class="p-1 text-center">${canRejoin ? `<button onclick="rejoinPlayer('${player.name}')" class="bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-600">Rejoin</button>` : ''}</td>`;
                }).join('')}</tr>`;
            }

            els.leaderboardTable.innerHTML = tableHTML;
            // ✅ Hide End Game button if there is only one player left
            const activePlayers = players.filter(p => !p.eliminated);
            const manualEndBtn = document.getElementById('manualEndButton');

            if (manualEndBtn) {
                if (activePlayers.length <= 1) {
                    manualEndBtn.classList.add('hidden');
                } else {
                    manualEndBtn.classList.remove('hidden');
                }
            }

        }

        function endGame(isManualEnd = false) {
            if (isReadOnly || !gameStarted) return;
            // 🔻 Hide Add Extra Player controls when game ends
            els.extraPlayerControls.classList.add('hidden');
            els.scoreInput.classList.add('hidden');
            els.gameOver.classList.remove('hidden');
            gameEnded = true;
            const activePlayers = players.filter(p => !p.eliminated);
            const winnings = calculateWinnings();
            const hasDrops = activePlayers.some(p => Math.floor((TARGET_SCORE - p.totalScore) / 24) > 0);

            if (isManualEnd) {
                const dropsLeft = players
                    .filter(player => !player.eliminated)
                    .map(player => ({
                        name: getPlayerDisplayName(player),
                        drops: Math.round(Math.floor((TARGET_SCORE - player.totalScore) / 24))
                    }))
                    .sort((a, b) => a.name.localeCompare(b.name));
                els.winnerText.textContent = dropsLeft.length > 0 ?
                    `Game ended manually. Drops: ${dropsLeft.map(p => `${p.name}: ${p.drops}`).join(', ')}` :
                    'Game ended manually. No active players.';
                els.winningsText.innerHTML = winnings && winnings.length > 0 ?
                    `Potential Winnings:<br>${winnings.map(w => `${w.name}: $${w.winnings > 0 ? '+' : ''}${w.winnings}`).join('<br>')}` :
                    'No Winnings, not even 40% of the players eliminated.';
                els.gameOverButtons.innerHTML = `
                    <button onclick="resumeGame()" class="bg-yellow-500 text-black px-4 py-2 rounded hover:bg-yellow-600">Resume Game</button>
                    <button onclick="resetGame()" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">New Game</button>
                `;
            } else if (activePlayers.length === 1) {
                els.winnerText.textContent = `Winner: ${getPlayerDisplayName(activePlayers[0])} with ${activePlayers[0].totalScore} points!`;
                els.winningsText.innerHTML = winnings && winnings.length > 0 ?
                    `Winnings:<br>${winnings.map(w => `${w.name}: $${w.winnings > 0 ? '+' : ''}${w.winnings}`).join('<br>')}` :
                    'No Winnings, not even 40% of the players eliminated.';
                els.gameOverButtons.innerHTML = `
                    <button onclick="resetGame()" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">New Game</button>
                `;
            } else if (!hasDrops) {
                els.winnerText.textContent = 'Game ended with no drops remaining.';
                els.winningsText.innerHTML = winnings && winnings.length > 0 ?
                    `Winnings (Equal Split):<br>${winnings.map(w => `${w.name}: $${w.winnings > 0 ? '+' : ''}${w.winnings}`).join('<br>')}` :
                    'No winnings calculated.';
                els.gameOverButtons.innerHTML = `
                    <button onclick="resumeGame()" class="bg-yellow-500 text-black px-4 py-2 rounded hover:bg-yellow-600">Resume Game</button>
                    <button onclick="resetGame()" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">New Game</button>
                `;
            } else {
                els.winnerText.textContent = 'Game ended with no clear winner.';
                els.winningsText.innerHTML = winnings && winnings.length > 0 ?
                    `Potential Winnings:<br>${winnings.map(w => `${w.name}: $${w.winnings > 0 ? '+' : ''}${w.winnings}`).join('<br>')}` :
                    'No Winnings, not even 40% of the players eliminated.';
                els.gameOverButtons.innerHTML = `
                    <button onclick="resumeGame()" class="bg-yellow-500 text-black px-4 py-2 rounded hover:bg-yellow-600">Resume Game</button>
                    <button onclick="resetGame()" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">New Game</button>
                `;
            }

            saveGameState();
            saveGameHistory();
        }

        function resumeGame() {
            if (isReadOnly || !gameStarted) return;
            els.scoreInput.classList.remove('hidden');
            els.gameOver.classList.add('hidden');
            isEditing = false;
            gameEnded = false;
            updateScoreForm();
            updateLeaderboard();
            saveGameState();
        }

        function addExtraPlayer() {
            if (!gameStarted || isReadOnly) return;

            const nameInput = document.getElementById('extraPlayerName');
            const errorBox = document.getElementById('extraPlayerError');
            const name = formatName(nameInput.value.trim());

            if (!name) {
                errorBox.textContent = 'Player name is required.';
                errorBox.classList.remove('hidden');
                return;
            }

            if (players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
                errorBox.textContent = 'Player name must be unique.';
                errorBox.classList.remove('hidden');
                return;
            }

            const initialBet = players.length > 0 ? players[0].initialBetAmount : 0;
            const highestScore = Math.max(...players.map(p => p.totalScore));

            const newPlayer = {
                name,
                initialBetAmount: initialBet,
                betAmount: initialBet,
                totalScore: highestScore,
                roundsWon: 0,
                eliminated: false,
                rejoinCount: 0,
                lastEliminatedRound: null,
                rejoinRounds: []
            };

            // Fill previous rounds with '-' for this player
            roundScores.forEach(round => {
                round[name] = '-';
            });

            players.push(newPlayer);
            nameInput.value = '';
            errorBox.classList.add('hidden');

            updateScoreForm();
            updateLeaderboard();
            saveGameState();
        }

        function resetGame() {
            if (isReadOnly) return;
            if (gameStarted) {
                saveGameHistory();
                gameEnded = false;
            }
            players = [];
            round = 1;
            roundScores = [];
            gameStarted = false;
            TARGET_SCORE = null;
            REJOIN_THRESHOLD = null;
            gameName = '';
            startDateTime = null;
            isEditing = false;
            els.playerSetup.classList.remove('hidden');
            els.scoreInput.classList.add('hidden');
            els.gameOver.classList.add('hidden');
            els.targetScore.disabled = false;
            els.targetScore.value = '';
            els.targetDisplay.classList.add('hidden');
            els.playerError.classList.add('hidden');
            // ✅ Hide Add Extra Player controls
            els.extraPlayerControls.classList.add('hidden');
            updatePlayerList();
            updateLeaderboard();
            localStorage.removeItem('rummyGameState');
            updateGameHistory();
        }

        // Load game state on page load
        loadGameState();


function restoreCurrentGame() {
    const backup = localStorage.getItem("rummyTempGameBackup");
    if (backup) {
        localStorage.setItem("rummyGameState", backup);
        location.reload();
    } else {
        alert("No active game to return to.");
    }
}
