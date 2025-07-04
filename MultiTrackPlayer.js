// MultiTrackPlayer.js

class MultiTrackPlayer extends EventTarget {
    /**
     * @type {AudioContext}
     */
    audioContext;

    /**
     * @type {GainNode}
     */
    masterGainNode;

    /**
     * Stores track data: { gainNode: GainNode, cells: Map<number, AudioBuffer> }
     * @type {Map<string, { gainNode: GainNode, cells: Map<number, AudioBuffer> }>}
     */
    _tracks = new Map();

    _bpm = 120;
    _timeSignatureNumerator = 4;
    _timeSignatureDenominator = 4;
    _subdivision = 4; // e.g., 4 for 16th notes (4 16ths per beat)
    _loop = true;

    _isPlaying = false;
    _isPaused = false;
    _playbackTime = 0; // Current time in the sequence (in seconds from start)

    _currentCellIndex = -1; // Current column index being played
    _nextCellTime = 0; // audioContext.currentTime when the next cell should start

    _schedulerIntervalId = null;
    _lookAheadTime = 0.1; // seconds, how far ahead to schedule audio
    _scheduleInterval = 0.05; // seconds, how often to check for new notes to schedule

    _scheduledSources = new Set(); // Keep track of scheduled sources to stop them

    /**
     * Creates an instance of MultiTrackPlayer.
     * @param {AudioContext} audioContext - The AudioContext instance to use.
     */
    constructor(audioContext) {
        super();
        this.audioContext = audioContext;

        this.masterGainNode = this.audioContext.createGain();
        this.masterGainNode.connect(this.audioContext.destination);
        this.setMasterVolume(1.0); // Default master volume

        this._startScheduler();
    }

    /**
     * Calculates the duration of a single grid cell in seconds.
     * Based on BPM, time signature, and subdivision.
     * @returns {number} The duration of one cell in seconds.
     * @private
     */
    _calculateCellDuration() {
        const beatsPerSecond = this._bpm / 60;
        const secondsPerBeat = 1 / beatsPerSecond;

        // How many of our 'subdivisions' fit into one beat
        // If subdivision is 4 (16th notes) and time signature is 4/4:
        // A beat is a quarter note. 4 16th notes fit in a quarter note.
        // So, 16th note duration = secondsPerBeat / 4
        // If subdivision is 2 (8th notes) and time signature is 4/4:
        // A beat is a quarter note. 2 8th notes fit in a quarter note.
        // So, 8th note duration = secondsPerBeat / 2
        const subdivisionPerBeat = this._subdivision; // e.g., 4 for 16th notes per beat
        return secondsPerBeat / subdivisionPerBeat;
    }

    /**
     * Starts the internal scheduling loop.
     * @private
     */
    _startScheduler() {
        if (this._schedulerIntervalId) {
            clearInterval(this._schedulerIntervalId);
        }
        this._schedulerIntervalId = setInterval(() => {
            this._scheduleAudio();
        }, this._scheduleInterval * 1000);
    }

    /**
     * Stops the internal scheduling loop.
     * @private
     */
    _stopScheduler() {
        if (this._schedulerIntervalId) {
            clearInterval(this._schedulerIntervalId);
            this._schedulerIntervalId = null;
        }
    }

    /**
     * Schedules audio for playback based on the current time and look-ahead.
     * @private
     */
    _scheduleAudio() {
        if (!this._isPlaying) {
            return;
        }

        const currentTime = this.audioContext.currentTime;
        const cellDuration = this._calculateCellDuration();
        const maxColumns = this._getMaxColumns();

        // Schedule notes in the look-ahead window
        while (this._nextCellTime < currentTime + this._lookAheadTime) {
            if (this._currentCellIndex >= 0) { // Only dispatch if we've started playing
                this.dispatchEvent(new CustomEvent('gridCellChanged', {
                    detail: {
                        columnIndex: this._currentCellIndex,
                        time: this._nextCellTime - cellDuration // Time when this cell actually started
                    }
                }));
            }

            // Move to the next cell
            this._currentCellIndex++;
            if (maxColumns > 0 && this._currentCellIndex >= maxColumns) {
                if (this._loop) {
                    this._currentCellIndex = 0; // Loop back to start
                } else {
                    // Stop if not looping and reached end
                    this.stop();
                    return;
                }
            }

            // Schedule sounds for the current cell
            this._tracks.forEach(track => {
                const audioBuffer = track.cells.get(this._currentCellIndex);
                if (audioBuffer) {
                    const source = this.audioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(track.gainNode);

                    // Store reference to stop it later if needed
                    this._scheduledSources.add(source);
                    source.onended = () => {
                        this._scheduledSources.delete(source);
                    };

                    // Schedule the sound
                    source.start(this._nextCellTime);
                }
            });

            this._nextCellTime += cellDuration;
        }
    }

