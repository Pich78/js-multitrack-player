// app.js

let audioContext;
let player;
let audioFiles = {}; // Stores decoded AudioBuffers by their simplified name (e.g., 'itotele-open')

// Expected file names (without .wav extension)
const EXPECTED_FILE_NAMES = [
    'itotele-open', 'itotele-slap', 'iya-open',
    'iya-slap', 'okonkolo-open', 'okonkolo-slap'
];

const trackOrder = ['okonkolo', 'itotele', 'iya']; // Order for displaying tracks

// Initial grid data will now map to keys in the audioFiles object
const initialGridData = {
    'okonkolo': {
        0: 'okonkolo-open',
        4: 'okonkolo-open',
        8: 'okonkolo-open',
        12: 'okonkolo-open',
        2: 'okonkolo-slap',
        6: 'okonkolo-slap',
        10: 'okonkolo-slap',
        14: 'okonkolo-slap',
    },
    'itotele': {
        2: 'itotele-open',
        6: 'itotele-open',
        10: 'itotele-open',
        14: 'itotele-open',
        0: 'itotele-slap',
        4: 'itotele-slap',
        8: 'itotele-slap',
        12: 'itotele-slap',
    },
    'iya': {
        0: 'iya-open',
        8: 'iya-open',
        4: 'iya-slap',
        12: 'iya-slap',
    }
};

const ui = {
    audioFileInput: document.getElementById('audio-file-input'),
    // loadFilesBtn: document.getElementById('load-files-btn'), // Rimosso
    loadingStatus: document.getElementById('loading-status'),
    playBtn: document.getElementById('play-btn'),
    pauseBtn: document.getElementById('pause-btn'),
    stopBtn: document.getElementById('stop-btn'),
    bpmSlider: document.getElementById('bpm-slider'),
    bpmValue: document.getElementById('bpm-value'),
    masterVolumeSlider: document.getElementById('master-volume-slider'),
    masterVolumeValue: document.getElementById('master-volume-value'),
    loopToggle: document.getElementById('loop-toggle'),
    gridContainer: document.getElementById('grid-container')
};

// --- Audio Loading Functions ---
async function decodeAudioFile(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        return audioBuffer;
    } catch (e) {
        console.error(`Error decoding audio file ${file.name}:`, e);
        return null;
    }
}

async function handleFileSelection() {
    const files = ui.audioFileInput.files;
    if (files.length === 0) {
        ui.loadingStatus.textContent = 'Nessun file selezionato.';
        ui.playBtn.disabled = true; // Ensure play button is disabled if no files
        return;
    }

    ui.loadingStatus.textContent = 'Caricamento file...';
    ui.audioFileInput.disabled = true; // Disable input during loading

    let loadedCount = 0;
    let missingFiles = new Set(EXPECTED_FILE_NAMES);
    audioFiles = {}; // Clear previously loaded files on new selection

    for (const file of files) {
        // Extract base name without extension for comparison
        const fileNameWithoutExt = file.name.split('.').slice(0, -1).join('.');
        if (EXPECTED_FILE_NAMES.includes(fileNameWithoutExt)) {
            const buffer = await decodeAudioFile(file);
            if (buffer) {
                audioFiles[fileNameWithoutExt] = buffer;
                missingFiles.delete(fileNameWithoutExt);
                loadedCount++;
            }
        } else {
            console.warn(`File non atteso: ${file.name}. Verrà ignorato.`);
        }
    }

    if (missingFiles.size > 0) {
        ui.loadingStatus.textContent = `Errore: Mancano i seguenti file: ${Array.from(missingFiles).map(name => `${name}.wav`).join(', ')}`;
        ui.playBtn.disabled = true;
    } else if (loadedCount === EXPECTED_FILE_NAMES.length) {
        ui.loadingStatus.textContent = 'Tutti i file WAV caricati con successo! Pronto per la riproduzione.';
        initializePlayerWithGrid(); // Initialize/re-initialize player with new grid
        ui.playBtn.disabled = false; // Enable play button
    } else {
        ui.loadingStatus.textContent = `Caricati ${loadedCount}/${EXPECTED_FILE_NAMES.length} file. Riprova.`;
        ui.playBtn.disabled = true;
    }

    ui.audioFileInput.disabled = false; // Re-enable input after loading attempt
}

