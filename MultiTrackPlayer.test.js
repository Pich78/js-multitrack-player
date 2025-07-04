// MultiTrackPlayer.test.js

const assert = chai.assert;

describe('MultiTrackPlayer', () => {
    let audioContext;
    let player;

    beforeEach(() => {
        // Create a new AudioContext for each test
        // Use a mock AudioContext if running in a Node.js environment without Web Audio API support
        // For browser-based testing, a real AudioContext is fine, but may need user interaction for resume
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        player = new MultiTrackPlayer(audioContext);

        // Ensure AudioContext is in a runnable state for testing (if applicable)
        if (audioContext.state === 'suspended') {
            audioContext.resume().catch(err => console.error("Failed to resume AudioContext:", err));
        }
    });

    afterEach(() => {
        // Stop any playing sounds and close AudioContext
        player.stop();
        if (audioContext.state !== 'closed') {
            audioContext.close();
        }
    });

    describe('State Management (Play, Pause, Stop)', () => {
        it('should start in stopped state', () => {
            const status = player.getStatus();
            assert.isFalse(status.isPlaying, 'Should not be playing');
            assert.isFalse(status.isPaused, 'Should not be paused');
        });

        it('should transition to play state when play() is called', () => {
            player.play();
            const status = player.getStatus();
            assert.isTrue(status.isPlaying, 'Should be playing');
            assert.isFalse(status.isPaused, 'Should not be paused');
        });

        it('should transition to paused state when pause() is called from play', () => {
            player.play();
            player.pause();
            const status = player.getStatus();
            assert.isFalse(status.isPlaying, 'Should not be playing');
            assert.isTrue(status.isPaused, 'Should be paused');
        });

        it('should resume playing from paused state', () => {
            player.play();
            player.pause();
            player.play();
            const status = player.getStatus();
            assert.isTrue(status.isPlaying, 'Should be playing');
            assert.isFalse(status.isPaused, 'Should not be paused');
        });

        it('should transition to stopped state when stop() is called from play', () => {
            player.play();
            player.stop();
            const status = player.getStatus();
            assert.isFalse(status.isPlaying, 'Should not be playing');
            assert.isFalse(status.isPaused, 'Should not be paused');
        });

        it('should transition to stopped state when stop() is called from pause', () => {
            player.play();
            player.pause();
            player.stop();
            const status = player.getStatus();
            assert.isFalse(status.isPlaying, 'Should not be playing');
            assert.isFalse(status.isPaused, 'Should not be paused');
        });
    });

    describe('BPM, Time Signature, Subdivision', () => {
        it('should allow setting BPM in stop state', () => {
            player.setBPM(150);
            assert.equal(player.getBPM(), 150);
        });

        it('should not allow setting BPM while playing', () => {
            player.play();
            player.setBPM(160);
            assert.equal(player.getBPM(), 120, 'BPM should remain default'); // Default is 120
        });

        it('should allow setting Time Signature in stop state', () => {
            player.setTimeSignature(6, 8);
            const ts = player.getTimeSignature();
            assert.equal(ts.numerator, 6);
            assert.equal(ts.denominator, 8);
        });

        it('should not allow setting Time Signature while playing', () => {
            player.play();
            player.setTimeSignature(3, 4);
            const ts = player.getTimeSignature();
            assert.equal(ts.numerator, 4, 'Numerator should remain default');
            assert.equal(ts.denominator, 4, 'Denominator should remain default');
        });

        it('should allow setting subdivision in stop state', () => {
            player.setSubdivision(8);
            assert.equal(player.getSubdivision(), 8);
        });

        it('should not allow setting subdivision while playing', () => {
            player.play();
            player.setSubdivision(2);
            assert.equal(player.getSubdivision(), 4, 'Subdivision should remain default');
        });
    });

    describe('Track Management', () => {
        it('should add a track', () => {
            player.addTrack('kick');
            assert.isTrue(player.getTracks().has('kick'));
        });

        it('should not add a duplicate track', () => {
            player.addTrack('snare');
            player.addTrack('snare');
            assert.equal(player.getTracks().size, 1); // Should still only have one 'snare' track
        });

        it('should remove a track in stop state', () => {
            player.addTrack('hihat');
            player.removeTrack('hihat');
            assert.isFalse(player.getTracks().has('hihat'));
        });

        it('should not remove a track while playing', () => {
            player.addTrack('bass');
            player.play();
            player.removeTrack('bass');
            assert.isTrue(player.getTracks().has('bass'), 'Track should still exist');
        });
    });

    describe('Audio Grid Management', () => {
        let mockAudioBuffer;
        before(() => {
            // Create a mock AudioBuffer for testing purposes
            // In a real scenario, you'd load a small dummy WAV file.
            // For unit tests, a mock is sufficient for API calls.
            mockAudioBuffer = audioContext.createBuffer(1, 44100 * 0.1, 44100); // 0.1 seconds of silence
        });

        it('should add audio to grid in stop state', () => {
            player.addTrack('drum');
            player.addAudioToGrid('drum', 0, mockAudioBuffer);
            assert.isTrue(player.getTracks().get('drum').cells.has(0));
        });

        it('should not add audio to grid while playing', () => {
            player.addTrack('synth');
            player.play();
            player.addAudioToGrid('synth', 1, mockAudioBuffer);
            assert.isFalse(player.getTracks().get('synth').cells.has(1));
        });

        it('should remove audio from grid in stop state', () => {
            player.addTrack('perc');
            player.addAudioToGrid('perc', 2, mockAudioBuffer);
            player.removeAudioFromGrid('perc', 2);
            assert.isFalse(player.getTracks().get('perc').cells.has(2));
        });

        it('should not remove audio from grid while playing', () => {
            player.addTrack('pad');
            player.addAudioToGrid('pad', 3, mockAudioBuffer);
            player.play();
            player.removeAudioFromGrid('pad', 3);
            assert.isTrue(player.getTracks().get('pad').cells.has(3));
        });
    });

    describe('Volume Control', () => {
        it('should set track volume', () => {
            player.addTrack('testTrack');
            player.setTrackVolume('testTrack', 0.5);
            assert.approximately(player.getTracks().get('testTrack').gainNode.gain.value, 0.5, 0.001);
        });

        it('should set master volume', () => {
            player.setMasterVolume(0.75);
            assert.approximately(player.masterGainNode.gain.value, 0.75, 0.001);
        });
    });

    describe('Looping', () => {
        it('should set looping state', () => {
            player.setLooping(false);
            assert.isFalse(player.getLooping());
            player.setLooping(true);
            assert.isTrue(player.getLooping());
        });
    });

    describe('Events', () => {
        it('should emit "play" event', (done) => {
            player.addEventListener('play', () => {
                assert.isTrue(true); // Event fired
                done();
            }, { once: true });
            player.play();
        });

        it('should emit "stop" event', (done) => {
            player.play(); // Need to be playing to stop
            player.addEventListener('stop', () => {
                assert.isTrue(true); // Event fired
                done();
            }, { once: true });
            player.stop();
        });

        it('should emit "pause" event', (done) => {
            player.play(); // Need to be playing to pause
            player.addEventListener('pause', () => {
                assert.isTrue(true); // Event fired
                done();
            }, { once: true });
            player.pause();
        });

        it('should emit "gridCellChanged" event during playback', (done) => {
            player.addTrack('testEventTrack');
            const mockBuffer = audioContext.createBuffer(1, audioContext.sampleRate * 0.1, audioContext.sampleRate);
            player.addAudioToGrid('testEventTrack', 0, mockBuffer);
            player.addAudioToGrid('testEventTrack', 1, mockBuffer); // Ensure more than one cell

            let cellsVisited = 0;
            player.addEventListener('gridCellChanged', (event) => {
                // The event fires BEFORE scheduling for the *next* cell, so cellIndex 0 is the start of the sequence.
                // We expect 0 then 1
                assert.isAtLeast(event.detail.columnIndex, 0);
                cellsVisited++;
                if (cellsVisited >= 2) { // Wait for at least two cells to be processed
                    done();
                }
            });
            player.setLooping(false); // Make sure it stops
            player.setBPM(600); // Speed up for quicker test
            player.play();
        }).timeout(5000); // Increase timeout for async test

        it('should emit "bpmChanged" event', (done) => {
            player.addEventListener('bpmChanged', (event) => {
                assert.equal(event.detail.bpm, 130);
                done();
            }, { once: true });
            player.setBPM(130);
        });
    });
});