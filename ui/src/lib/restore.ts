export interface RestoreConfirmState {
  typedName: string;
  destinationName: string;
  sameDatabase: boolean;
  acknowledged: boolean;
}

/** The typed name must equal the destination target name. Restoring into the source also needs the acknowledgement. */
export function canSubmitRestore(state: RestoreConfirmState): boolean {
  return state.destinationName !== "" && state.typedName === state.destinationName && (!state.sameDatabase || state.acknowledged);
}

/** `acknowledgeOverwrite: true` is required by the API when the destination is the source database (400 otherwise). */
export function restoreRequest(
  destinationTargetId: string,
  typedName: string,
  sameDatabase: boolean,
): { destinationTargetId: string; confirmName: string; acknowledgeOverwrite?: true } {
  return sameDatabase
    ? { destinationTargetId, confirmName: typedName, acknowledgeOverwrite: true }
    : { destinationTargetId, confirmName: typedName };
}
