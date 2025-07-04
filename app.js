// app.js

let audioContext;
let player;
let audioFiles = {}; // Stores decoded AudioBuffers by their simplified name (e.g., 'itotele-open')
let selectedSoundType = null; // 'open', 'slap', or 'combined'

// Expected file names (without .wav extension)
const EXPECTED_FILE_NAMES = [
    'itotele-open', 'itotele-slap', 'iya-open',
    'iya-slap', 'okonkolo-open', 'okonkolo-slap'
];

const trackOrder = ['okonkolo', 'itotele', 'iya']; // Order for displaying tracks

// Initial grid data will be empty now, filled by user interaction
let currentGridState = new Map(); // Map<trackId, Map<columnIndex, soundType>>

// Store track mute states and last non-muted volumes
const trackMuteStates = new Map(); // Map<trackId, boolean>
const trackLastVolumes = new Map(); // Map<trackId, number> (0.0 to 1.0)

// Define color palettes for each instrument
const instrumentColors = {
    okonkolo: {
        dark: '#C62828', // Dark Red
        light: '#EF9A9A' // Light Red
    },
    itotele: {
        dark: '#FBC02D', // Dark Yellow
        light: '#FFF59D' // Light Yellow
    },
    iya: {
        dark: '#1565C0', // Dark Blue
        light: '#90CAF9' // Light Blue
    },
    muted: {
        dark: '#757575', // Gray
        light: '#BDBDBD' // Lighter Gray
    }
};

// Define the volume multiplier for the slap sound in combined hits
const SLAP_VOLUME_MULTIPLIER = 3.0;

const ui = {
    audioFileInput: document.getElementById('audio-file-input'),
    chooseFilesBtn: document.getElementById('choose-files-btn'), // Updated button reference
    loadingStatus: document.getElementById('loading-status'),
    playBtn: document.getElementById('play-btn'),
    pauseBtn: document.getElementById('pause-btn'),
    stopBtn: document.getElementById('stop-btn'),
    bpmSlider: document.getElementById('bpm-slider'),
    bpmValue: document.getElementById('bpm-value'),
    masterVolumeSlider: document.getElementById('master-volume-slider'),
    masterVolumeValue: document.getElementById('master-volume-value'),
    loopToggle: document.getElementById('loop-toggle'),
    gridContainer: document.getElementById('grid-container'),

    // New UI elements for grid settings
    timeNumeratorInput: document.getElementById('time-numerator'),
    timeDenominatorInput: document.getElementById('time-denominator'),
    subdivisionSelector: document.getElementById('subdivision-selector'),
    applyGridSettingsBtn: document.getElementById('apply-grid-settings-btn'),
    clearGridBtn: document.getElementById('clear-grid-btn'), // New button reference

    // New UI elements for sound selection (no direct change needed here, just HTML structure)
    soundSymbols: document.querySelectorAll('.sound-symbol')
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
        ui.loadingStatus.textContent = 'No files selected.';
        ui.playBtn.disabled = true; // Ensure play button is disabled if no files
        return;
    }

    ui.loadingStatus.textContent = 'Loading files...';
    ui.audioFileInput.disabled = true; // Disable input during loading
    ui.chooseFilesBtn.disabled = true; // Disable custom button during loading

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
            console.warn(`Unexpected file: ${file.name}. It will be ignored.`);
        }
    }

    if (missingFiles.size > 0) {
        ui.loadingStatus.textContent = `Error: Missing the following files: ${Array.from(missingFiles).map(name => `${name}.wav`).join(', ')}`;
        ui.playBtn.disabled = true;
    } else if (loadedCount === EXPECTED_FILE_NAMES.length) {
        ui.loadingStatus.textContent = 'All WAV files loaded successfully! Ready for playback.';
        // After files are loaded, populate the player's grid with current UI state
        // This also re-renders the grid UI to show symbols if they were placed before loading
        updatePlayerGridDataAndRenderUI();
        ui.playBtn.disabled = false; // Enable play button
        console.log('Player initialized. All audio files loaded.');
    } else {
        ui.loadingStatus.textContent = `Loaded ${loadedCount}/${EXPECTED_FILE_NAMES.length} files. Please try again.`;
        ui.playBtn.disabled = true;
    }

    ui.audioFileInput.disabled = false; // Re-enable input after loading attempt
    ui.chooseFilesBtn.disabled = false; // Re-enable custom button after loading attempt
}

