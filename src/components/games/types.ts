// Shared contract every Kaya game component speaks. The runner
// (/games/[id]) renders the component, and on finish calls the award route
// when `success` is true. `score` is game-specific (recorded + shown);
// `message` is an optional flavour title for the result overlay.

export interface GameOutcome {
  success: boolean;
  score: number;
  message?: string;
}

export interface GameProps {
  onComplete: (outcome: GameOutcome) => void;
}
