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
     * Stores track data: { gainNode: GainNode, cells: Map<number, AudioBuffer>, _isMuted: boolean, _lastVolume: number }
     * @type {Map<string, { gainNode: GainNode, cells: Map<number, AudioBuffer>, _isMuted: boolean, _lastVolume: number }>}
     */
    _tracks = new Map();

    _bpm = 120;
    _timeSignatureNumerator = 4;
    _timeSignatureDenominator = 4;
    _subdivisionNoteValue = 16; // e.g., 4 for quarter, 8 for eighth, 16 for sixteenth, 32 for thirty-second
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
     * Based on BPM and the subdivision note value.
     * @returns {number} The duration of one cell in seconds.
     * @private
     */
    _calculateCellDuration() {
        // A whole note at 60 BPM is 4 seconds.
        // So, a whole note at X BPM is (60 / X) * 4 seconds, or 240 / X seconds.
        const secondsPerWholeNote = 240 / this._bpm;
        // The duration of one cell is the duration of a whole note divided by its note value.
        return secondsPerWholeNote / this._subdivisionNoteValue;
    }

    /**
     * Determines the total number of columns (cells) in one measure based on
     * time signature and the subdivision note value.
     * @returns {number} The total number of columns in a measure.
     * @private
     */
    _getMaxColumns() {
        // Calculate the total number of 'subdivisionNoteValue' notes that fit into one measure.
        // Example: 4/4 time, 16th note subdivision (value 16)
        // Numerator = 4, Denominator = 4, SubdivisionNoteValue = 16
        // Total 16th notes in a measure = Numerator * (SubdivisionNoteValue / Denominator)
        // = 4 * (16 / 4) = 4 * 4 = 16 columns.
        // Example: 6/8 time, 16th note subdivision (value 16)
        // Numerator = 6, Denominator = 8, SubdivisionNoteValue = 16
        // Total 16th notes in a measure = 6 * (16 / 8) = 6 * 2 = 12 columns.
        const totalSubdivisionNotesInMeasure = this._timeSignatureNumerator * (this._subdivisionNoteValue / this._timeSignatureDenominator);
        return totalSubdivisionNotesInMeasure;
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
            // Move to the next cell BEFORE dispatching and scheduling
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

            // console.log(`MultiTrackPlayer: Scheduling cell ${this._currentCellIndex} for time ${this._nextCellTime.toFixed(3)}`);

            // Dispatch event for the *current* cell being scheduled
            this.dispatchEvent(new CustomEvent('gridCellChanged', {
                detail: {
                    columnIndex: this._currentCellIndex,
                    time: this._nextCellTime // Time when this cell actually starts
                }
            }));

            // Schedule sounds for the current cell
            this._tracks.forEach(track => {
                // Only play if the track is not muted
                if (!track._isMuted) {
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
                }
            });

            this._nextCellTime += cellDuration;
        }
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
     * Sets the subdivision note value for each grid cell.
     * @param {number} subdivisionNoteValue - E.g., 4 for quarter notes, 8 for eighths, 16 for sixteenths, 32 for thirty-seconds.
     */
    setSubdivisionNoteValue(subdivisionNoteValue) {
        if (this._isPlaying || this._isPaused) {
            console.warn("Cannot change subdivision while playing or paused. Please stop the player first.");
            return;
        }
        if (![4, 8, 16, 32].includes(subdivisionNoteValue)) {
            console.error("Subdivision note value must be 4, 8, 16, or 32.");
            return;
        }
        this._subdivisionNoteValue = subdivisionNoteValue;
        this.dispatchEvent(new CustomEvent('subdivisionChanged', { detail: { subdivisionNoteValue: this._subdivisionNoteValue } }));
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
        // Initialize track with mute state and last volume
        this._tracks.set(trackId, { gainNode: gainNode, cells: new Map(), _isMuted: false, _lastVolume: 1.0 });
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
        // Only update gain if not muted, otherwise, store for when unmuted
        if (!track._isMuted) {
            track.gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
        }
        track._lastVolume = volume; // Always store the last desired volume
        this.dispatchEvent(new CustomEvent('trackVolumeChanged', { detail: { trackId, volume } }));
    }

    /**
     * Mutes or unmutes a specific track.
     * @param {string} trackId - The ID of the track.
     * @param {boolean} isMuted - True to mute, false to unmute.
     */
    setTrackMuted(trackId, isMuted) {
        const track = this._tracks.get(trackId);
        if (!track) {
            console.warn(`Track with ID '${trackId}' does not exist.`);
            return;
        }

        track._isMuted = isMuted;
        if (isMuted) {
            track.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime); // Mute
        } else {
            track.gainNode.gain.setValueAtTime(track._lastVolume, this.audioContext.currentTime); // Restore last volume
        }
        this.dispatchEvent(new CustomEvent('trackMuteChanged', { detail: { trackId, isMuted } }));
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
     * Gets the current subdivision note value.
     * @returns {number}
     */
    getSubdivisionNoteValue() {
        return this._subdivisionNoteValue;
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
     * @returns {Map<string, { gainNode: GainNode, cells: Map<number, AudioBuffer>, _isMuted: boolean, _lastVolume: number }>}
     */
    getTracks() {
        return this._tracks;
    }
}