// --- Grid UI Rendering ---
function renderGrid() {
    ui.gridContainer.innerHTML = ''; // Clear existing grid

    // Get current grid settings from UI
    const timeNumerator = parseInt(ui.timeNumeratorInput.value, 10);
    const timeDenominator = parseInt(ui.timeDenominatorInput.value, 10);
    const subdivisionNoteValue = parseInt(ui.subdivisionSelector.value, 10);

    // Update player with current settings (should be in stop state)
    player.setTimeSignature(timeNumerator, timeDenominator);
    player.setSubdivisionNoteValue(subdivisionNoteValue);

    const numberOfColumns = player._getMaxColumns(); // Get calculated columns from player

    // Calculate cells per beat for visual markers based on simple vs. compound meter
    let cellsPerBeat = 1;
    if (timeDenominator > 0 && subdivisionNoteValue > 0) {
        // Simple meter: beat is typically the denominator (e.g., quarter note in 4/4)
        // Compound meter: beat is typically a dotted note (e.g., dotted quarter in 6/8)
        const isCompoundMeter = (timeDenominator === 8 && (timeNumerator === 6 || timeNumerator === 9 || timeNumerator === 12));

        if (isCompoundMeter) {
            // For compound meters (e.g., 6/8, 9/8, 12/8), the main beat is a dotted quarter note.
            // A dotted quarter note is equivalent to three eighth notes.
            // So, cells per beat = (subdivision notes per eighth note) * 3
            cellsPerBeat = (subdivisionNoteValue / 8) * 3;
        } else {
            // For simple meters, the beat is directly related to the denominator.
            cellsPerBeat = subdivisionNoteValue / timeDenominator;
        }
    }
    // Ensure cellsPerBeat is a positive integer for modulo operation
    cellsPerBeat = Math.max(1, Math.round(cellsPerBeat));


    // Initialize currentGridState for new grid dimensions
    // Preserve existing placements if the grid size allows
    const newGridState = new Map();
    trackOrder.forEach(trackId => {
        newGridState.set(trackId, new Map());
        if (currentGridState.has(trackId)) {
            const oldTrackCells = currentGridState.get(trackId);
            for (let i = 0; i < numberOfColumns; i++) {
                if (oldTrackCells.has(i)) {
                    newGridState.get(trackId).set(i, oldTrackCells.get(i));
                }
            }
        }
    });
    currentGridState = newGridState;


    // Render tracks
    trackOrder.forEach(trackId => {
        const rowElement = document.createElement('div');
        rowElement.classList.add('grid-row');
        // Grid layout: first column for track control cell, then cells
        rowElement.style.gridTemplateColumns = `minmax(100px, 1fr) repeat(${numberOfColumns}, minmax(50px, 1fr))`;

        // Create the smart track control cell
        const trackControlCell = document.createElement('div');
        trackControlCell.classList.add('track-control-cell', `${trackId}-color`);
        trackControlCell.dataset.trackId = trackId;
        trackControlCell.textContent = trackId.charAt(0).toUpperCase() + trackId.slice(1); // Capitalize
        trackControlCell.tabIndex = 0; // Make it focusable for keyboard events


        // Initialize mute state and last volume if not already set
        if (!trackMuteStates.has(trackId)) {
            trackMuteStates.set(trackId, false); // Not muted by default
        }
        if (!trackLastVolumes.has(trackId)) {
            trackLastVolumes.set(trackId, 1.0); // Full volume by default
        }

        // Apply initial visual state (color and mute status)
        updateTrackControlCellVisuals(trackId, player.getTracks().get(trackId)?.gainNode?.gain?.value || 1.0, trackMuteStates.get(trackId));

        // Add event listeners for mute/unmute (click) and volume control (drag + keyboard)
        let isDraggingVolume = false;
        let startX = 0; // Changed to startX for horizontal drag
        let initialVolume = 0;

        trackControlCell.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click
                isDraggingVolume = true;
                startX = e.clientX; // Changed to clientX
                initialVolume = player.getTracks().get(trackId)?.gainNode?.gain?.value || 1.0;
                trackControlCell.style.cursor = 'ew-resize'; // Changed cursor to east-west resize
                e.preventDefault(); // Prevent text selection during drag
            }
        });

        // Use document for mousemove and mouseup to allow dragging outside the element
        document.addEventListener('mousemove', (e) => {
            if (isDraggingVolume) {
                const deltaX = e.clientX - startX; // Changed to deltaX
                // Sensitivity: adjust this value to make the slider more or less sensitive
                const sensitivity = 0.005;
                let newVolume = initialVolume + deltaX * sensitivity; // Dragging right increases volume

                // Clamp volume between 0 and 1
                newVolume = Math.max(0, Math.min(1, newVolume));

                player.setTrackVolume(trackId, newVolume);
                trackLastVolumes.set(trackId, newVolume); // Update last non-muted volume
                if (trackMuteStates.get(trackId)) { // If muted, unmute it when volume is changed by dragging
                    player.setTrackMuted(trackId, false);
                    trackMuteStates.set(trackId, false);
                }
                updateTrackControlCellVisuals(trackId, newVolume, trackMuteStates.get(trackId));
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDraggingVolume) {
                isDraggingVolume = false;
                trackControlCell.style.cursor = 'pointer'; // Restore cursor
            }
        });

        // Keyboard control for volume
        trackControlCell.addEventListener('keydown', (e) => {
            const step = 0.05; // Volume adjustment step
            let currentVolume = player.getTracks().get(trackId)?.gainNode?.gain?.value || 1.0;
            let newVolume = currentVolume;

            if (e.key === 'ArrowRight') {
                newVolume = Math.min(1, currentVolume + step);
                e.preventDefault(); // Prevent page scrolling
            } else if (e.key === 'ArrowLeft') {
                newVolume = Math.max(0, currentVolume - step);
                e.preventDefault(); // Prevent page scrolling
            }

            if (newVolume !== currentVolume) {
                player.setTrackVolume(trackId, newVolume);
                trackLastVolumes.set(trackId, newVolume);
                if (trackMuteStates.get(trackId)) {
                    player.setTrackMuted(trackId, false);
                    trackMuteStates.set(trackId, false);
                }
                updateTrackControlCellVisuals(trackId, newVolume, trackMuteStates.get(trackId));
            }
        });

        trackControlCell.addEventListener('click', (e) => {
            // Prevent click from firing if it was part of a drag operation
            // A simple way is to check if mousemove happened significantly
            if (Math.abs(e.clientX - startX) < 5 && !isDraggingVolume) { // Threshold of 5 pixels for horizontal drag
                const isMuted = trackMuteStates.get(trackId);
                const newMuteState = !isMuted;
                player.setTrackMuted(trackId, newMuteState);
                trackMuteStates.set(trackId, newMuteState);
                updateTrackControlCellVisuals(trackId, player.getTracks().get(trackId)?.gainNode?.gain?.value || 1.0, newMuteState);
            }
        });

        rowElement.appendChild(trackControlCell);


        for (let i = 0; i < numberOfColumns; i++) {
            const cellElement = document.createElement('div');
            cellElement.classList.add('grid-cell');
            cellElement.dataset.trackId = trackId;
            cellElement.dataset.columnIndex = i;

            // Add beat-marker class for visual separators
            if (cellsPerBeat > 0 && i % cellsPerBeat === 0) {
                cellElement.classList.add('beat-marker');
            }

            const soundTypeInCell = currentGridState.get(trackId)?.get(i);
            if (soundTypeInCell) {
                cellElement.classList.add('filled');
                // Add symbol based on soundTypeInCell
                const symbolDiv = document.createElement('div');
                symbolDiv.classList.add('cell-symbol', soundTypeInCell); // Add 'open', 'slap', or 'combined' class
                cellElement.appendChild(symbolDiv);
            } else {
                cellElement.textContent = '';
            }
            cellElement.addEventListener('click', handleGridCellClick);
            rowElement.appendChild(cellElement);
        }

        ui.gridContainer.appendChild(rowElement);
    });

    // Remove placeholder text if present
    const placeholder = ui.gridContainer.querySelector('.placeholder-text');
    if (placeholder) {
        placeholder.remove();
    }
    updateUIControls();
}

