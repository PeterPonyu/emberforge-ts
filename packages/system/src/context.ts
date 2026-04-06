import type { DispatchRoute } from "./dispatch.js";

export interface ControlSequenceContext {
  requestId: string;
  input: string;
  route?: DispatchRoute;
}
