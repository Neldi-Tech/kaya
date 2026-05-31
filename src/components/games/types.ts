// Shared contract every Kaya game component speaks. The runner
// (/games/[id]) renders the component, and on finish calls the award route
// when `success` is true. `score` is game-specific (recorded + shown);
// `message` is an optional flavour title for the result overlay.

export interface GameOutcome {
  success: boolean;
  score: number;
  message?: string;
  /** Set by the multi-device room so the runner credits Fun-Points to all
   *  players via /api/games/win rather than the (kid-only) award route. */
  multiplayer?: boolean;
}

export interface GameProps {
  onComplete: (outcome: GameOutcome) => void;
}