/**
 * Updates the visual appearance of a track control cell based on its volume and mute state.
 * Uses a linear gradient to show volume percentage.
 * @param {string} trackId The ID of the track.
 * @param {number} volume The current volume (0.0 to 1.0).
 * @param {boolean} isMuted The current mute state.
 */
function updateTrackControlCellVisuals(trackId, volume, isMuted) {
    const trackControlCell = document.querySelector(`.track-control-cell[data-track-id="${trackId}"]`);
    if (!trackControlCell) return;

    const colors = instrumentColors[trackId];
    const darkColor = colors.dark;
    const lightColor = colors.light;

    if (isMuted) {
        trackControlCell.classList.add('muted');
        trackControlCell.style.background = ''; // Clear gradient
    } else {
        trackControlCell.classList.remove('muted');
        const volumePercentage = Math.round(volume * 100);
        trackControlCell.style.background = `linear-gradient(to right, ${darkColor} ${volumePercentage}%, ${lightColor} ${volumePercentage}%)`;
    }
}


// Updates the player component's grid data and re-renders the UI grid
function updatePlayerGridDataAndRenderUI() {
    player.stop(); // Ensure player is stopped before updating grid data

    // Clear all existing audio from player
    player.getTracks().forEach(track => {
        track.cells.clear();
    });

    // Add audio to player based on currentGridState
    currentGridState.forEach((trackCells, trackId) => {
        trackCells.forEach((soundType, columnIndex) => {
            let audioDataToPass;
            if (soundType === 'combined') {
                // For combined sound, pass an object with both open and slap buffers
                const openBuffer = audioFiles[`${trackId}-open`];
                const slapBuffer = audioFiles[`${trackId}-slap`];
                if (openBuffer && slapBuffer) {
                    // Pass an object with named properties for clarity in MultiTrackPlayer
                    audioDataToPass = { open: openBuffer, slap: slapBuffer, slapMultiplier: SLAP_VOLUME_MULTIPLIER };
                } else {
                    console.error(`Cannot place combined sound: Missing required audio buffers for ${trackId}.`);
                    return;
                }
            } else {
                // For 'open' or 'slap', pass the single buffer
                const singleBuffer = audioFiles[`${trackId}-${soundType}`];
                if (singleBuffer) {
                    audioDataToPass = singleBuffer;
                } else {
                    console.error(`Cannot place ${selectedSoundType} sound: Missing audio buffer for ${trackId}-${selectedSoundType}.`);
                    return;
                }
            }
            player.addAudioToGrid(trackId, columnIndex, audioDataToPass);
        });
    });
    renderGrid(); // Re-render the UI grid to reflect currentGridState
}