// --- Grid UI Rendering ---
function renderGrid() {
    ui.gridContainer.innerHTML = ''; // Clear existing grid

    // Determine max columns for grid layout
    let maxCols = 0;
    player.getTracks().forEach(track => {
        track.cells.forEach((buffer, colIndex) => {
            if (colIndex >= maxCols) {
                maxCols = colIndex + 1;
            }
        });
    });
    const numberOfColumns = maxCols > 0 ? maxCols : 16; // Default to 16 if no audio yet

    // Create column headers
    const headerRow = document.createElement('div');
    headerRow.classList.add('grid-row');
    headerRow.style.gridTemplateColumns = `minmax(100px, 1fr) repeat(${numberOfColumns}, minmax(50px, 1fr)) 100px`; // Label + cells + volume control
    const emptyHeader = document.createElement('div');
    emptyHeader.classList.add('grid-label');
    emptyHeader.textContent = 'Col/Beat';
    headerRow.appendChild(emptyHeader);
    for (let i = 0; i < numberOfColumns; i++) {
        const colHeader = document.createElement('div');
        colHeader.classList.add('grid-cell');
        colHeader.textContent = i; // Column index
        headerRow.appendChild(colHeader);
    }
    const volHeader = document.createElement('div');
    volHeader.classList.add('grid-label');
    volHeader.textContent = 'Vol';
    headerRow.appendChild(volHeader);
    ui.gridContainer.appendChild(headerRow);

    // Render tracks
    trackOrder.forEach(trackId => {
        const trackData = player.getTracks().get(trackId);
        if (!trackData) return; // Skip if track not added

        const rowElement = document.createElement('div');
        rowElement.classList.add('grid-row');
        rowElement.style.gridTemplateColumns = `minmax(100px, 1fr) repeat(${numberOfColumns}, minmax(50px, 1fr)) minmax(80px, 1fr)`;

        const labelElement = document.createElement('div');
        labelElement.classList.add('grid-label');
        labelElement.textContent = trackId.charAt(0).toUpperCase() + trackId.slice(1); // Capitalize
        rowElement.appendChild(labelElement);

        for (let i = 0; i < numberOfColumns; i++) {
            const cellElement = document.createElement('div');
            cellElement.classList.add('grid-cell');
            cellElement.dataset.trackId = trackId;
            cellElement.dataset.columnIndex = i;

            if (trackData.cells.has(i)) {
                const audioBuffer = trackData.cells.get(i);
                // Find the key in audioFiles map that matches this audioBuffer
                const fileName = Object.keys(audioFiles).find(key => audioFiles[key] === audioBuffer);
                cellElement.textContent = fileName ? fileName.replace('-', ' ') : 'Sound';
                cellElement.classList.add('filled');
            } else {
                cellElement.textContent = '';
            }
            rowElement.appendChild(cellElement);
        }

        // Add track volume control
        const trackVolumeControl = document.createElement('div');
        trackVolumeControl.classList.add('track-volume-control');
        const volLabel = document.createElement('label');
        volLabel.textContent = `${trackId} Vol`;
        const volSlider = document.createElement('input');
        volSlider.type = 'range';
        volSlider.min = '0';
        volSlider.max = '100';
        // Get current track volume from player and convert to slider value
        const currentTrackVolume = player.getTracks().get(trackId).gainNode.gain.value;
        volSlider.value = Math.round(currentTrackVolume * 100);
        volSlider.dataset.trackId = trackId;
        volSlider.addEventListener('input', (e) => {
            const vol = parseFloat(e.target.value) / 100;
            player.setTrackVolume(trackId, vol);
        });
        trackVolumeControl.append(volLabel, volSlider);
        rowElement.appendChild(trackVolumeControl);

        ui.gridContainer.appendChild(rowElement);
    });
}


// --- Player Initialization and Grid Setup ---
function initializePlayer() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    player = new MultiTrackPlayer(audioContext);

    // Initial UI updates
    updateUIControls();

    // Event Listeners for Player
    player.addEventListener('gridCellChanged', (e) => {
        const { columnIndex } = e.detail;
        updateActiveCellUI(columnIndex);
    });
    player.addEventListener('stop', () => {
        updateActiveCellUI(-1); // Clear active cell
        updateUIControls();
    });
    player.addEventListener('play', () => updateUIControls());
    player.addEventListener('pause', () => updateUIControls());
    player.addEventListener('bpmChanged', (e) => {
        ui.bpmValue.textContent = e.detail.bpm;
        ui.bpmSlider.value = e.detail.bpm;
        updateUIControls();
    });
    player.addEventListener('masterVolumeChanged', (e) => {
        ui.masterVolumeValue.textContent = `${Math.round(e.detail.volume * 100)}%`;
        ui.masterVolumeSlider.value = Math.round(e.detail.volume * 100);
    });
    player.addEventListener('loopingChanged', (e) => {
        ui.loopToggle.checked = e.detail.loop;
    });

    console.log('MultiTrackPlayer initialized. Waiting for audio files.');
}