    /**
     * Determines the maximum number of columns across all tracks.
     * @returns {number} The maximum column index + 1. Returns 0 if no tracks or no audio.
     * @private
     */
    _getMaxColumns() {
        let max = 0;
        this._tracks.forEach(track => {
            track.cells.forEach((buffer, colIndex) => {
                if (colIndex >= max) {
                    max = colIndex + 1; // +1 because index is 0-based
                }
            });
        });
        return max;
    }

    /**
     * Starts playback of the sequence.
     */
    play() {
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        if (this._isPlaying) {
            return;
        }

        if (!this._isPaused) {
            // If not paused, start from beginning
            this._currentCellIndex = -1; // -1 so the first scheduled cell is 0
            this._nextCellTime = this.audioContext.currentTime;
            this._playbackTime = 0;
        }

        this._isPlaying = true;
        this._isPaused = false;
        this.dispatchEvent(new CustomEvent('play'));
        // The scheduler will pick up from here
    }

    /**
     * Pauses playback. Maintains current position.
     */
    pause() {
        if (!this._isPlaying) {
            return;
        }

        this._isPlaying = false;
        this._isPaused = true;

        // Stop all currently playing sounds
        this._scheduledSources.forEach(source => {
            try {
                source.stop();
            } catch (e) {
                // Source might have already ended
            }
        });
        this._scheduledSources.clear();

        // Calculate current playback time for resumption
        const cellDuration = this._calculateCellDuration();
        this._playbackTime = this._currentCellIndex * cellDuration + (this.audioContext.currentTime - (this._nextCellTime - cellDuration));
        if (this._playbackTime < 0) this._playbackTime = 0; // Edge case for very start

        this.dispatchEvent(new CustomEvent('pause'));
    }

    /**
     * Stops playback and resets to the beginning of the sequence.
     */
    stop() {
        if (!this._isPlaying && !this._isPaused) {
            return;
        }

        this._isPlaying = false;
        this._isPaused = false;
        this._currentCellIndex = -1;
        this._playbackTime = 0;

        // Stop all currently playing sounds
        this._scheduledSources.forEach(source => {
            try {
                source.stop();
            } catch (e) {
                // Source might have already ended
            }
        });
        this._scheduledSources.clear();

        this.dispatchEvent(new CustomEvent('stop'));
        this.dispatchEvent(new CustomEvent('gridCellChanged', { detail: { columnIndex: -1, time: 0 } })); // Reset UI
    }

    /**
     * Sets the Beats Per Minute (BPM). Can only be called in Stop state.
     * @param {number} bpm - The new BPM value.
     */
    setBPM(bpm) {
        if (this._isPlaying || this._isPaused) {
            console.warn("Cannot change BPM while playing or paused. Please stop the player first.");
            return;
        }
        if (bpm <= 0) {
            console.error("BPM must be a positive number.");
            return;
        }
        this._bpm = bpm;
        this.dispatchEvent(new CustomEvent('bpmChanged', { detail: { bpm: this._bpm } }));
    }

    /**
     * Sets the time signature. Can only be called in Stop state.
     * @param {number} numerator - The numerator of the time signature (e.g., 4 for 4/4).
     * @param {number} denominator - The denominator of the time signature (e.g., 4 for 4/4).
     */
    setTimeSignature(numerator, denominator) {
        if (this._isPlaying || this._isPaused) {
            console.warn("Cannot change time signature while playing or paused. Please stop the player first.");
            return;
        }
        if (numerator <= 0 || denominator <= 0) {
            console.error("Time signature parts must be positive numbers.");
            return;
        }
        this._timeSignatureNumerator = numerator;
        this._timeSignatureDenominator = denominator;
        this.dispatchEvent(new CustomEvent('timeSignatureChanged', {
            detail: { numerator: this._timeSignatureNumerator, denominator: this._timeSignatureDenominator }
        }));
    }

    /**
     * Sets the subdivision for each grid cell.
     * @param {number} subdivision - E.g., 1 for quarter notes, 2 for eighths, 4 for sixteenths.
     */
    setSubdivision(subdivision) {
        if (this._isPlaying || this._isPaused) {
            console.warn("Cannot change subdivision while playing or paused. Please stop the player first.");
            return;
        }
        if (subdivision <= 0) {
            console.error("Subdivision must be a positive number.");
            return;
        }
        this._subdivision = subdivision;
        this.dispatchEvent(new CustomEvent('subdivisionChanged', { detail: { subdivision: this._subdivision } }));
    }

    /**
     * Enables or disables looping of the sequence.
     * @param {boolean} loop - True to loop, false to stop at the end.
     */
    setLooping(loop) {
        this._loop = loop;
        this.dispatchEvent(new CustomEvent('loopingChanged', { detail: { loop: this._loop } }));
    }