// --- Player Initialization ---
function initializePlayer() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    player = new MultiTrackPlayer(audioContext);

    // Set BPM slider min value here
    ui.bpmSlider.min = 30; // Set minimum BPM to 30

    // Set initial grid settings in UI
    ui.timeNumeratorInput.value = player.getTimeSignature().numerator;
    ui.timeDenominatorInput.value = player.getTimeSignature().denominator;
    ui.subdivisionSelector.value = player.getSubdivisionNoteValue();

    // Add initial tracks to the player (these are always present)
    trackOrder.forEach(trackId => {
        player.addTrack(trackId);
    });

    // Render the grid immediately on startup with default settings
    renderGrid();

    // Initial UI updates
    updateUIControls();

    console.log('MultiTrackPlayer initialized. Grid rendered. Waiting for audio files.');

    // Event Listeners for Player
    player.addEventListener('gridCellChanged', (e) => {
        // console.log('gridCellChanged event RECEIVED in app.js!', e.detail.columnIndex);
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
    // Listen for track volume changes from player (e.g., if we add other ways to change volume)
    player.addEventListener('trackVolumeChanged', (e) => {
        const { trackId, volume } = e.detail;
        trackLastVolumes.set(trackId, volume); // Keep track of last volume
        updateTrackControlCellVisuals(trackId, volume, trackMuteStates.get(trackId));
    });
    // Listen for track mute changes from player
    player.addEventListener('trackMuteChanged', (e) => {
        const { trackId, isMuted } = e.detail;
        trackMuteStates.set(trackId, isMuted);
        updateTrackControlCellVisuals(trackId, player.getTracks().get(trackId)?.gainNode?.gain?.value || 1.0, isMuted);
    });
}

// --- UI Interaction and Updates ---
function updateActiveCellUI(newColumnIndex) {
    // console.log(`updateActiveCellUI called with index: ${newColumnIndex}`);
    // Remove 'active' class from all cells
    document.querySelectorAll('.grid-cell.active').forEach(cell => {
        cell.classList.remove('active');
    });

    if (newColumnIndex >= 0) {
        // Add 'active' class to cells in the new active column
        const cellsToHighlight = document.querySelectorAll(`.grid-cell[data-column-index="${newColumnIndex}"]`);
        // console.log(`Found ${cellsToHighlight.length} cells for column ${newColumnIndex}`);
        cellsToHighlight.forEach(cell => {
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

    // console.log(`updateUIControls: isPlaying=${status.isPlaying}, isPaused=${status.isPaused}, areFilesLoaded=${areFilesLoaded}`);

    // Playback controls
    ui.playBtn.disabled = status.isPlaying || !areFilesLoaded;
    ui.pauseBtn.disabled = !status.isPlaying;
    ui.stopBtn.disabled = !isPlayingOrPaused;

    // Grid settings controls - these can be adjusted even if files are not loaded
    ui.bpmSlider.disabled = isPlayingOrPaused || !areFilesLoaded; // BPM still needs files to affect playback
    ui.timeNumeratorInput.disabled = isPlayingOrPaused;
    ui.timeDenominatorInput.disabled = isPlayingOrPaused;
    ui.subdivisionSelector.disabled = isPlayingOrPaused;
    ui.applyGridSettingsBtn.disabled = isPlayingOrPaused;
    ui.clearGridBtn.disabled = isPlayingOrPaused; // Clear grid can be done visually even without files

    // Track volume sliders (no longer separate, handled by smart cells)
    // document.querySelectorAll('.track-volume-control input[type="range"]').forEach(slider => {
    //     slider.disabled = !areFilesLoaded; // Only enable if files are loaded
    // });

    // Sound selection symbols
    ui.soundSymbols.forEach(symbol => {
        symbol.classList.toggle('disabled', !areFilesLoaded);
        symbol.style.cursor = areFilesLoaded ? 'pointer' : 'not-allowed';
    });
    // Grid cells should also be disabled for clicks if files not loaded
    document.querySelectorAll('.grid-cell').forEach(cell => {
        cell.style.cursor = areFilesLoaded ? 'pointer' : 'not-allowed';
    });
}

// --- Sound Selection Logic ---
ui.soundSymbols.forEach(symbol => {
    symbol.addEventListener('click', (event) => {
        // Find the actual sound-symbol div, not the caption if clicked
        const targetSymbol = event.currentTarget.closest('.sound-symbols').querySelector('.sound-symbol');
        if (!targetSymbol) return; // Should not happen if structure is correct

        if (!Object.keys(audioFiles).length === EXPECTED_FILE_NAMES.length) {
            console.warn("Please load all audio files first.");
            return;
        }

        const type = targetSymbol.dataset.soundType;
        if (selectedSoundType === type) {
            // Deselect if already selected
            selectedSoundType = null;
            document.querySelectorAll('.sound-symbol').forEach(s => s.classList.remove('selected')); // Deselect all
        } else {
            // Deselect others and select this one
            document.querySelectorAll('.sound-symbol').forEach(s => s.classList.remove('selected'));
            selectedSoundType = type;
            targetSymbol.classList.add('selected');
        }
    });
});

// --- Grid Cell Click Logic ---
function handleGridCellClick(event) {
    if (!Object.keys(audioFiles).length === EXPECTED_FILE_NAMES.length) {
        console.warn("Please load all audio files first.");
        return;
    }
    if (player.getStatus().isPlaying || player.getStatus().isPaused) {
        console.warn("Cannot modify grid while playing or paused. Please stop the player first.");
        return;
    }

    const cell = event.currentTarget;
    const trackId = cell.dataset.trackId;
    const columnIndex = parseInt(cell.dataset.columnIndex, 10);

    if (selectedSoundType) {
        const currentSoundTypeInCell = currentGridState.get(trackId)?.get(columnIndex);

        if (currentSoundTypeInCell === selectedSoundType) {
            // If same symbol clicked, remove it
            currentGridState.get(trackId).delete(columnIndex);
            player.removeAudioFromGrid(trackId, columnIndex); // Remove from player
            cell.classList.remove('filled');
            cell.innerHTML = ''; // Clear symbol
            console.log(`Removed ${selectedSoundType} from ${trackId} at column ${columnIndex}`);
        } else {
            // Place new symbol (or replace existing different one)
            currentGridState.get(trackId).set(columnIndex, selectedSoundType);
            
            let audioDataToPass;
            if (selectedSoundType === 'combined') {
                const openBuffer = audioFiles[`${trackId}-open`];
                const slapBuffer = audioFiles[`${trackId}-slap`];
                if (openBuffer && slapBuffer) {
                    // Pass an object with named properties for clarity in MultiTrackPlayer
                    audioDataToPass = { open: openBuffer, slap: slapBuffer, slapMultiplier: SLAP_VOLUME_MULTIPLIER };
                } else {
                    console.error(`Cannot place combined sound: Missing required audio buffers for ${trackId}.`);
                    return;
                }
            } else {
                const singleBuffer = audioFiles[`${trackId}-${selectedSoundType}`];
                if (singleBuffer) {
                    audioDataToPass = singleBuffer;
                } else {
                    console.error(`Cannot place ${selectedSoundType} sound: Missing audio buffer for ${trackId}-${selectedSoundType}.`);
                    return;
                }
            }

            player.addAudioToGrid(trackId, columnIndex, audioDataToPass); // Add to player
            cell.classList.add('filled');
            cell.innerHTML = ''; // Clear previous symbol/text
            const symbolDiv = document.createElement('div');
            symbolDiv.classList.add('cell-symbol', selectedSoundType);
            cell.appendChild(symbolDiv);
            console.log(`Placed ${selectedSoundType} on ${trackId} at column ${columnIndex}`);
        }
    } else {
        console.log("No sound type selected. Click a symbol (circle/triangle/combined) first.");
    }
}

// --- Clear Grid Logic ---
function handleClearGrid() {
    if (player.getStatus().isPlaying || player.getStatus().isPaused) {
        console.warn("Cannot clear grid while playing or paused. Please stop the player first.");
        return;
    }
    // No need to check !areFilesLoaded here, as clearing the visual grid is always possible.

    // Clear the internal grid state
    currentGridState.forEach(trackCells => trackCells.clear());

    // Stop player and clear its internal audio buffers
    player.stop();
    player.getTracks().forEach(track => track.cells.clear());

    // Re-render the grid UI to show it's empty
    renderGrid();
    console.log("Grid cleared.");
}


// --- Event Listeners for UI Controls ---
ui.playBtn.addEventListener('click', () => {
    console.log(`Play button clicked. AudioContext state: ${audioContext.state}`); // Debugging log
    // Resume AudioContext on first user interaction if it's suspended
    if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            console.log('AudioContext resumed. Attempting to play...'); // Debugging log
            player.play();
            updateUIControls(); // Explicitly update after play
        }).catch(e => console.error("Failed to resume AudioContext:", e));
    } else {
        player.play();
        updateUIControls(); // Explicitly update after play
    }
});
ui.pauseBtn.addEventListener('click', () => {
    player.pause();
    updateUIControls(); // Explicitly update after pause
});
ui.stopBtn.addEventListener('click', () => {
    player.stop();
    updateUIControls(); // Explicitly update after stop
});

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

ui.chooseFilesBtn.addEventListener('click', () => {
    ui.audioFileInput.click(); // Programmatically click the hidden file input
});

ui.audioFileInput.addEventListener('change', handleFileSelection);

ui.applyGridSettingsBtn.addEventListener('click', () => {
    if (player.getStatus().isPlaying || player.getStatus().isPaused) {
        console.warn("Cannot change grid settings while playing or paused. Please stop the player first.");
        return;
    }
    // Check if files are loaded. If not, only update grid dimensions, not player data.
    const areFilesLoaded = Object.keys(audioFiles).length === EXPECTED_FILE_NAMES.length;
    if (!areFilesLoaded) {
        console.warn("Files not loaded yet. Grid dimensions updated, but no sounds will be placed.");
    }

    const newNumerator = parseInt(ui.timeNumeratorInput.value, 10);
    const newDenominator = parseInt(ui.timeDenominatorInput.value, 10);
    const newSubdivision = parseInt(ui.subdivisionSelector.value, 10);

    // Basic validation
    if (isNaN(newNumerator) || newNumerator <= 0 ||
        isNaN(newDenominator) || newDenominator <= 0 ||
        isNaN(newSubdivision) || ![4, 8, 16, 32].includes(newSubdivision)) {
        console.error("Invalid grid settings. Please check numerator, denominator, and subdivision.");
        return;
    }

    player.setTimeSignature(newNumerator, newDenominator);
    player.setSubdivisionNoteValue(newSubdivision);
    
    // Only update player's internal grid data if files are loaded
    if (areFilesLoaded) {
        updatePlayerGridDataAndRenderUI(); // Update player and re-render grid
    } else {
        renderGrid(); // Just re-render grid dimensions if files not loaded yet
    }
});

ui.clearGridBtn.addEventListener('click', handleClearGrid); // New event listener for clear button


// Initialize the application when the DOM is ready
document.addEventListener('DOMContentLoaded', initializePlayer);
