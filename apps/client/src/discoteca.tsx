import { createContext } from "react";
import type { VoiceState } from "@turtle/protocol";

/**
 * Convite para a discoteca: uma mensagem comum cujo texto é só `turtle://discoteca/<id do canal de voz>`.
 * O chat troca esse texto por um cartão com o que está tocando e quem está na chamada.
 */
const INVITE = /^turtle:\/\/discoteca\/([\w-]{1,64})$/;

export const inviteContent = (channelId: string) => `turtle://discoteca/${channelId}`;
/** Id do canal de voz se a mensagem for um convite, senão undefined. */
export const parseInvite = (content: string): string | undefined => INVITE.exec(content.trim())?.[1];

export interface DiscotecaContextValue {
  voiceStates: VoiceState[];
  nameOf: (userId: string) => string;
  /** Manda o convite deste canal de voz para o chat de texto do servidor. */
  invite?: (voiceChannelId: string) => void;
}
export const DiscotecaContext = createContext<DiscotecaContextValue>({ voiceStates: [], nameOf: () => "alguém" });