function initializePlayerWithGrid() {
    // Clear previous grid data if any, useful if files are reloaded
    player.stop(); // Ensure player is stopped before reconfiguring
    player.getTracks().forEach((_, trackId) => player.removeTrack(trackId)); // Remove all existing tracks

    // Setup initial tracks and grid data with loaded audio buffers
    trackOrder.forEach(trackId => {
        player.addTrack(trackId);
        const trackData = initialGridData[trackId];
        if (trackData) {
            for (const colIndex in trackData) {
                const audioKey = trackData[colIndex];
                if (audioFiles[audioKey]) {
                    player.addAudioToGrid(trackId, parseInt(colIndex), audioFiles[audioKey]);
                } else {
                    console.warn(`Audio file ${audioKey}.wav not found in loaded files for track ${trackId} at column ${colIndex}`);
                }
            }
        }
    });
    // Rimuovi il testo segnaposto se presente
    const placeholder = ui.gridContainer.querySelector('.placeholder-text');
    if (placeholder) {
        placeholder.remove();
    }
    renderGrid(); // Render grid with loaded files
    updateUIControls();
    console.log('Player configured with initial grid data.');
}


// --- UI Interaction and Updates ---
function updateActiveCellUI(newColumnIndex) {
    // Remove 'active' class from all cells
    document.querySelectorAll('.grid-cell.active').forEach(cell => {
        cell.classList.remove('active');
    });

    if (newColumnIndex >= 0) {
        // Add 'active' class to cells in the new active column (except header)
        document.querySelectorAll(`.grid-cell[data-column-index="${newColumnIndex}"]`).forEach(cell => {
            cell.classList.add('active');
        });
        // Scroll the grid to keep the active column in view if needed
        const activeCell = document.querySelector(`.grid-cell[data-column-index="${newColumnIndex}"]`);
        if (activeCell) {
            const gridContainer = ui.gridContainer;
            const cellLeft = activeCell.offsetLeft;
            const cellWidth = activeCell.offsetWidth;
            const containerScrollLeft = gridContainer.scrollLeft;
            const containerWidth = gridContainer.offsetWidth;

            if (cellLeft < containerScrollLeft) {
                gridContainer.scrollLeft = cellLeft - 50; // Scroll left, with some padding
            } else if (cellLeft + cellWidth > containerScrollLeft + containerWidth) {
                gridContainer.scrollLeft = cellLeft + cellWidth - containerWidth + 50; // Scroll right, with some padding
            }
        }
    }
}

function updateUIControls() {
    const status = player.getStatus();
    const isPlayingOrPaused = status.isPlaying || status.isPaused;
    const areFilesLoaded = Object.keys(audioFiles).length === EXPECTED_FILE_NAMES.length;

    ui.playBtn.disabled = status.isPlaying || !areFilesLoaded;
    ui.pauseBtn.disabled = !status.isPlaying;
    ui.stopBtn.disabled = !isPlayingOrPaused;

    // Disable BPM and other settings when playing or paused
    ui.bpmSlider.disabled = isPlayingOrPaused || !areFilesLoaded;
    // Track volume sliders
    document.querySelectorAll('.track-volume-control input[type="range"]').forEach(slider => {
        slider.disabled = !areFilesLoaded; // Only enable if files are loaded
    });
}

// --- Event Listeners for UI Controls ---
ui.playBtn.addEventListener('click', () => {
    // Resume AudioContext on first user interaction if it's suspended
    if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            player.play();
        }).catch(e => console.error("Failed to resume AudioContext:", e));
    } else {
        player.play();
    }
});
ui.pauseBtn.addEventListener('click', () => player.pause());
ui.stopBtn.addEventListener('click', () => player.stop());

ui.bpmSlider.addEventListener('input', (e) => {
    const newBPM = parseInt(e.target.value, 10);
    ui.bpmValue.textContent = newBPM;
});
ui.bpmSlider.addEventListener('change', (e) => {
    const newBPM = parseInt(e.target.value, 10);
    player.setBPM(newBPM);
});

ui.masterVolumeSlider.addEventListener('input', (e) => {
    const volume = parseInt(e.target.value, 10) / 100;
    ui.masterVolumeValue.textContent = `${e.target.value}%`;
    player.setMasterVolume(volume);
});

ui.loopToggle.addEventListener('change', (e) => {
    player.setLooping(e.target.checked);
});

// Listener per il cambio di selezione dei file, che ora avvia il caricamento
ui.audioFileInput.addEventListener('change', handleFileSelection);


// Initialize the application when the DOM is ready
document.addEventListener('DOMContentLoaded', initializePlayer);