"use server";

import { EkeEngine, EkeContext, EkeMessage } from "@/lib/eke/eke-engine";
import { TieredHint } from "@/lib/eke/tiered-hints";

export type EkeEngineState = {
  context: EkeContext;
  hints: TieredHint[];
  messages: EkeMessage[];
  parallelServed: boolean;
};

export async function processEkeTurn(
  state: EkeEngineState,
  input: string
): Promise<{ newMessages: EkeMessage[]; newState: EkeEngineState }> {
  // 1. Rehydrate the engine with the provided state
  const engine = new EkeEngine(state.context);
  engine.importState(state);

  // 2. Process the learner's input securely on the server
  const newMessages = await engine.receive(input);

  // 3. Return the updated state
  return {
    newMessages,
    newState: engine.exportState(),
  };
}

export async function getNextEkeHint(
  state: EkeEngineState
): Promise<{ hint: EkeMessage; newState: EkeEngineState }> {
  const engine = new EkeEngine(state.context);
  engine.importState(state);

  const hint = engine.nextHint();

  return {
    hint,
    newState: engine.exportState(),
  };
}

export async function initializeEkeState(context: EkeContext): Promise<EkeEngineState> {
  const engine = new EkeEngine(context);
  // Optional: add greeting message on initialize
  // engine.greet();
  return engine.exportState();
}
