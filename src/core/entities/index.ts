/**
 * The row types, one per table, in `src/core/entities`.
 *
 * These describe what the database stores. Reading them is a module's job, and
 * so is deciding which columns a given screen needs — a projection lives in
 * `src/infrastructure/repositories`, never here.
 */

export * from "./vocabularies";
export * from "./company";
export * from "./application";
export * from "./jobOpening";
export * from "./candidateAttempt";
export * from "./userProfile";
export * from "./sourcedProspect";
