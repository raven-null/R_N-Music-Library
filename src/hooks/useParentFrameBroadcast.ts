import { useEffect, useRef } from 'react';
import { PlayerState, type Line, type LyricData, type SongResult, type StageLoopMode } from '../types';
import { selectDisplayPlayerState, usePlaybackStore } from '../stores/usePlaybackStore';
import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';

// src/hooks/useParentFrameBroadcast.ts
//
// A page that embeds the player in an iframe (the blog's /music view) cannot read anything across
// the origin boundary - not the song, not the lyric line, not even whether it is playing. So the
// player pushes what it is showing out through postMessage, and the host draws its own "now
// playing" pill from it (the lyric line scrolling in the top bar while the listener reads articles).
//
// Rules this deliberately keeps:
//   - nothing is pushed unless the app is actually framed (`window.parent !== window`), so the
//     normal full-screen player pays only one comparison;
//   - it is a store SUBSCRIPTION, not a React selector: the host pill must not make the app
//     re-render, and `currentLineIndex` is the fastest field here (see usePlaybackStore's header);
//   - only changed payloads go out. The store also moves for queue edits and settings, and the
//     host does not want a message per one of those.
//
// The payload is a public description of what is on screen. It carries no account, cookie or
// session data, so sending it to an unknown parent origin (`'*'`) is safe by construction.

/** The message the host listens for. Versioned by its own name: a host ignores what it does not know. */
export const NOW_PLAYING_MESSAGE = 'folia:now-playing';

/**
 * The other direction: the host's little controls (prev / play-pause / next / loop) on its now-playing
 * pill or card. `action` is one of `FOLIA_CONTROL_ACTIONS`.
 */
export const CONTROL_MESSAGE = 'folia:control';

export type FoliaControlAction = 'prev' | 'toggle' | 'next' | 'loop';

/** What the host must hand over so the pill's controls can drive this player. */
export interface ParentFrameTransport {
    resumePlayback: () => Promise<void>;
    pausePlayback: () => void;
    handlePrevTrack: () => void;
    handleNextTrack: () => Promise<void>;
}

export interface NowPlayingSong {
    id: string;
    name: string;
    /** Every artist, joined with ' / ' the way the app shows it. */
    artist: string;
    album: string;
    cover: string | null;
    durationMs: number;
}

export interface NowPlayingLyricLine {
    index: number;
    text: string;
    translation: string;
    startMs: number;
    endMs: number;
}

export interface NowPlayingPayload {
    type: typeof NOW_PLAYING_MESSAGE;
    source: 'folia';
    playing: boolean;
    /** A song is being loaded to play: the host shows the pill as playing, as the app itself does. */
    loading: boolean;
    song: NowPlayingSong | null;
    lyric: NowPlayingLyricLine | null;
    /** The line after this one, so the host can prepare its transition. */
    nextLyric: { text: string } | null;
    /** The queue loop the player is set to, so the host's loop button can show where it stands. */
    loopMode: StageLoopMode;
    /**
     * The lines around the active one, for a host that draws a scrolling lyric box rather than a single
     * line. `active` is the index into `lines`. Null while the song has no timed lyrics.
     */
    lyricsWindow: { lines: NowPlayingLyricLine[]; active: number } | null;
}

/** How many lines before and after the active one the window carries. */
const LYRIC_LEAD = 5;
const LYRIC_TRAIL = 7;

function lineAt(lines: Line[], index: number): Line | null {
    return index >= 0 && index < lines.length ? lines[index] : null;
}

function readSong(song: SongResult, coverUrl: string | null): NowPlayingSong {
    return {
        id: String(song.id),
        name: song.name ?? '',
        artist: (song.artists ?? []).map(artist => artist.name).filter(Boolean).join(' / '),
        album: song.album?.name ?? '',
        cover: coverUrl || song.album?.coverUrl || null,
        durationMs: song.durationMs ?? 0,
    };
}

