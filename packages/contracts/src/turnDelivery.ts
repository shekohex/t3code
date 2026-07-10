import * as Schema from "effect/Schema";

export const TurnDelivery = Schema.Literals(["steer", "followUp"]);
export type TurnDelivery = typeof TurnDelivery.Type;

export const DEFAULT_TURN_DELIVERY: TurnDelivery = "steer";