    /**
     * Adds a new track to the player.
     * @param {string} trackId - A unique identifier for the track.
     */
    addTrack(trackId) {
        if (this._tracks.has(trackId)) {
            console.warn(`Track with ID '${trackId}' already exists.`);
            return;
        }
        const gainNode = this.audioContext.createGain();
        gainNode.connect(this.masterGainNode);
        this._tracks.set(trackId, { gainNode: gainNode, cells: new Map() });
        this.dispatchEvent(new CustomEvent('trackAdded', { detail: { trackId } }));
    }

    /**
     * Removes a track from the player. Can only be called in Stop state.
     * @param {string} trackId - The ID of the track to remove.
     */
    removeTrack(trackId) {
        if (this._isPlaying || this._isPaused) {
            console.warn("Cannot remove track while playing or paused. Please stop the player first.");
            return;
        }
        if (!this._tracks.has(trackId)) {
            console.warn(`Track with ID '${trackId}' does not exist.`);
            return;
        }
        const track = this._tracks.get(trackId);
        track.gainNode.disconnect(); // Disconnect from master
        track.cells.clear(); // Clear all audio buffers
        this._tracks.delete(trackId);
        this.dispatchEvent(new CustomEvent('trackRemoved', { detail: { trackId } }));
    }

    /**
     * Places an AudioBuffer at a specific grid cell. Can only be called in Stop state.
     * @param {string} trackId - The ID of the track.
     * @param {number} columnIndex - The column index (0-based).
     * @param {AudioBuffer} audioBuffer - The decoded audio buffer.
     */
    addAudioToGrid(trackId, columnIndex, audioBuffer) {
        if (this._isPlaying || this._isPaused) {
            console.warn("Cannot add audio to grid while playing or paused. Please stop the player first.");
            return;
        }
        const track = this._tracks.get(trackId);
        if (!track) {
            console.error(`Track with ID '${trackId}' does not exist.`);
            return;
        }
        if (columnIndex < 0) {
            console.error("Column index must be non-negative.");
            return;
        }
        track.cells.set(columnIndex, audioBuffer);
        this.dispatchEvent(new CustomEvent('audioAddedToGrid', { detail: { trackId, columnIndex, audioBuffer } }));
    }

    /**
     * Removes audio from a specific grid cell. Can only be called in Stop state.
     * @param {string} trackId - The ID of the track.
     * @param {number} columnIndex - The column index (0-based).
     */
    removeAudioFromGrid(trackId, columnIndex) {
        if (this._isPlaying || this._isPaused) {
            console.warn("Cannot remove audio from grid while playing or paused. Please stop the player first.");
            return;
        }
        const track = this._tracks.get(trackId);
        if (!track) {
            console.warn(`Track with ID '${trackId}' does not exist.`);
            return;
        }
        if (track.cells.delete(columnIndex)) {
            this.dispatchEvent(new CustomEvent('audioRemovedFromGrid', { detail: { trackId, columnIndex } }));
        }
    }

    /**
     * Sets the volume for a specific track.
     * @param {string} trackId - The ID of the track.
     * @param {number} volume - The volume level (0.0 to 1.0).
     */
    setTrackVolume(trackId, volume) {
        const track = this._tracks.get(trackId);
        if (!track) {
            console.warn(`Track with ID '${trackId}' does not exist.`);
            return;
        }
        if (volume < 0 || volume > 1) {
            console.warn("Volume must be between 0.0 and 1.0.");
            volume = Math.max(0, Math.min(1, volume));
        }
        track.gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
        this.dispatchEvent(new CustomEvent('trackVolumeChanged', { detail: { trackId, volume } }));
    }

    /**
     * Sets the master volume of the player.
     * @param {number} volume - The master volume level (0.0 to 1.0).
     */
    setMasterVolume(volume) {
        if (volume < 0 || volume > 1) {
            console.warn("Master volume must be between 0.0 and 1.0.");
            volume = Math.max(0, Math.min(1, volume));
        }
        this.masterGainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
        this.dispatchEvent(new CustomEvent('masterVolumeChanged', { detail: { volume } }));
    }

    /**
     * Gets the current BPM.
     * @returns {number}
     */
    getBPM() {
        return this._bpm;
    }

    /**
     * Gets the current time signature.
     * @returns {{numerator: number, denominator: number}}
     */
    getTimeSignature() {
        return { numerator: this._timeSignatureNumerator, denominator: this._timeSignatureDenominator };
    }

    /**
     * Gets the current subdivision.
     * @returns {number}
     */
    getSubdivision() {
        return this._subdivision;
    }

    /**
     * Gets the current looping state.
     * @returns {boolean}
     */
    getLooping() {
        return this._loop;
    }

    /**
     * Returns the current playback status.
     * @returns {{isPlaying: boolean, isPaused: boolean}}
     */
    getStatus() {
        return { isPlaying: this._isPlaying, isPaused: this._isPaused };
    }

    /**
     * Returns the map of tracks and their contents.
     * @returns {Map<string, { gainNode: GainNode, cells: Map<number, AudioBuffer> }>}
     */
    getTracks() {
        return this._tracks;
    }
}