/** Reads the store once and shapes the payload the host draws from. Exported for the unit tests. */
export function buildNowPlayingPayload(
    state: ReturnType<typeof usePlaybackStore.getState>,
    loopMode: StageLoopMode = useAudioSettingsStore.getState().loopMode,
): NowPlayingPayload {
    const lyrics: LyricData | null = state.lyrics;
    const lines = lyrics?.lines ?? [];
    const index = state.currentLineIndex;
    const current = lineAt(lines, index);
    const next = lineAt(lines, index + 1);
    const song = state.currentSong;

    // The window a scrolling lyric box draws: the active line sits LYRIC_LEAD lines down from the top,
    // and the box scrolls as the song moves from one window to the next.
    let lyricsWindow: NowPlayingPayload['lyricsWindow'] = null;
    if (lines.length > 0 && index >= 0 && index < lines.length) {
        const start = Math.max(0, index - LYRIC_LEAD);
        const end = Math.min(lines.length, index + LYRIC_TRAIL + 1);
        const windowLines = lines.slice(start, end);
        lyricsWindow = {
            lines: windowLines.map((line, offset) => ({
                index: start + offset,
                text: line.fullText ?? '',
                translation: line.translation ?? '',
                startMs: line.startTime ?? 0,
                endMs: line.endTime ?? 0,
            })),
            active: index - start,
        };
    }

    return {
        type: NOW_PLAYING_MESSAGE,
        source: 'folia',
        playing: state.playerState === PlayerState.PLAYING,
        loading: state.isLoadingToPlay,
        song: song ? readSong(song, state.cachedCoverUrl) : null,
        lyric: current
            ? {
                  index,
                  text: current.fullText ?? '',
                  translation: current.translation ?? '',
                  startMs: current.startTime ?? 0,
                  endMs: current.endTime ?? 0,
              }
            : null,
        nextLyric: next ? { text: next.fullText ?? '' } : null,
        loopMode,
        lyricsWindow,
    };
}

/**
 * Pushes `NOW_PLAYING_MESSAGE` to the parent frame whenever what the host draws changes, and takes
 * the host's `CONTROL_MESSAGE` commands back the other way.
 * Mounted once, at the root of the app; a no-op when the app is not framed.
 */
export function useParentFrameBroadcast(transport: ParentFrameTransport): void {
    // The bridges own these callbacks and rebuild them every render; the message listener binds
    // once, so it reads the newest ones through a ref instead of closing over a stale render.
    const transportRef = useRef(transport);
    useEffect(() => {
        transportRef.current = transport;
    });

    useEffect(() => {
        if (typeof window === 'undefined' || window.parent === window) return;

        let lastSignature = '';
        const publish = () => {
            const payload = buildNowPlayingPayload(usePlaybackStore.getState());
            const signature = JSON.stringify(payload);
            if (signature === lastSignature) return;
            lastSignature = signature;
            try {
                window.parent.postMessage(payload, '*');
            } catch {
                // The host navigated away mid-flight (or refuses messages): nothing to recover.
            }
        };

        publish();
        const unsubPlayback = usePlaybackStore.subscribe(publish);
        // The loop setting lives in the audio settings store: the host's loop button must see it move.
        const unsubSettings = useAudioSettingsStore.subscribe(publish);
        return () => {
            unsubPlayback();
            unsubSettings();
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined' || window.parent === window) return;

        const onMessage = (event: MessageEvent) => {
            const data = event.data as { type?: string; action?: FoliaControlAction } | null;
            if (!data || data.type !== CONTROL_MESSAGE) return;
            const state = usePlaybackStore.getState();
            // Nothing to control yet: ignore rather than let a stray command start a song.
            if (!state.currentSong) return;

            try {
                if (data.action === 'prev') {
                    transportRef.current.handlePrevTrack();
                } else if (data.action === 'next') {
                    void transportRef.current.handleNextTrack();
                } else if (data.action === 'loop') {
                    // The host's loop button: off â†?all â†?one â†?off, the same cycle the player's own
                    // control runs, so both surfaces stay one setting.
                    useAudioSettingsStore.getState().handleToggleLoopMode();
                } else if (data.action === 'toggle') {
                    // The display state, not the raw one: during a blend's lead the raw transport is
                    // IDLE while the outgoing deck still plays, and "toggle" would start a deck twice.
                    if (selectDisplayPlayerState(state) === PlayerState.PLAYING) {
                        transportRef.current.pausePlayback();
                    } else {
                        void transportRef.current.resumePlayback();
                    }
                }
            } catch {
                // A control that throws must not take the player down with it.
            }
        };

        window.addEventListener('message', onMessage);
        return () => {
            window.removeEventListener('message', onMessage);
        };
    }, []);
}
