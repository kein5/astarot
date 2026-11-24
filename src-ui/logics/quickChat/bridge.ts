import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { EventCallback, UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import type { ThemeSetting } from '../theme/themes.ts';

// The settings the Quick Chat window takes from the main window (quick_chat.rs, Context).
export interface QuickChatContext {
    ready: boolean;
    language: string;
    enter_to_send: boolean;
    clear_on_send: boolean;
    ui_scaling: number;
    font_family: string;
    theme?: ThemeSetting | null;
}

// One message handed to the main window (quick_chat.rs, Request).
export interface QuickChatRequest {
    id: string;
    message: string;
}

// Whether the main window accepted a request (quick_chat.rs, Reply).
export interface QuickChatReply {
    id: string;
    accepted: boolean;
}

export const quickChatBridge = {
    context: (): Promise<QuickChatContext> => invoke<QuickChatContext>('quick_chat_context'),
    hide: (): Promise<void> => invoke<void>('quick_chat_hide'),
    onOpen: (callback: EventCallback<unknown>): Promise<UnlistenFn> => listen('quick-chat-opened', callback),
    onContextChanged: (callback: EventCallback<unknown>): Promise<UnlistenFn> => listen('quick-chat-context-changed', callback),
    // Grow or shrink the window by delta logical px, keeping its width.
    growBy: (delta: number): Promise<void> => getCurrentWindow().setSize(new LogicalSize(window.innerWidth, window.innerHeight + delta)),
    submit: async (request: QuickChatRequest): Promise<boolean> => {
        let finish: (accepted: boolean) => void;
        const result = new Promise<boolean>(resolve => { finish = resolve; });
        const unlisten = await listen<QuickChatReply>('quick-chat-result', ({ payload }) => {
            if (payload.id === request.id) finish(payload.accepted);
        });
        try {
            const replay = await invoke<QuickChatReply | null>('quick_chat_submit', { request });
            return replay ? replay.accepted : await result;
        } finally { unlisten(); }
    },
};
